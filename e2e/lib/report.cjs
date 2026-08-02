// =====================================================
// Checks, known failures, and the machine-readable report.
//
// KNOWN_FAILURES exist so the harness can run GREEN on a
// codebase that is currently broken WITHOUT hiding a single
// defect: every suppressed failure is listed, by reason and
// by refinement-plan finding id, in e2e/known-failures.json
// and again in e2e/report.json.
//
// The other half of that bargain is enforced here: a known
// failure that has started PASSING fails the run. A stale
// suppression is how a fixed bug quietly becomes unguarded.
// =====================================================

const fs = require('fs');
const path = require('path');

const KNOWN_FILE = path.join(__dirname, '..', 'known-failures.json');

/** One recorded observation. `status` is 'pass' | 'fail' | 'skip'. */
function check(kind, status, fields) {
  return { kind, status, ...fields };
}

/**
 * Collapse a runtime error message to something stable enough to name in a
 * suppression file: no ids, no counts, no urls, no timestamps.
 */
function signature(text) {
  return String(text || '')
    // Query strings can carry row filters (and, in other stacks, tokens) and
    // are pure noise for grouping. The PATH is kept: "which endpoint 404'd"
    // is the whole value of the signature.
    .replace(/\?\S*/g, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d[\d.,:]*\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function loadKnownFailures() {
  if (!fs.existsSync(KNOWN_FILE)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8'));
  } catch (e) {
    throw new Error(`e2e/known-failures.json is not valid JSON: ${e.message}`);
  }
  const entries = Array.isArray(parsed) ? parsed : parsed.knownFailures;
  if (!Array.isArray(entries)) {
    throw new Error('e2e/known-failures.json must be an array, or an object with a "knownFailures" array');
  }
  entries.forEach((entry, i) => {
    if (!entry.id) throw new Error(`known-failures.json[${i}] needs an "id"`);
    if (!entry.reason) throw new Error(`known failure "${entry.id}" needs a "reason"`);
    if (!entry.finding) throw new Error(`known failure "${entry.id}" needs a "finding" (refinement-plan id, or "none")`);
    if (!entry.match || typeof entry.match !== 'object') {
      throw new Error(`known failure "${entry.id}" needs a "match" object`);
    }
    if (!entry.match.kind) throw new Error(`known failure "${entry.id}" needs match.kind`);
  });
  return entries;
}

const SCOPE_FIELDS = ['kind', 'role', 'screen', 'width', 'theme', 'lang'];

/** Does this entry's scope describe this check at all (ignoring signature)? */
function inScope(entry, item) {
  return SCOPE_FIELDS.every(f => entry.match[f] === undefined || entry.match[f] === item[f]);
}

function matches(entry, item) {
  if (!inScope(entry, item)) return false;
  if (entry.match.signature !== undefined) {
    const target = item.signature || item.detail || '';
    let re;
    try {
      re = new RegExp(entry.match.signature);
    } catch {
      return String(target).includes(entry.match.signature);
    }
    return re.test(String(target));
  }
  return true;
}

/**
 * Annotate checks with `known` + the suppressing entry, and classify every
 * suppression as: still-failing (fine), stale (fixed — fails the run), or
 * not-exercised (this run never visited its scope; normal for --quick).
 */
function applyKnownFailures(checks, entries) {
  const state = entries.map(entry => ({ entry, failed: 0, passed: 0, scoped: 0 }));

  for (const item of checks) {
    for (const s of state) {
      if (!inScope(s.entry, item)) continue;
      s.scoped += 1;
      if (item.status === 'fail' && matches(s.entry, item)) {
        s.failed += 1;
        item.known = s.entry.id;
        item.knownReason = s.entry.reason;
        item.knownFinding = s.entry.finding;
      } else if (item.status === 'pass') {
        s.passed += 1;
      }
    }
  }

  const stillFailing = [];
  const stale = [];
  const unmatched = [];
  for (const s of state) {
    const row = {
      id: s.entry.id,
      finding: s.entry.finding,
      reason: s.entry.reason,
      match: s.entry.match,
      failingObservations: s.failed,
      passingObservationsInScope: s.passed,
    };
    if (s.failed > 0) {
      stillFailing.push(row);
    } else if (s.passed > 0) {
      // Positive evidence: the same check now passes where this entry says it
      // fails. That is a fixed defect losing its guard — fail the run.
      stale.push(row);
    } else {
      // Matched nothing, and nothing of the same kind passed either. Could be a
      // fix (a console error that simply stopped happening leaves no passing
      // counterpart) or a scope this run never visited. Loud, but not red:
      // turning it red would make --quick and --roles unusable.
      unmatched.push(row);
    }
  }
  return { stillFailing, stale, unmatched };
}

function summarise(checks) {
  const s = { total: checks.length, passed: 0, failed: 0, knownFailed: 0, skipped: 0 };
  for (const c of checks) {
    if (c.status === 'pass') s.passed += 1;
    else if (c.status === 'skip') s.skipped += 1;
    else if (c.known) s.knownFailed += 1;
    else s.failed += 1;
  }
  return s;
}

function writeReport(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

module.exports = {
  KNOWN_FILE,
  applyKnownFailures,
  check,
  loadKnownFailures,
  signature,
  summarise,
  writeReport,
};
