#!/usr/bin/env node
/**
 * Database assertion runner.
 *
 * Why this exists: every security and correctness claim in this project
 * that was "verified by reading" later turned out to be wrong, and the
 * hourly escalation cron failed 960 times without anyone noticing. This
 * script executes db/assertions.sql and db/cron-health.sql against the
 * live database and exits non-zero if either finds a violation.
 *
 * Both SQL files are READ-ONLY: they read system catalogues and
 * cron.job_run_details, and write nothing.
 *
 *   npm run check:db
 *   SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" npm run check:db
 *
 * Transport, in order of preference:
 *   1. the `pg` driver (devDependency) — gives per-violation WARNING lines
 *   2. `psql` on PATH
 *
 * Exit codes:
 *   0  all assertions passed, OR SUPABASE_DB_URL is absent (SKIPPED)
 *   1  at least one assertion failed, or the harness could not run
 *
 * The SKIPPED path is deliberate: a fork or a PR from outside the org has
 * no database secret, and a missing secret must not read as a red build.
 * A *present* secret with no working transport is a broken harness, and
 * that does fail.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const SUITES = [
  { file: 'db/assertions.sql', label: 'schema, grants and policy invariants' },
  { file: 'db/cron-health.sql', label: 'scheduled job health (last 24 h)' },
];

// ── Output helpers ────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const err = (...a) => console.error(...a);
const rule = (ch = '-') => log(ch.repeat(72));

function banner(label, file) {
  log('');
  rule('=');
  log(`  ${label}`);
  log(`  ${file}`);
  rule('=');
}

/** Print a Postgres notice/warning the way psql would. */
function printNotice(n) {
  const sev = (n.severity || 'NOTICE').toUpperCase();
  const body = String(n.message || '').replace(/\n/g, '\n  ');
  const sink = sev === 'WARNING' || sev === 'ERROR' ? err : log;
  if (body === '') {
    sink('');
    return;
  }
  sink(`${sev}:  ${body}`);
  if (n.detail) sink(`  DETAIL:  ${String(n.detail).replace(/\n/g, '\n  ')}`);
  if (n.hint) sink(`  HINT:  ${String(n.hint).replace(/\n/g, '\n  ')}`);
}

// ── Transport: node-postgres ──────────────────────────────────────────
async function runWithPg(Client, url, suites) {
  let failures = 0;

  for (const suite of suites) {
    const abs = path.join(ROOT, suite.file);
    const sql = fs.readFileSync(abs, 'utf8');
    banner(suite.label, suite.file);

    // A fresh connection per suite so one aborted transaction cannot
    // poison the next, and so a failure names exactly one file.
    const client = new Client({
      connectionString: url,
      application_name: 'healthdrop-check-db',
      // Supabase serves a chain most CI images do not carry. Verification
      // is opt-in via SUPABASE_DB_SSL_STRICT=1; see db/README.md.
      ...(/[?&]sslmode=/.test(url)
        ? {}
        : { ssl: { rejectUnauthorized: process.env.SUPABASE_DB_SSL_STRICT === '1' } }),
    });
    client.on('notice', printNotice);

    try {
      await client.connect();
      await client.query("SET statement_timeout = '120s'");
      await client.query(sql);
      log('');
      log(`OK  ${suite.file}`);
    } catch (e) {
      failures++;
      log('');
      err(`FAILED  ${suite.file}`);
      err(`ERROR:  ${e.message}`);
      if (e.detail) err(`  DETAIL:  ${String(e.detail).replace(/\n/g, '\n  ')}`);
      if (e.hint) err(`  HINT:  ${String(e.hint).replace(/\n/g, '\n  ')}`);
      if (!e.severity) err('  (connection or driver error, not an assertion)');
    } finally {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
    }
  }
  return failures;
}

// ── Transport: psql ───────────────────────────────────────────────────
function runWithPsql(url, suites) {
  let failures = 0;

  for (const suite of suites) {
    banner(suite.label, suite.file);
    const res = spawnSync(
      'psql',
      [url, '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-f', path.join(ROOT, suite.file)],
      { stdio: 'inherit', env: { ...process.env, PGAPPNAME: 'healthdrop-check-db' } }
    );
    if (res.status === 0) {
      log('');
      log(`OK  ${suite.file}`);
    } else {
      failures++;
      log('');
      err(`FAILED  ${suite.file}  (psql exit ${res.status})`);
    }
  }
  return failures;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.SUPABASE_DB_URL;

  if (!url) {
    log('');
    log('SKIPPED  database assertions — SUPABASE_DB_URL is not set.');
    log('');
    log('  Nothing was checked. This is not a pass.');
    log('  Set SUPABASE_DB_URL to the project connection string');
    log('  (Supabase dashboard -> Project Settings -> Database -> Connection string)');
    log('  and re-run:  npm run check:db');
    log('');
    process.exit(0);
  }

  const missing = SUITES.filter((s) => !fs.existsSync(path.join(ROOT, s.file)));
  if (missing.length) {
    err('');
    err(`FAILED  missing SQL file(s): ${missing.map((s) => s.file).join(', ')}`);
    process.exit(1);
  }

  let Client = null;
  try {
    ({ Client } = require('pg'));
  } catch {
    /* fall through to psql */
  }

  let failures;
  if (Client) {
    failures = await runWithPg(Client, url, SUITES);
  } else {
    const probe = spawnSync('psql', ['--version'], { stdio: 'ignore' });
    if (probe.error || probe.status !== 0) {
      err('');
      err('FAILED  SUPABASE_DB_URL is set but there is no way to reach the database.');
      err('  Install the driver:  npm install --save-dev pg');
      err('  ...or put psql on PATH (PostgreSQL client tools).');
      err('');
      err('  Not exiting 0: a configured check that cannot run is a broken');
      err('  gate, and a broken gate is how BRK-08 failed 960 times unseen.');
      process.exit(1);
    }
    log('');
    log('note: `pg` is not installed — falling back to psql.');
    failures = runWithPsql(url, SUITES);
  }

  log('');
  rule('=');
  if (failures > 0) {
    err(`  ${failures} of ${SUITES.length} suite(s) FAILED — see the WARNING lines above.`);
    err('  Do not weaken an assertion to make it pass. Fix the database, or');
    err('  record the exception in the matching allowlist in db/assertions.sql.');
    rule('=');
    process.exit(1);
  }
  log(`  All ${SUITES.length} suite(s) passed.`);
  rule('=');
  process.exit(0);
}

main().catch((e) => {
  err('');
  err(`FAILED  unexpected harness error: ${(e && e.stack) || e}`);
  process.exit(1);
});
