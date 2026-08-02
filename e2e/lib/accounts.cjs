// =====================================================
// Credentials. Never in tracked code.
//
//   1. HEALTHDROP_E2E_ACCOUNTS  — JSON array in the env
//      (CI secret). [{ "role": "...", "email": "...", "password": "..." }]
//   2. e2e/accounts.local.json  — same shape, gitignored
//   3. neither                  — SKIPPED, exit 0
//
// (3) is deliberate: a missing secret must not turn CI red
// on a fork or a first-time clone. It is loud, not silent —
// the run prints a SKIPPED banner and writes a report.json
// whose status says so.
// =====================================================
const fs = require('fs');
const path = require('path');

const LOCAL_FILE = path.join(__dirname, '..', 'accounts.local.json');
const ENV_VAR = 'HEALTHDROP_E2E_ACCOUNTS';

const VALID_ROLES = new Set([
  'super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer',
]);

function parse(raw, origin) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${origin} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${origin} must be a JSON array of { role, email, password }`);
  }
  const out = new Map();
  parsed.forEach((entry, i) => {
    const { role, email, password } = entry || {};
    if (!role || !email || !password) {
      throw new Error(`${origin}[${i}] needs role, email and password`);
    }
    if (!VALID_ROLES.has(role)) {
      throw new Error(`${origin}[${i}] has unknown role "${role}" — expected one of ${[...VALID_ROLES].join(', ')}`);
    }
    out.set(role, { role, email: String(email), password: String(password) });
  });
  return out;
}

/**
 * @returns {{ accounts: Map<string,{role,email,password}>, source: string }
 *          | { accounts: null, source: null, skipReason: string }}
 */
function loadAccounts() {
  const fromEnv = process.env[ENV_VAR];
  if (fromEnv && fromEnv.trim()) {
    return { accounts: parse(fromEnv, `$${ENV_VAR}`), source: `env:${ENV_VAR}` };
  }
  if (fs.existsSync(LOCAL_FILE)) {
    return {
      accounts: parse(fs.readFileSync(LOCAL_FILE, 'utf8'), 'e2e/accounts.local.json'),
      source: 'file:e2e/accounts.local.json',
    };
  }
  return {
    accounts: null,
    source: null,
    skipReason:
      `no test credentials found. Set $${ENV_VAR} (a JSON array of ` +
      `{role,email,password}) or create e2e/accounts.local.json ` +
      `(copy e2e/accounts.example.json). See e2e/README.md.`,
  };
}

module.exports = { loadAccounts, ENV_VAR, LOCAL_FILE };
