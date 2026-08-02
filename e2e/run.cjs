#!/usr/bin/env node
// =====================================================
// HEALTHDROP ROLE-TOUR HARNESS
// -----------------------------------------------------
// Logs in as every test role, walks every tab and every
// screen that role can reach, across a width × theme ×
// language matrix, and fails the run on:
//
//   * horizontal overflow of the page body
//   * any unhandled console error or pageerror
//   * a login that does not reach a dashboard
//   * a dashboard that belongs to the wrong role
//   * any screen that renders an empty body
//   * a dark run that did not actually go dark
//   * a Hindi run that did not actually render Hindi
//   * a screen a role is permitted to open but cannot reach
//   * a control that could only be clicked with force
//
// Why it exists: this app once shipped an unreadable
// near-black light-mode header because the only visual
// check ever run was a screenshot of the SIGN-IN screen.
// Nobody logged in. Six findings in docs/REFINEMENT_PLAN.md
// are literally "nobody logged in as that role".
//
// Usage:  node e2e/run.cjs [--quick] [options]   (see --help)
// =====================================================

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { ROLES, ROLE_LABEL, TABS, SCREENS, FULL_SESSIONS, QUICK_SESSIONS } = require('./catalog.cjs');
const { serveDist } = require('./lib/server.cjs');
const { loadAccounts, ENV_VAR } = require('./lib/accounts.cjs');
const D = require('./lib/driver.cjs');
const R = require('./lib/report.cjs');

// A missing export in driver.cjs surfaces mid-session as "D.x is not a
// function" — a harness bug wearing an app bug's clothes. Fail at load instead.
for (const name of [
  'attachErrorSink', 'dismissOverlays', 'enableDarkMode', 'enterScreen', 'gotoTab',
  'leaveScreen', 'login', 'luminance', 'readBackground', 'readBodyText',
  'readOverflow', 'readRoleLabel', 'resolveControl', 'setLanguage', 'settle',
]) {
  if (typeof D[name] !== 'function') {
    throw new Error(`e2e/lib/driver.cjs is missing export "${name}"`);
  }
}

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const REPORT = path.join(__dirname, 'report.json');

// ── CLI ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    mode: 'full',
    dist: path.join(ROOT, 'dist'),
    roles: null,
    concurrency: 2,
    headed: false,
    shots: true,
    report: REPORT,
    help: false,
  };
  for (const arg of argv) {
    const [key, value] = arg.startsWith('--') ? arg.slice(2).split('=') : [arg, undefined];
    switch (key) {
      case 'quick': opts.mode = 'quick'; break;
      case 'full': opts.mode = 'full'; break;
      case 'dist': opts.dist = path.resolve(value); break;
      case 'roles': case 'role': opts.roles = value.split(',').map(s => s.trim()); break;
      case 'concurrency': opts.concurrency = Math.max(1, Number(value) || 1); break;
      case 'headed': opts.headed = true; break;
      case 'no-shots': opts.shots = false; break;
      case 'report': opts.report = path.resolve(value); break;
      case 'help': case 'h': opts.help = true; break;
      default:
        throw new Error(`unknown option "${arg}" — try --help`);
    }
  }
  return opts;
}

const HELP = `
HealthDrop role-tour harness

  node e2e/run.cjs                 full matrix (CI)
  node e2e/run.cjs --quick         fast subset for local iteration
  npm run e2e / npm run e2e:quick  the same, via package.json

Options
  --quick                 4 sessions: 2 roles x (412 light en | 360 dark hi)
  --full                  24 sessions: every role, both widths, both themes,
                          both languages (default)
  --roles=a,b             restrict to these roles
  --concurrency=N         parallel browser contexts (default 2)
  --dist=PATH             web bundle to serve (default ./dist)
  --report=PATH           where to write report.json (default e2e/report.json)
  --headed                watch it run
  --no-shots              skip screenshots
  --help

Prerequisites
  npx expo export --platform web     # produces ./dist
  npx playwright install chromium    # one-time browser download
  credentials in $${ENV_VAR} or e2e/accounts.local.json

Exit codes
  0  everything passed, or SKIPPED (no credentials configured)
  1  at least one unsuppressed failure, or a stale known failure
  2  the harness itself could not run (no bundle, bad config)
`;

// ── logging ──────────────────────────────────────────────────

const log = (...a) => console.log(...a);
const pad = (s, n) => String(s).padEnd(n);

// ── one session ──────────────────────────────────────────────

/**
 * A session = one login, in one matrix cell, walking tabs and (optionally)
 * every screen the role can reach.
 */
async function runSession(browser, baseUrl, session, account, opts, checks) {
  const cellId = `${session.role}@${session.width}-${session.theme}-${session.lang}`;
  const scope = {
    role: session.role,
    width: session.width,
    theme: session.theme,
    lang: session.lang,
  };
  const started = Date.now();
  const visited = [];

  const context = await browser.newContext({
    viewport: { width: session.width, height: 900 },
    deviceScaleFactor: 1,
    // Deliberately NOT session.theme: the app ignores prefers-color-scheme,
    // so pinning the OS to light means a "dark" session that renders light is
    // unambiguously a broken in-app toggle rather than an ambiguous default.
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(D.T.nav);
  const sink = D.attachErrorSink(page);

  const record = (kind, status, fields) => {
    checks.push(R.check(kind, status, { ...scope, ...fields }));
  };

  /** Drain console/pageerror since the last screen and record one check per signature. */
  const recordRuntimeErrors = (screen) => {
    const drained = sink.drain();
    const seen = new Map();
    for (const e of drained) {
      const full = e.url ? `${e.text} @ ${e.url}` : e.text;
      const sig = R.signature(full);
      if (!seen.has(sig)) seen.set(sig, { type: e.type, sig, count: 0, sample: full.slice(0, 300) });
      seen.get(sig).count += 1;
    }
    for (const e of seen.values()) {
      record(e.type === 'pageerror' ? 'page-error' : 'console-error', 'fail', {
        screen,
        signature: e.sig,
        detail: e.sample,
        occurrences: e.count,
      });
    }
    if (seen.size === 0) record('runtime-clean', 'pass', { screen });
  };

  /** Every per-screen assertion, in one place. */
  const inspect = async (screen) => {
    await D.settle(page);
    await D.dismissOverlays(page);

    const body = await D.readBodyText(page);
    record('empty-body', body.length >= 20 ? 'pass' : 'fail', {
      screen,
      detail: `body innerText ${body.length} chars, ${body.elements} elements`,
      sample: body.sample,
    });

    const of = await D.readOverflow(page);
    record('overflow', of.scrollW <= of.clientW + 2 ? 'pass' : 'fail', {
      screen,
      detail: `content ${of.scrollW}px in ${of.clientW}px viewport`,
      offenders: of.offenders,
    });

    if (opts.shots) {
      const file = path.join(SHOTS, `${cellId}--${screen}.png`);
      await page.screenshot({ path: file, fullPage: false }).catch(() => {});
    }

    recordRuntimeErrors(screen);
    visited.push(screen);
  };

  try {
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: D.T.boot });

    // ── login ──────────────────────────────────────────────
    try {
      await D.login(page, account);
      record('login', 'pass', { screen: 'auth', detail: `reached the tab shell as ${account.email}` });
    } catch (e) {
      record('login', 'fail', { screen: 'auth', detail: String(e.message).split('\n')[0] });
      if (opts.shots) await page.screenshot({ path: path.join(SHOTS, `${cellId}--LOGIN-FAILED.png`) }).catch(() => {});
      recordRuntimeErrors('auth');
      return { visited, durationMs: Date.now() - started, status: 'failed' };
    }

    // ── are we actually this role? ─────────────────────────
    const seenRole = await D.readRoleLabel(page);
    const expected = ROLE_LABEL[session.role];
    record('role-identity', seenRole === expected ? 'pass' : 'fail', {
      screen: 'home',
      detail: `dashboard says "${seenRole}", account is configured as "${expected}"`,
    });

    // ── apply the matrix cell through the app's own controls ─
    if (session.theme === 'dark') {
      const bg = await D.enableDarkMode(page);
      const lum = D.luminance(bg);
      record('theme-applied', lum !== null && lum < 0.15 ? 'pass' : 'fail', {
        screen: 'profile',
        detail: `after the in-app Dark Mode toggle the dominant background is rgb(${(bg || []).join(',')}) (luminance ${lum === null ? 'n/a' : lum.toFixed(3)})`,
      });
    }
    if (session.lang === 'hi') {
      const labels = await D.setLanguage(page, 'hi');
      const hindi = D.DEVANAGARI.test((labels || []).join(''));
      record('lang-applied', hindi ? 'pass' : 'fail', {
        screen: 'profile',
        detail: `tab labels after selecting हिन्दी: ${JSON.stringify(labels)}`,
      });
    }

    // ── walk every tab ─────────────────────────────────────
    for (const tab of TABS) {
      try {
        await D.gotoTab(page, tab);
        await inspect(`tab-${tab}`);
      } catch (e) {
        const blocked = e instanceof D.Blocked;
        record(blocked ? 'click-blocked' : 'tab-walk', 'fail', {
          screen: `tab-${tab}`,
          detail: String(e.message).split('\n')[0],
        });
        if (blocked) await inspect(`tab-${tab}`);
      }
    }

    // ── walk every screen this role can reach ──────────────
    if (session.screens) {
      for (const spec of SCREENS) {
        const permitted = spec.permittedRoles.includes(session.role);
        const entry = (spec.entries || {})[session.role];

        if (!permitted) continue;
        if (entry) {
          // Recorded as a PASS of the same kind so that a reachability fix
          // produces positive evidence, which is what makes a now-obsolete
          // known-failure entry detectable as stale.
          record('screen-unreachable', 'pass', {
            screen: spec.id,
            detail: `${session.role} reaches "${spec.id}" via "${entry.label}" on the ${entry.tab} surface`,
          });
        } else {
          record('screen-unreachable', 'fail', {
            screen: spec.id,
            detail:
              `${session.role} is permitted to open "${spec.id}" (MainApp SCREEN_PERMISSIONS/CREATE_PERMISSIONS) ` +
              `but no dashboard, tab or chrome control navigates there` +
              (spec.unreachableWhy ? ` — ${spec.unreachableWhy}` : ''),
          });
          continue;
        }

        try {
          const entered = await D.enterScreen(page, entry);
          if (!entered) {
            record('screen-entry', entry.optional ? 'skip' : 'fail', {
              screen: spec.id,
              detail: entry.optional
                ? `entry control "${entry.label}" absent — ${entry.why || 'conditional on data'}`
                : `entry control "${entry.label}" is missing from the ${entry.tab} surface`,
            });
            continue;
          }
          record('screen-entry', 'pass', { screen: spec.id, detail: `opened via "${entry.label}"` });
          await inspect(spec.id);
        } catch (e) {
          record(e instanceof D.Blocked ? 'click-blocked' : 'screen-entry', 'fail', {
            screen: spec.id,
            detail: String(e.message).split('\n')[0],
          });
        } finally {
          await D.leaveScreen(page).catch(() => {});
        }
      }
    }

    return { visited, durationMs: Date.now() - started, status: 'completed' };
  } catch (e) {
    record('session', 'fail', { screen: 'session', detail: String(e.message).split('\n')[0] });
    if (opts.shots) await page.screenshot({ path: path.join(SHOTS, `${cellId}--SESSION-ERROR.png`) }).catch(() => {});
    return { visited, durationMs: Date.now() - started, status: 'errored' };
  } finally {
    // Let in-flight requests finish before tearing the context down.
    //
    // Without this, closing mid-request aborts every open fetch and Chromium
    // reports each one as `net::ERR_FAILED`, which the console-error check
    // cannot distinguish from a real failure. It looked exactly like a bug on
    // whichever screen happened to be last in the walk: six failures against
    // five different endpoints, all at the same instant, all
    // `TypeError: Failed to fetch`. The tell was that they spanned unrelated
    // tables — an app defect does not break profiles, health_alerts,
    // disease_reports and water_quality_reports simultaneously.
    //
    // Bounded, and best-effort: a hung request must not stall the run.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await context.close().catch(() => {});
  }
}

// ── orchestration ────────────────────────────────────────────

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  if (opts.help) { log(HELP); return 0; }

  const startedAt = new Date();
  const base = {
    tool: 'healthdrop-role-tour',
    mode: opts.mode,
    startedAt: startedAt.toISOString(),
  };

  // ── credentials ────────────────────────────────────────────
  let accountsResult;
  try {
    accountsResult = loadAccounts();
  } catch (e) {
    console.error(`\n  E2E CONFIG ERROR  ${e.message}\n`);
    R.writeReport(opts.report, { ...base, status: 'error', error: e.message });
    return 2;
  }

  if (!accountsResult.accounts) {
    log('');
    log('  ┌──────────────────────────────────────────────────────────────┐');
    log('  │  ROLE-TOUR HARNESS: SKIPPED                                  │');
    log('  └──────────────────────────────────────────────────────────────┘');
    log(`  ${accountsResult.skipReason}`);
    log('  Nothing was verified. This is exit 0 so a missing secret cannot');
    log('  redden CI — it is NOT evidence that the UI is healthy.');
    log('');
    R.writeReport(opts.report, {
      ...base,
      status: 'skipped',
      finishedAt: new Date().toISOString(),
      skipReason: accountsResult.skipReason,
      checks: [],
      summary: { total: 0, passed: 0, failed: 0, knownFailed: 0, skipped: 0 },
    });
    return 0;
  }

  // ── known failures ─────────────────────────────────────────
  let knownFailures;
  try {
    knownFailures = R.loadKnownFailures();
  } catch (e) {
    console.error(`\n  E2E CONFIG ERROR  ${e.message}\n`);
    R.writeReport(opts.report, { ...base, status: 'error', error: e.message });
    return 2;
  }

  // ── sessions ───────────────────────────────────────────────
  let sessions = (opts.mode === 'quick' ? QUICK_SESSIONS : FULL_SESSIONS).slice();
  if (opts.roles) {
    const unknown = opts.roles.filter(r => !ROLES.includes(r));
    if (unknown.length) {
      console.error(`unknown role(s): ${unknown.join(', ')}`);
      return 2;
    }
    const before = sessions.map(s => s.role);
    sessions = sessions.filter(s => opts.roles.includes(s.role));
    if (!sessions.length) {
      console.error(
        `no ${opts.mode} sessions cover ${opts.roles.join(', ')} — ` +
        `the ${opts.mode} matrix only runs ${[...new Set(before)].join(', ')}. ` +
        `Use --full, or add sessions to FULL_SESSIONS/QUICK_SESSIONS in e2e/catalog.cjs.`
      );
      return 2;
    }
  }
  const missing = [...new Set(sessions.map(s => s.role))].filter(r => !accountsResult.accounts.has(r));
  if (missing.length) {
    sessions = sessions.filter(s => !missing.includes(s.role));
    log(`  note: no credentials for ${missing.join(', ')} — those roles are not covered by this run.`);
  }
  if (!sessions.length) {
    console.error('no sessions to run (every requested role is missing credentials)');
    return 2;
  }

  // ── bundle ─────────────────────────────────────────────────
  let server;
  try {
    server = await serveDist(opts.dist);
  } catch (e) {
    console.error(`\n  E2E SETUP ERROR  ${e.message}\n`);
    R.writeReport(opts.report, { ...base, status: 'error', error: e.message });
    return 2;
  }

  if (opts.shots) {
    fs.rmSync(SHOTS, { recursive: true, force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
  }

  const indexStat = fs.statSync(path.join(opts.dist, 'index.html'));
  log('');
  log(`  role-tour: ${opts.mode} matrix · ${sessions.length} sessions · concurrency ${opts.concurrency}`);
  log(`  bundle:    ${opts.dist} (built ${indexStat.mtime.toISOString()})`);
  log(`  accounts:  ${accountsResult.source}`);
  log(`  serving:   ${server.url}`);
  log('');

  const browser = await chromium.launch({ headless: !opts.headed });
  const checks = [];
  const sessionRows = [];

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= sessions.length) return;
      const session = sessions[index];
      const account = accountsResult.accounts.get(session.role);
      const label = `${pad(session.role, 17)} ${session.width}px ${pad(session.theme, 5)} ${session.lang}${session.screens ? ' +screens' : ''}`;
      const before = checks.length;
      const result = await runSession(browser, server.url, session, account, opts, checks);
      const failed = checks.slice(before).filter(c => c.status === 'fail').length;
      // "flag" is pre-verdict: known-failure matching happens once, at the end.
      log(`  ${failed ? 'flag' : ' ok '}  ${label}  ${Math.round(result.durationMs / 1000)}s  ` +
          `${result.visited.length} screens${failed ? `  ${failed} failing checks` : ''}`);
      sessionRows.push({ ...session, ...result, failingChecks: failed });
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency, sessions.length) }, worker));
  await browser.close();
  await server.close();

  // ── verdict ────────────────────────────────────────────────
  const known = R.applyKnownFailures(checks, knownFailures);
  const summary = R.summarise(checks);
  const finishedAt = new Date();

  const payload = {
    ...base,
    status: 'pending',
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    bundle: { dist: opts.dist, builtAt: indexStat.mtime.toISOString() },
    accountsSource: accountsResult.source,
    matrix: {
      roles: [...new Set(sessions.map(s => s.role))],
      widths: [...new Set(sessions.map(s => s.width))],
      themes: [...new Set(sessions.map(s => s.theme))],
      languages: [...new Set(sessions.map(s => s.lang))],
      tabs: TABS,
      sessions: sessions.length,
    },
    sessions: sessionRows,
    summary: { ...summary, staleKnownFailures: known.stale.length },
    knownFailures: known,
    checks,
  };

  const realFailures = checks.filter(c => c.status === 'fail' && !c.known);
  payload.status = realFailures.length || known.stale.length ? 'failed' : 'passed';
  R.writeReport(opts.report, payload);

  // ── console summary ────────────────────────────────────────
  log('');
  log(`  checks: ${summary.total}  passed ${summary.passed}  failed ${realFailures.length}  ` +
      `known-failing ${summary.knownFailed}  skipped ${summary.skipped}`);

  if (realFailures.length) {
    log('');
    log('  FAILURES');
    const grouped = new Map();
    for (const f of realFailures) {
      const key = `${f.kind} · ${f.screen}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(f);
    }
    for (const [key, items] of grouped) {
      log(`    ${key}  (${items.length}×)`);
      const first = items[0];
      log(`      ${first.role} ${first.width}px ${first.theme} ${first.lang}: ${first.detail}`);
      if (first.offenders && first.offenders.length) {
        for (const o of first.offenders.slice(0, 3)) {
          log(`        overflowing to ${o.right}px: <${o.tag}> ${JSON.stringify(o.label || o.text)}`);
        }
      }
    }
  }

  if (known.stillFailing.length) {
    log('');
    log('  KNOWN FAILURES (recorded, not hidden)');
    for (const k of known.stillFailing) {
      log(`    ${pad(k.finding, 8)} ${k.id}  ${k.failingObservations}× — ${k.reason}`);
    }
  }

  if (known.stale.length) {
    log('');
    log('  STALE KNOWN FAILURES — these now PASS. Delete the entry from');
    log('  e2e/known-failures.json so the fix stays guarded.');
    for (const k of known.stale) {
      log(`    ${pad(k.finding, 8)} ${k.id}  (${k.passingObservationsInScope} passing observations in scope)`);
    }
  }

  if (known.unmatched.length) {
    log('');
    log('  known failures that matched NOTHING this run — either the defect is');
    log('  fixed (delete the entry) or this run never visited its scope');
    log('  (normal for --quick / --roles). Not red, but do not leave it rotting.');
    for (const k of known.unmatched) log(`    ${pad(k.finding, 8)} ${k.id}`);
  }

  log('');
  log(`  report:      ${path.relative(ROOT, opts.report)}`);
  if (opts.shots) log(`  screenshots: ${path.relative(ROOT, SHOTS)}`);
  log(`  verdict:     ${payload.status.toUpperCase()}`);
  log('');

  return payload.status === 'passed' ? 0 : 1;
}

main().then(
  code => process.exit(code),
  err => {
    console.error('\n  E2E CRASHED\n', err);
    process.exit(2);
  },
);
