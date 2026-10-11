import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultRootDir;
const files = [
  "manifest.json",
  "rules/rules.json",
  "rules/unsafe.json",
  "shared/unsafe-domains.json",
  "shared/tracker-catalog.json",
  "shared/tracking-params.json",
  "test/tracker-test-set.json",
  "package.json"
];

for (const file of files) {
  try {
    JSON.parse(fs.readFileSync(path.join(rootDir, file), "utf8"));
  } catch (error) {
    console.error(`JSON validation failed for ${file}: ${error.message}`);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`JSON OK (${files.length} files)`);
}
