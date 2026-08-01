#!/usr/bin/env node
/**
 * Token contrast guard.
 *
 * Why this exists: light-mode `headerBg` was once set to a near-black ink
 * masthead while header subtitles kept using `textSecondary`. That pairing
 * rendered at ~1.5:1 — effectively unreadable — and shipped, because nothing
 * checked colour pairs and the visual smoke test only ever opened the
 * sign-in screen. This script fails the build on any pairing that breaks the
 * Bharosa promise: "everything she must read is >= 8:1", body >= 7:1,
 * secondary/meta >= 4.5:1.
 *
 * Run: node scripts/check-contrast.cjs
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'lib', 'ThemeContext.tsx');
const src = fs.readFileSync(SRC, 'utf8');

// ── Extract the light/dark theme literals ────────────────────────────────
function block(name) {
  const start = src.indexOf(`  ${name}: {`);
  if (start === -1) throw new Error(`theme block "${name}" not found`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated theme block "${name}"`);
}

function tokens(text) {
  const out = {};
  for (const m of text.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) out[m[1]] = m[2];
  return out;
}

const THEMES = { light: tokens(block('light')), dark: tokens(block('dark')) };

// ── WCAG relative luminance / contrast ───────────────────────────────────
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const lum = (hex) =>
  rgb(hex)
    .map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    })
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// ── The contract. [foreground, background, floor, label] ──────────────────
const PAIRS = [
  ['text', 'headerBg', 7, 'header title'],
  ['textSecondary', 'headerBg', 4.5, 'header subtitle'],
  ['text', 'background', 7, 'body on screen'],
  ['text', 'card', 7, 'body on card'],
  ['text', 'surface', 7, 'body on surface'],
  ['textSecondary', 'card', 4.5, 'secondary on card'],
  ['textSecondary', 'background', 4.5, 'secondary on screen'],
  ['textTertiary', 'card', 4.5, 'meta on card'],
  ['onPrimary', 'primary', 4.5, 'primary button label'],
  ['onPrimary', 'primaryDark', 4.5, 'primary button pressed'],
  ['primary', 'background', 4.5, 'link / outline label'],
  ['danger', 'dangerBg', 4.5, 'danger text on its tint'],
  ['success', 'successBg', 4.5, 'success text on its tint'],
  ['warning', 'warningBg', 4.5, 'warning text on its tint'],
  ['info', 'infoBg', 4.5, 'info text on its tint'],
  ['ai', 'aiBg', 4.5, 'AI text on its tint'],
];

let failed = 0;
let checked = 0;
for (const mode of ['light', 'dark']) {
  const t = THEMES[mode];
  for (const [fg, bg, floor, label] of PAIRS) {
    if (!t[fg] || !t[bg]) continue; // token not present in this theme
    checked++;
    const r = ratio(t[fg], t[bg]);
    if (r < floor) {
      failed++;
      console.error(
        `FAIL  ${mode.padEnd(5)} ${label}: ${r.toFixed(2)}:1 (needs ${floor}:1)  ` +
          `${fg} ${t[fg]} on ${bg} ${t[bg]}`
      );
    }
  }
}

if (failed) {
  console.error(`\n${failed} contrast failure(s) across ${checked} checked pairs.`);
  console.error('Fix the token values in lib/ThemeContext.tsx — do not lower the floors.');
  process.exit(1);
}
console.log(`Contrast OK — ${checked} token pairs meet their floors in both themes.`);
