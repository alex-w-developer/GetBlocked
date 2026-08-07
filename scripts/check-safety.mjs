import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  "manifest.json",
  "background.js",
  "content-script.js",
  "decoy-bridge.js",
  "decoy-interceptor.js",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "rules/rules.json",
  "shared/config.js",
  "shared/decoy-transform.js",
  "shared/tracker-catalog.json",
  "shared/tracking-params.json",
  "scripts/generate-rules.mjs",
  "scripts/evaluate-test-set.mjs",
  "test/tracker-test-set.json"
];
const forbidden = [
  "declarativeNetRequestFeedback",
  "webRequestBlocking",
  "onRuleMatchedDebug",
  "getMatchedRules",
  "privacyScore",
  "privacy-score"
];
const remoteCallPatterns = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bsendBeacon\b/
];
const allowedRuntimeInterceptors = new Set(["decoy-interceptor.js"]);
const allowedPermissions = new Set([
  "declarativeNetRequest",
  "storage",
  "webNavigation"
]);

let failed = false;

for (const file of sourceFiles) {
  const text = fs.readFileSync(path.join(rootDir, file), "utf8");
  for (const term of forbidden) {
    if (text.includes(term)) {
      console.error(`${file}: forbidden term "${term}"`);
      failed = true;
    }
  }
  for (const pattern of remoteCallPatterns) {
    if (pattern.test(text) && !allowedRuntimeInterceptors.has(file)) {
      console.error(`${file}: possible external runtime call ${pattern}`);
      failed = true;
    }
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
for (const permission of manifest.permissions || []) {
  if (!allowedPermissions.has(permission)) {
    console.error(`manifest.json: unexpected permission "${permission}"`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("Safety checks OK");
