// Run IBM openapi-validator on the *-enhanced.yaml specs, ignoring IBM Cloud style rules
// that do not fit third-party Aspera APIs. Usage: npm run lint [-- <file>...]
const { spawnSync } = require('child_process');
const fs = require('fs');

const IGNORED = new Set([
  'ibm-integer-attributes', 'ibm-string-attributes', 'ibm-array-attributes',
  'ibm-enum-casing-convention', 'ibm-property-casing-convention', 'ibm-parameter-casing-convention',
  'ibm-operationid-casing-convention', 'ibm-operationid-naming-convention',
  'ibm-required-enum-properties-in-response', 'ibm-required-array-properties-in-response',
  'ibm-avoid-inline-schemas', 'ibm-no-nullable-properties', 'ibm-success-response-example',
  'ibm-request-and-response-content', 'ibm-no-array-responses', 'ibm-accept-and-return-models',
]);

const args = process.argv.slice(2);
const files = args.length ? args : fs.readdirSync('.').filter((f) => f.endsWith('-enhanced.yaml'));
let failed = false;
for (const file of files) {
  const r = spawnSync('npx', ['lint-openapi', '-j', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  let report;
  try { report = JSON.parse(r.stdout); } catch { console.error(`${file}: ${r.stderr || r.stdout}`); failed = true; continue; }
  console.log(`== ${file}`);
  for (const sev of ['error', 'warning']) {
    for (const i of report[sev]?.results ?? []) {
      if (IGNORED.has(i.rule)) continue;
      if (sev === 'error') failed = true;
      console.log(`  ${sev} line ${i.line} [${i.rule}] ${i.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
