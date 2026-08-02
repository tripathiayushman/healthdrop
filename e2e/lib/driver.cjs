// =====================================================
// The app driver: everything that knows how HealthDrop's
// web build actually behaves in a browser.
//
// Two rules this file exists to enforce:
//
//  1. NEVER sleep where a condition can be waited on.
//     Every wait below is "until the DOM says X", with a
//     generous ceiling, so a slow CI box is slow, not red.
//
//  2. NEVER assume a toggle worked. Dark mode and Hindi are
//     applied through the app's own controls and then
//     VERIFIED against rendered pixels / rendered text. The
//     app ignores prefers-color-scheme, so a harness that
//     only sets Playwright's colorScheme runs the light
//     theme twice and calls it a dark test.
// =====================================================

const { TABS, ROLE_LABEL } = require('../catalog.cjs');

const DEVANAGARI = /[\u0900-\u097F]/;

// Ceilings, not expectations. Supabase auth over a bad line is slow.
const T = {
  boot: 90000,
  auth: 90000,
  nav: 45000,
  click: 15000,
  // The Supabase client keeps chatter going, so "networkidle" is a hint with a
  // short ceiling, never the thing we actually wait on. Text stability is.
  idle: 6000,
  settle: 12000,
  short: 8000,
};

class Blocked extends Error {}

// ── low-level helpers ────────────────────────────────────────

/** Exact accessibilityLabel match. Safe for chrome controls. */
const byLabel = (page, label) => page.locator(`[aria-label="${cssEscape(label)}"]`);

function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

/**
 * Resolve a catalog entry label to the control that carries it. Three shapes
 * exist in DashboardShared, and they must be tried in this order — a loose
 * prefix match would happily grab an AlertCard ("Alert, urgency high: …")
 * when the catalog asked for the "Alert" quick action.
 *
 *   1. exact                      QuickActionBtn / ToolCard without a badge
 *   2. "<label>, <n> pending"     ToolCard carrying a badge
 *   3. "<label>: <value>"         StatCard
 */
async function resolveControl(page, label) {
  const esc = cssEscape(label);
  const candidates = [
    { sel: `[aria-label="${esc}"]`, ok: () => true },
    { sel: `[aria-label^="${esc}, "]`, ok: v => /,\s*\d+\s+pending$/.test(v) },
    { sel: `[aria-label^="${esc}: "]`, ok: () => true },
  ];
  for (const { sel, ok } of candidates) {
    const loc = page.locator(sel);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      const one = loc.nth(i);
      const value = await one.getAttribute('aria-label').catch(() => '');
      if (!ok(value || '')) continue;
      if (await one.isVisible().catch(() => false)) return one;
    }
  }
  return null;
}

/**
 * The app's own modals (the map's "Enable Location" prompt, the web-only
 * location alert) cover the whole viewport and eat every tap. Dismiss them
 * until none remain — bounded, and each pass is condition-driven.
 */
async function dismissOverlays(page) {
  const dismissers = ['Not now', 'OK', 'Close alert details'];
  for (let pass = 0; pass < 6; pass += 1) {
    let acted = false;
    for (const label of dismissers) {
      const loc = byLabel(page, label).first();
      if (await loc.count().catch(() => 0)) {
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: T.short }).catch(() => {});
          acted = true;
        }
      }
    }
    if (!acted) return;
    await page.waitForTimeout(200); // one frame for the modal to unmount
  }
}

/**
 * Click something the user could click. Normal (actionability-checked)
 * clicks first — an element that can only be force-clicked is covered by
 * something, and that is a defect worth surfacing, not papering over.
 * Throws `Blocked` after the retries so the caller can record it.
 */
async function tap(page, locator, what) {
  await locator.waitFor({ state: 'visible', timeout: T.nav });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await locator.click({ timeout: T.click });
      return;
    } catch (e) {
      last = e;
      await dismissOverlays(page);
    }
  }
  await locator.click({ force: true, timeout: T.click }).catch(() => {});
  throw new Blocked(`"${what}" could not be clicked normally (${String(last.message).split('\n')[0]}); force-clicked to continue`);
}

/** Wait until the rendered text stops changing — the honest "loaded" signal. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: T.idle }).catch(() => {});
  const deadline = Date.now() + T.settle;
  let previous = null;
  while (Date.now() < deadline) {
    const now = await page
      .evaluate(() => document.body.innerText.length + ':' + document.querySelectorAll('*').length)
      .catch(() => null);
    if (now !== null && now === previous) return;
    previous = now;
    await page.waitForTimeout(400);
  }
}

const tabCount = page => page.evaluate(() => document.querySelectorAll('[role="tab"]').length);

/** The tab shell is up when MainApp has rendered its five bottom tabs. */
const waitForTabShell = (page, timeout = T.auth) =>
  page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 5, null, { timeout });

/** Sub-screens replace the whole shell, so "no tabs" is the arrival signal. */
const waitForSubScreen = (page, timeout = T.nav) =>
  page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 0, null, { timeout });

// ── page facts ───────────────────────────────────────────────

/**
 * Dominant opaque background colour: the largest element carrying a
 * non-transparent background. That is the app's `colors.background`
 * (#FFFFFF light / #0B0B0D dark) in every screen this app renders.
 */
function readBackground(page) {
  return page.evaluate(() => {
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 5000) continue;
      const m = getComputedStyle(el).backgroundColor
        .match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) continue;
      if (m[4] !== undefined && parseFloat(m[4]) < 0.9) continue;
      if (area >= bestArea) { bestArea = area; best = [+m[1], +m[2], +m[3]]; }
    }
    return best;
  });
}

const luminance = (rgb) => {
  if (!rgb) return null;
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Horizontal overflow of the page body, plus the widest offending elements
 * so the failure names a culprit instead of a number. 2 px of slack absorbs
 * sub-pixel rounding.
 */
function readOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const clientW = doc.clientWidth;
    const scrollW = Math.max(doc.scrollWidth, document.body.scrollWidth);
    const offenders = [];
    if (scrollW > clientW + 2) {
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right <= clientW + 2) continue;
        offenders.push({
          tag: el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || null,
          text: (el.textContent || '').trim().slice(0, 60) || null,
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
      offenders.sort((a, b) => b.right - a.right);
    }
    return { clientW, scrollW, offenders: offenders.slice(0, 5) };
  });
}

const readBodyText = page =>
  page.evaluate(() => ({
    length: document.body.innerText.trim().length,
    sample: document.body.innerText.trim().slice(0, 160),
    elements: document.querySelectorAll('*').length,
  }));

const readTabLabels = page =>
  page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).map(e => e.getAttribute('aria-label')));

// ── session actions ──────────────────────────────────────────

/**
 * Console/pageerror sink. Drained per screen so a message is attributed to
 * the screen that produced it, not to the whole run.
 */
function attachErrorSink(page) {
  const buffer = [];
  page.on('pageerror', e => buffer.push({ type: 'pageerror', text: String(e && e.message ? e.message : e) }));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    // "Failed to load resource: … 404" carries no URL in the text; without the
    // origin the failure is unactionable. Query strings are dropped — they can
    // carry row filters, and this file is written to disk.
    let where = null;
    try {
      const raw = msg.location() && msg.location().url;
      if (raw) {
        const u = new URL(raw);
        where = u.origin + u.pathname;
      }
    } catch { /* not a URL — leave it out */ }
    buffer.push({ type: 'console', text: msg.text(), url: where });
  });
  return {
    drain() {
      const out = buffer.slice();
      buffer.length = 0;
      return out;
    },
  };
}

async function login(page, account) {
  await page.getByPlaceholder(/email address/i).first().waitFor({ state: 'visible', timeout: T.boot });
  await page.getByPlaceholder(/email address/i).first().fill(account.email);
  await page.getByPlaceholder(/^Password$/i).first().fill(account.password);
  await tap(page, byLabel(page, 'Sign in').first(), 'Sign in').catch(async (e) => {
    if (!(e instanceof Blocked)) throw e;
  });
  await waitForTabShell(page);
  await dismissOverlays(page);
}

/** Read the role the app thinks we are, from the dashboard header role pill. */
async function readRoleLabel(page) {
  const pill = page.locator('[aria-label^="Role: "]').first();
  if (!(await pill.count().catch(() => 0))) return null;
  const label = await pill.getAttribute('aria-label').catch(() => null);
  return label ? label.replace(/^Role:\s*/, '') : null;
}

const gotoTab = async (page, name) => {
  const index = TABS.indexOf(name);
  if (index < 0) throw new Error(`unknown tab "${name}"`);
  await tap(page, page.getByRole('tab').nth(index), `tab ${name}`);
  await settle(page);
  await dismissOverlays(page);
};

/**
 * Flip the app's OWN dark-mode switch (Profile -> Preferences -> Dark Mode).
 * ThemeContext.toggleTheme cycles light -> dark -> system -> light and boots
 * at 'light' in a fresh context, so exactly one press lands on dark.
 * Returns the measured background so the caller can prove it took.
 */
async function enableDarkMode(page) {
  await gotoTab(page, 'profile');
  const row = byLabel(page, 'Dark Mode').first();
  await tap(page, row, 'Dark Mode toggle');
  // Wait for the paint, not for a timer: the app background token flips
  // #FFFFFF -> #0B0B0D. If it never flips, the caller's theme-applied check
  // records the failure with the measured colour.
  await page.waitForFunction(() => {
    let best = null; let bestArea = 0;
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 5000) continue;
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) continue;
      if (m[4] !== undefined && parseFloat(m[4]) < 0.9) continue;
      if (area >= bestArea) { bestArea = area; best = [+m[1], +m[2], +m[3]]; }
    }
    return !!best && (best[0] + best[1] + best[2]) / 3 < 90;
  }, null, { timeout: T.nav }).catch(() => { /* verified & reported by the caller */ });
  return readBackground(page);
}

/**
 * Switch language through Profile -> "Language / भाषा". The picker closes
 * itself on selection. Returns the tab labels so the caller can prove the
 * new locale actually rendered.
 */
async function setLanguage(page, lang) {
  await gotoTab(page, 'profile');
  await tap(page, byLabel(page, 'Language / भाषा').first(), 'Language row');
  const option = page.locator('[role="radio"]').nth(lang === 'hi' ? 1 : 0);
  await tap(page, option, `language option ${lang}`);
  await page.waitForFunction(
    (expectHindi) => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
        .map(e => e.getAttribute('aria-label') || '');
      if (tabs.length !== 5) return false;
      const hindi = /[\u0900-\u097F]/.test(tabs.join(''));
      return expectHindi ? hindi : !hindi;
    },
    lang === 'hi',
    { timeout: T.nav },
  ).catch(() => { /* verified & reported by the caller */ });
  await dismissOverlays(page);
  return readTabLabels(page);
}

/** Navigate into a sub-screen; returns false when its entry control is absent. */
async function enterScreen(page, entry) {
  if (entry.tab) await gotoTab(page, entry.tab);
  const control = await resolveControl(page, entry.label);
  if (!control) return false;
  await tap(page, control, entry.label);
  await waitForSubScreen(page);
  await settle(page);
  await dismissOverlays(page);
  return true;
}

async function leaveScreen(page) {
  const back = byLabel(page, 'Go back').first();
  if (await back.count().catch(() => 0)) {
    await tap(page, back, 'Go back').catch(() => {});
  }
  await waitForTabShell(page, T.nav).catch(() => {});
  await settle(page);
  await dismissOverlays(page);
}

module.exports = {
  Blocked,
  DEVANAGARI,
  T,
  attachErrorSink,
  byLabel,
  dismissOverlays,
  enableDarkMode,
  enterScreen,
  gotoTab,
  leaveScreen,
  login,
  luminance,
  readBackground,
  readBodyText,
  readOverflow,
  readRoleLabel,
  readTabLabels,
  resolveControl,
  ROLE_LABEL,
  setLanguage,
  settle,
  tabCount,
  tap,
  waitForSubScreen,
  waitForTabShell,
};
