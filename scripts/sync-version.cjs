const fs = require('fs');
const path = require('path');

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const appJsonPath = path.join(root, 'app.json');

const version = process.argv[2];
const buildNumberArg = process.argv[3];

if (!version || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/sync-version.cjs <version> [buildNumber]');
  process.exit(1);
}

const buildNumber = Number.isFinite(Number(buildNumberArg)) && Number(buildNumberArg) > 0
  ? Number(buildNumberArg)
  : Number(process.env.GITHUB_RUN_NUMBER || 1);

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
appJson.expo = appJson.expo || {};
appJson.expo.version = version;

appJson.expo.android = appJson.expo.android || {};
appJson.expo.android.versionCode = buildNumber;

appJson.expo.ios = appJson.expo.ios || {};
appJson.expo.ios.buildNumber = String(buildNumber);

fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`, 'utf8');

console.log(`Updated versions: package.json/app.json => ${version} (build ${buildNumber})`);
