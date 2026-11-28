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
  const filesWithVersions = ["manifest.json", "package.json"];
  for (const file of filesWithVersions) {
    const version = parsed[file]?.version;
    const parts = typeof version === "string" ? version.split(".") : [];
    if (parts.length !== 3 || version === "0.0.0" ||
        parts.some(part => !/^(0|[1-9][0-9]*)$/.test(part) || Number(part) > 65535)) {
      console.error(`Invalid version in ${file}: ${JSON.stringify(version) ?? "missing"}`);
      failed = true;
    }
  }

  const manifestVersion = parsed["manifest.json"]?.version;
  const packageVersion = parsed["package.json"]?.version;
  if (manifestVersion !== packageVersion) {
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
