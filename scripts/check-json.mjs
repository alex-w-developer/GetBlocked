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

const parsed = {};
let failed = false;

for (const file of files) {
  try {
    parsed[file] = JSON.parse(fs.readFileSync(path.join(rootDir, file), "utf8"));
  } catch (error) {
    console.error(`JSON validation failed for ${file}: ${error.message}`);
    failed = true;
    break;
  }
}

if (!failed) {
  const manifestVersion = parsed["manifest.json"].version;
  const packageVersion = parsed["package.json"].version;
  if (manifestVersion !== undefined && packageVersion !== undefined && manifestVersion !== packageVersion) {
    console.error(
      `Version mismatch: manifest.json has version "${manifestVersion}" but package.json has version "${packageVersion}"`
    );
    failed = true;
  }
}

if (!failed) {
  console.log(`JSON OK (${files.length} files)`);
} else {
  process.exitCode = 1;
}
