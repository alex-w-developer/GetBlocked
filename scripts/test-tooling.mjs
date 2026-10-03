import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { findCatalogOverlaps } from "./catalog-overlaps.mjs";
import { selectExtensionTarget } from "./browser-targets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const entry = (domain, extra = {}) => ({ domain, category: "Analytics", label: domain, ...extra });

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getblocked-tooling-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.ifError(result.error);
  return { ...result, output: result.stdout + result.stderr };
}

function generatorFixture(t, trackers) {
  const dir = tempDir(t);
  for (const folder of ["scripts", "shared", "rules"]) fs.mkdirSync(path.join(dir, folder));
  for (const file of ["generate-rules.mjs", "catalog-overlaps.mjs"]) {
    fs.copyFileSync(path.join(root, "scripts", file), path.join(dir, "scripts", file));
  }
  fs.writeFileSync(path.join(dir, "shared/tracking-params.json"), '["utm_source"]');
  fs.writeFileSync(path.join(dir, "shared/tracker-catalog.json"), JSON.stringify({ trackers }));
  return dir;
}

test("generator rejects duplicate domains before creating outputs", (t) => {
  for (const duplicate of ["tracker.example.test", " TRACKER.EXAMPLE.TEST "]) {
    const dir = generatorFixture(t, [entry("tracker.example.test"), entry(duplicate)]);
    const result = run(path.join(dir, "scripts/generate-rules.mjs"));
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Duplicate tracker domain in catalog: tracker\.example\.test/);
    for (const file of ["rules/rules.json", "shared/config.js"]) {
      assert.equal(fs.existsSync(path.join(dir, file)), false);
    }
  }
});

test("generator guards preserve existing outputs and reject broad domains", (t) => {
  for (const trackers of [
    [entry("tracker.example.test"), entry(" TRACKER.EXAMPLE.TEST ")],
    [entry("google.com")]
  ]) {
    for (const existingOutputs of [false, true]) {
      const dir = generatorFixture(t, trackers);
      const outputs = ["rules/rules.json", "shared/config.js"];
      if (existingOutputs) for (const output of outputs) fs.writeFileSync(path.join(dir, output), "sentinel\n");
      const result = run(path.join(dir, "scripts/generate-rules.mjs"));
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, trackers.length === 1
        ? /Refusing broad high-breakage domain: google\.com/
        : /Duplicate tracker domain in catalog: tracker\.example\.test/);
      for (const output of outputs) {
        if (existingOutputs) assert.equal(fs.readFileSync(path.join(dir, output), "utf8"), "sentinel\n");
        else assert.equal(fs.existsSync(path.join(dir, output)), false);
      }
    }
  }
});

test("evidence CLI rejects missed trackers and false positives, reporting every failure", (t) => {
  const dir = tempDir(t);
  const fixturePath = path.join(dir, "evidence.json");
  const trackerDomain = readJson("rules/rules.json").find(r => r.action.type === "block").condition.requestDomains[0];
  for (const kinds of [[true], [false], [true, false]]) {
    const requests = kinds.map(tracker => ({
      url: tracker ? "https://unlisted.example.test/collect" : `https://${trackerDomain}/collect`,
      type: "xmlhttprequest", tracker
    }));
    fs.writeFileSync(fixturePath, JSON.stringify({ name: "Mutation", landingUrls: [], pages: [
      { name: "Regression fixture", topUrl: "https://site.example.test/", requests }
    ] }));
    const result = run(path.join(root, "scripts/evaluate-test-set.mjs"), [fixturePath]);
    assert.equal(result.status, 1, result.output);
    for (const request of requests) {
      assert.ok(result.output.includes(request.url), result.output);
      assert.ok(result.output.includes(`expected ${request.tracker ? "blocked" : "unblocked"}`), result.output);
    }
    assert.equal((result.output.match(/FAIL: Regression fixture/g) || []).length, requests.length);
  }
});

test("evidence CLI keeps successful coverage output", () => {
  const result = run(path.join(root, "scripts/evaluate-test-set.mjs"));
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Category coverage:/);
  assert.match(result.output, /Reduction: 100.0%/);
  assert.match(result.output, /PASS:/);
});

test("evidence CLI enforces exact landing URL expectations", (t) => {
  const dir = tempDir(t);
  const fixturePath = path.join(dir, "landing.json");
  const url = "https://app.example.test/invite?ref=invite42&utm_source=mail";
  for (const [expectedUrl, status] of [
    ["https://app.example.test/invite?ref=invite42", 0],
    ["https://app.example.test/invite", 1],
    [url, 1]
  ]) {
    fs.writeFileSync(fixturePath, JSON.stringify({ name: "Landing regression", pages: [], landingUrls: [],
      landingUrlChecks: [{ url, expectedUrl }] }));
    const result = run(path.join(root, "scripts/evaluate-test-set.mjs"), [fixturePath]);
    assert.equal(result.status, status, result.output);
    if (status) assert.match(result.output, /FAIL: landing URL.*expected.*got/);
  }
});

test("browser CLI skips locally and fails in required mode when Chrome is missing", (t) => {
  const dir = tempDir(t);
  for (const required of [false, true]) {
    const result = spawnSync(process.execPath,
      [path.join(root, "scripts/browser-test.mjs"), ...(required ? ["--required"] : [])], {
        encoding: "utf8", timeout: 10000,
        env: { ...process.env, CHROME_PATH: path.join(dir, "missing-chrome") }
      });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    assert.equal(result.status, required ? 1 : 0, output);
    assert.match(output, required ? /FAIL.*Required browser/ : /SKIP:/);
    assert.doesNotMatch(output, /All checks passed/);
  }
});

test("browser target selection ignores unrelated and stale background workers", async () => {
  const manifest = { name: "GetBlocked!", version: "0.2.0", background: { service_worker: "background.js" } };
  const worker = id => ({ type: "service_worker", url: `chrome-extension://${id}/background.js`, webSocketDebuggerUrl: `ws://${id}` });
  const targets = [worker("unrelated"), worker("stale"), worker("wrong-version"), worker("wrong-id"), worker("getblocked")];
  const probe = async target => {
    const id = new URL(target.url).hostname;
    if (id === "stale") throw new Error("Worker closed");
    return { id: id === "wrong-id" ? "other" : id,
      name: id === "unrelated" ? "Other extension" : manifest.name,
      version: id === "wrong-version" ? "0.1.0" : manifest.version };
  };
  assert.equal(await selectExtensionTarget(targets, manifest, probe), targets[4]);
  assert.equal(await selectExtensionTarget(targets.slice(0, 4), manifest, probe), null);
  assert.equal(await selectExtensionTarget([{ ...worker("getblocked"), type: "page" }], manifest, probe), null);
});

test("JSON checker identifies malformed and missing files and preserves valid output", (t) => {
  const dir = tempDir(t);
  const files = [
    "manifest.json",
    "rules/rules.json",
    "shared/tracker-catalog.json",
    "shared/tracking-params.json",
    "test/tracker-test-set.json",
    "package.json"
  ];
  for (const file of files) {
    const filePath = path.join(dir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{}\n");
  }

  const checker = path.join(root, "scripts/check-json.mjs");
  const valid = run(checker, [dir]);
  assert.equal(valid.status, 0, valid.output);
  assert.match(valid.output, /JSON OK \(6 files\)/);

  fs.writeFileSync(path.join(dir, "manifest.json"), "{ invalid JSON }\n");
  const malformed = run(checker, [dir]);
  assert.equal(malformed.status, 1, malformed.output);
  assert.match(malformed.output, /manifest\.json: .*JSON|manifest\.json: .*position/i);

  fs.rmSync(path.join(dir, "manifest.json"));
  const missing = run(checker, [dir]);
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /manifest\.json: .*ENOENT/);
});

test("content scan resolves relative resources against the document base URI", () => {
  const config = readJson("shared/tracker-catalog.json");
  const trackerDomain = config.trackers[0].domain;
  const source = fs.readFileSync(path.join(root, "content-script.js"), "utf8");

  function scan({ pageUrl, baseURI, elements }) {
    const messages = [];
    const context = vm.createContext({
      chrome: {
        runtime: {
          id: "test-extension",
          sendMessage: message => {
            messages.push(message);
            return Promise.resolve();
          }
        }
      },
      window: {
        location: new URL(pageUrl),
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" })
      },
      document: { baseURI, querySelectorAll: () => elements },
      HTMLElement: class HTMLElement {},
      URL
    });
    vm.runInContext(fs.readFileSync(path.join(root, "shared/config.js"), "utf8"), context);

    for (const element of elements) {
      element.getBoundingClientRect = () => ({ width: 10, height: 10 });
      element.matches = selector => selector === "script,link" ? false : selector.includes("img[src]");
      Object.setPrototypeOf(element, context.HTMLElement.prototype);
    }
    vm.runInContext(source, context);
    return messages[0]?.payload;
  }

  const resource = (src, elementBaseURI) => ({
    baseURI: elementBaseURI,
    hasAttribute: name => name === "src",
    getAttribute: name => name === "src" ? src : null
  });

  const based = scan({
    pageUrl: "https://site.example.test/page",
    baseURI: "https://site.example.test/page",
    elements: [resource("collect", `https://${trackerDomain}/assets/`)]
  });
  assert.equal(based.estimatedTrackerRequests, 1);
  assert.equal(based.trackerElementsDetected, 1);

  const ordinaryPage = scan({
    pageUrl: "https://site.example.test/page",
    baseURI: "https://site.example.test/page",
    elements: [resource("collect")]
  });
  assert.equal(ordinaryPage.estimatedTrackerRequests, 0);
  assert.equal(ordinaryPage.trackerElementsDetected, 0);

  const absolute = scan({
    pageUrl: "https://site.example.test/page",
    baseURI: "https://other.example.test/base/",
    elements: [resource(`https://${trackerDomain}/collect`, "https://other.example.test/base/")]
  });
  assert.equal(absolute.estimatedTrackerRequests, 1);
  assert.equal(absolute.trackerElementsDetected, 1);
});

test("overlap detection handles normalization, ancestors, siblings and suffix boundaries", () => {
  assert.deepEqual(findCatalogOverlaps([
    entry(" Example.com "), entry("A.EXAMPLE.COM"), entry("b.a.example.com"),
    entry("otherexample.com"), entry("example.com.test"), entry("sibling.test")
  ]).map(({ domain, parent }) => [domain, parent]), [
    ["a.example.com", "example.com"],
    ["b.a.example.com", "a.example.com"],
    ["b.a.example.com", "example.com"]
  ]);
  assert.deepEqual(findCatalogOverlaps([entry("a.example.com"), entry("b.example.com")]), []);
});

test("intentional overlaps require a nonempty reason tied to an existing parent", () => {
  const reason = "Preserves a distinct category";
  assert.equal(findCatalogOverlaps([entry("example.com"), entry("a.example.com", { redundancyReason: reason })])[0].reason, reason);
  for (const redundancyReason of ["", "  ", true, null]) {
    assert.throws(() => findCatalogOverlaps([entry("example.com"), entry("a.example.com", { redundancyReason })]), /Invalid or stale/);
  }
  assert.throws(() => findCatalogOverlaps([entry("a.example.com", { redundancyReason: reason })]), /stale/);
});

test("generator rejects unexplained overlaps before writing and retains documented entries deterministically", (t) => {
  const dir = tempDir(t);
  for (const folder of ["scripts", "shared", "rules"]) fs.mkdirSync(path.join(dir, folder));
  for (const file of ["generate-rules.mjs", "catalog-overlaps.mjs"]) {
    fs.copyFileSync(path.join(root, "scripts", file), path.join(dir, "scripts", file));
  }
  fs.writeFileSync(path.join(dir, "shared/tracking-params.json"), '["utm_source"]');
  const catalogPath = path.join(dir, "shared/tracker-catalog.json");
  const trackers = [entry("example.com"), entry("a.example.com")];
  fs.writeFileSync(catalogPath, JSON.stringify({ trackers }));
  const script = path.join(dir, "scripts/generate-rules.mjs");
  const failed = run(script);
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /a.example.com: already covered by example.com/);
  assert.equal(fs.existsSync(path.join(dir, "rules/rules.json")), false);
  trackers[1].redundancyReason = "Keep endpoint category";
  trackers[1].category = "Social pixel";
  fs.writeFileSync(catalogPath, JSON.stringify({ trackers }));
  const passed = run(script);
  assert.equal(passed.status, 0, passed.output);
  assert.match(passed.output, /Retained a.example.com/);
  const outputs = ["rules/rules.json", "shared/config.js"];
  const first = outputs.map(file => fs.readFileSync(path.join(dir, file), "utf8"));
  assert.match(first[1], /"Social pixel": \[\s*"a.example.com"/);
  assert.equal(run(script).status, 0);
  assert.deepEqual(outputs.map(file => fs.readFileSync(path.join(dir, file), "utf8")), first);
});

test("catalog audit retains only explained overlaps and their category mappings", () => {
  const catalog = readJson("shared/tracker-catalog.json");
  const overlaps = findCatalogOverlaps(catalog.trackers);
  for (const overlap of overlaps) assert.ok(overlap.reason);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "shared/config.js"), "utf8"), context);
  const categories = context.GetBlockedConfig.TRACKER_CATEGORIES;
  for (const [host, expected] of [
    ["stats.g.doubleclick.net", ["Ad tracking", "Analytics"]],
    ["static.ads-twitter.com", ["Ad tracking", "Social pixel"]]
  ]) {
    const actual = Object.entries(categories).filter(([, domains]) =>
      domains.some(domain => host === domain || host.endsWith(`.${domain}`))
    ).map(([category]) => category).sort();
    assert.deepEqual(actual, expected);
  }
});
test("global Decoy preference reapplies catalog rules on startup and extension update", async () => {
  const localData = {};
  function startBackground() {
    const listeners = {};
    const event = name => ({ addListener: listener => { listeners[name] = listener; } });
    const area = data => ({
      get: (keys, callback) => callback(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
      set: (items, callback) => { Object.assign(data, items); callback(); },
      remove: (keys, callback) => { for (const key of keys) delete data[key]; callback(); }
    });
    const disabledRules = new Set();
    let rejectRuleUpdate = false;
    const context = vm.createContext({
      console, URL, crypto: globalThis.crypto,
      chrome: {
        runtime: { onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message") },
        storage: { local: area(localData), session: area({}) },
        action: { setBadgeBackgroundColor: () => {}, setBadgeText: (_, callback) => callback(), setTitle: (_, callback) => callback() },
        declarativeNetRequest: {
          setExtensionActionOptions: (_, callback) => callback(),
          updateStaticRules: async ({ disableRuleIds, enableRuleIds }) => {
            if (rejectRuleUpdate) throw new Error("Simulated rule failure");
            for (const id of disableRuleIds) disabledRules.add(id);
            for (const id of enableRuleIds) disabledRules.delete(id);
          }
        },
        webNavigation: { onBeforeNavigate: event("before"), onCommitted: event("committed") },
        tabs: { onRemoved: event("removed") }
      }
    });
    context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
    vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), context);
    return { context, disabledRules,
      rejectRules: () => { rejectRuleUpdate = true; },
      trigger: async name => { listeners[name](); await vm.runInContext("updateQueue", context); } };
  }
  const first = startBackground();
  await vm.runInContext("setDecoyMode(true)", first.context);
  assert.equal(localData.getblockedDecoyMode, true);
  assert.deepEqual([...first.disabledRules], [1]);
  for (const eventName of ["startup", "installed"]) {
    const restarted = startBackground();
    await restarted.trigger(eventName);
    assert.equal(localData.getblockedDecoyMode, true);
    assert.deepEqual([...restarted.disabledRules], [1]);
    await vm.runInContext("setDecoyMode(false)", restarted.context);
    assert.equal(localData.getblockedDecoyMode, false);
    assert.equal(restarted.disabledRules.size, 0);
    const normalRestart = startBackground();
    normalRestart.disabledRules.add(1);
    await normalRestart.trigger(eventName);
    assert.equal(normalRestart.disabledRules.size, 0);
    normalRestart.rejectRules();
    await assert.rejects(vm.runInContext("setDecoyMode(true)", normalRestart.context), /Simulated rule failure/);
    assert.equal(localData.getblockedDecoyMode, false);
    assert.equal(normalRestart.disabledRules.size, 0);
    await vm.runInContext("setDecoyMode(true)", restarted.context);
  }
});
