import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "manifest.json",
  "rules/rules.json",
  "shared/tracker-catalog.json",
  "shared/tracking-params.json",
  "test/tracker-test-set.json",
  "package.json"
];

for (const file of files) {
  JSON.parse(fs.readFileSync(path.join(rootDir, file), "utf8"));
}

console.log(`JSON OK (${files.length} files)`);
