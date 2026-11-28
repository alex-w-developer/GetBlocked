/**
 * GetBlocked! browser test harness.
 *
 * Uses only Node.js built-ins and Chrome's remote debugging protocol (CDP).
 * No npm packages required.
 *
 * What it tests:
 *   1. Tracking URL parameters are removed from the final page URL by the
 *      extension's declarativeNetRequest redirect rules.
 *   2. The extension background service worker returns a report with
 *      reasonable (nonzero total activity) values and a clearly labeled badge.
 *   3. The popup exposes an experimental Decoy Mode toggle and privacy warning.
 *   4. Decoy Mode keeps URL cleanup on, disables only tracker blocking, reuses
 *      one session profile, counts modified requests, and avoids false blocks.
 *   5. Turning Decoy Mode off through the popup restores normal blocking.
 *   6. No uncaught runtime exceptions are thrown by the extension.
 *   7. The optional community list blocks local test traffic, including in
 *      Decoy Mode, without ever connecting to the contributor's domains.
 *
 * Usage:
 *   node scripts/browser-test.mjs
 *
 * Environment variables:
 *   CHROME_PATH   – override Chromium-family browser executable path
 *   TEST_PORT     – override local static server port (default 8765)
 *   DEBUG_PORT    – override Chrome CDP remote debugging port (default 9333)
 *   CHROME_NO_SANDBOX – set to 1 only on an isolated CI runner that needs it
 *   Required mode: pass --required to fail instead of skipping if unavailable.
 */

import "../shared/config.js";
import "../shared/tracker-scope.js";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { openCdpSession } from "./browser-cdp.mjs";
import { selectExtensionTarget } from "./browser-targets.mjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_PORT = Number(process.env.TEST_PORT) || 8765;
const DEBUG_PORT = Number(process.env.DEBUG_PORT) || 9333;
const WAIT_MS = 3500; // ms to wait for extension content script after navigation
const REQUIRED = process.argv.includes("--required");

/** Tracking params the extension should strip (subset to check). */
const PARAMS_TO_STRIP = ["utm_source", "utm_medium", "fbclid", "gclid"];

/** URL loaded in the browser, with tracking params the extension should clean. */
const TEST_PATH = "/test/manual-test.html";
const TEST_PARAMS = "utm_source=test&utm_medium=browser&fbclid=abc123&gclid=xyz789&ref=invite42&ref=chapter2&route=reader";
const COMMUNITY_HOST = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/unsafe-domains.json"), "utf8")).domains[0];

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

const PREFIX = "[browser-test]";

function log(...args) {
  console.log(PREFIX, ...args);
}

function pass(label) {
  console.log(`${PREFIX} \u2705  PASS  ${label}`);
}

function fail(label, detail = "") {
  console.error(`${PREFIX} \u274c  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
}

function warn(...args) {
  console.warn(`${PREFIX} \u26a0\ufe0f `, ...args);
}

// ---------------------------------------------------------------------------
// Chrome detection
// ---------------------------------------------------------------------------

/**
 * Returns the path to the Chrome (or Chromium) executable, or null if not found.
 */
function findChrome() {
  if (process.env.CHROME_PATH) {
    return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  }

  const candidates = [
    // Windows: prefer builds that still honor --load-extension in automation.
    "C:\\Program Files\\Google\\Chrome for Testing\\Application\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google\\Chrome for Testing\\Application\\chrome.exe"
    ),
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google\\Chrome\\Application\\chrome.exe"
    ),
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Local static file server
// ---------------------------------------------------------------------------

/**
 * Starts a minimal static file server serving files from `root`.
 * Binds to 127.0.0.1 only. Returns { server }.
 */
function startFileServer(root, port) {
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };

  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!["/package.json", TEST_PATH, "/test/manual-requests.js", "/test/history.html"].includes(urlPath)) {
      res.writeHead(404).end();
      return;
    }
    const targetPath = path.join(root, urlPath);
    const ext = path.extname(targetPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    fs.createReadStream(targetPath).on("error", () => res.destroy()).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve({ server }));
    server.once("error", reject);
  });
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

/** GETs a JSON endpoint from the Chrome CDP HTTP server, retrying on failure. */
async function cdpHttpGet(debugPort, endpoint, retries = 15) {
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${debugPort}${endpoint}`,
          (res) => {
            let body = "";
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => {
              try { resolve(JSON.parse(body)); }
              catch (e) { reject(e); }
            });
          }
        );
        req.on("error", reject);
        req.setTimeout(2000, () => req.destroy(new Error("CDP HTTP timeout")));
      });
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`CDP HTTP GET ${endpoint} failed after ${retries} retries`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function main() {
  let chromeProcess = null;
  let fileServer = null;
  let browserCdp = null;
  let pageCdp = null;
  let secondPageCdp = null;
  let popupCdp = null;
  let extensionCdp = null;
  let decoyModeEnabledByTest = false;
  let tempDir = null;
  let passed = 0;
  let failed = 0;
  let skipped = false;

  function unavailable(reason) {
    if (REQUIRED) {
      fail("Required browser integration test unavailable", reason);
      failed++;
    } else {
      warn(`SKIP: ${reason}. Use Chrome for Testing or set CHROME_PATH.`);
      skipped = true;
    }
  }

  function check(label, condition, detail = "") {
    if (condition) { pass(label); passed++; }
    else { fail(label, detail); failed++; }
  }

  try {
    // ------------------------------------------------------------------
    // 1. Locate Chrome
    // ------------------------------------------------------------------
    const chromePath = findChrome();
    if (!chromePath) {
      unavailable("Chrome executable not found");
      process.exitCode = REQUIRED ? 1 : 0;
      return;
    }
    log("Chrome:", chromePath);

    // ------------------------------------------------------------------
    // 2. Start static file server (must be HTTP, not file://, for DNR rules)
    // ------------------------------------------------------------------
    ({ server: fileServer } = await startFileServer(ROOT, TEST_PORT));
    log(`Local server: http://127.0.0.1:${TEST_PORT}`);

    // ------------------------------------------------------------------
    // 3. Launch Chrome with unpacked extension
    // ------------------------------------------------------------------
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "getblocked-test-"));
    log("Extension:", ROOT);
    log("Temp profile:", tempDir);

    const chromeArgs = [
      `--load-extension=${ROOT}`,
      `--disable-extensions-except=${ROOT}`,
      `--user-data-dir=${tempDir}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-client-side-phishing-detection",
      "--disable-default-apps",
      "--disable-popup-blocking",
      "--headless=new",
      // All fixture names resolve locally even when blocking is turned off.
      "--host-resolver-rules=MAP * 127.0.0.1",
      "--no-proxy-server",
      ...(process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    ];

    chromeProcess = spawn(chromePath, chromeArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    // Capture the browser-level WS URL from Chrome's startup log line.
    let browserWsUrl = null;
    let chromeStderr = "";
    chromeProcess.stderr.on("data", (data) => {
      const line = data.toString();
      chromeStderr = (chromeStderr + line).slice(-4000);
      const m = chromeStderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) browserWsUrl = m[1];
    });

    chromeProcess.on("exit", (code) => {
      if (code !== null && code !== 0) log(`Chrome exited with code ${code}`);
    });
    let launchError = null;
    chromeProcess.on("error", (err) => { launchError = err; });

    // Only the process we spawned can announce this browser's endpoint.
    const launchDeadline = Date.now() + 20000;
    while (!browserWsUrl && Date.now() < launchDeadline && chromeProcess.exitCode === null && !launchError) {
      await sleep(100);
    }
    if (!browserWsUrl) {
      console.error(PREFIX, "Chrome startup diagnostics:", chromeStderr || "(no stderr)");
      throw launchError || new Error("Could not connect to CDP on the launched browser");
    }
    log("Browser WS:", browserWsUrl);

    browserCdp = await openCdpSession(browserWsUrl);

    // Verify the connection works before proceeding
    const versionResult = await browserCdp.send("Browser.getVersion");
    log("Chrome version:", versionResult?.product || "(unknown)");

    // ------------------------------------------------------------------
    // 5. Create a new tab and connect to it at the page level
    // ------------------------------------------------------------------
    const createResult = await browserCdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const tabTargetId = createResult.targetId;
    log("Created tab target:", tabTargetId);

    // Give Chrome a moment to register the new tab
    await sleep(500);

    // Find the page-level WS URL for the tab we just created
    const allTargets = await cdpHttpGet(DEBUG_PORT, "/json/list");
    log(
      "All targets:",
      allTargets.map((t) => `${t.type}:${t.url}`).join(", ")
    );

    const pageTarget =
      allTargets.find((t) => t.id === tabTargetId);

    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error(
        `Could not find page WS URL for tab ${tabTargetId}`
      );
    }

    log("Connecting to page target:", pageTarget.url);
    pageCdp = await openCdpSession(pageTarget.webSocketDebuggerUrl);

    // Capture runtime exceptions
    const runtimeExceptions = [];
    pageCdp.on("Runtime.exceptionThrown", (params) => {
      const desc =
        params?.exceptionDetails?.exception?.description ||
        params?.exceptionDetails?.text ||
        JSON.stringify(params);
      runtimeExceptions.push(desc);
    });

    await pageCdp.send("Runtime.enable");
    await pageCdp.send("Page.enable");

    // Navigate to the test URL with tracking URL parameters.
    // The extension's DNR redirect/queryTransform rules strip them before commit.
    const testUrl = `http://127.0.0.1:${TEST_PORT}${TEST_PATH}?${TEST_PARAMS}`;
    log(`Navigating to: ${testUrl}`);
    await pageCdp.send("Page.navigate", { url: testUrl });

    // Wait for page load + extension content script (runs at document_idle)
    log(`Waiting ${WAIT_MS}ms for page load and content script ...`);
    await sleep(WAIT_MS);

    // ------------------------------------------------------------------
    // 6. Assert: tracking params stripped from the final page URL
    // ------------------------------------------------------------------
    const urlResult = await pageCdp.send("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });

    const finalUrl = urlResult?.result?.value || "";
    log("Final page URL:", finalUrl);

    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    async function probeWorker(target) {
      const session = await openCdpSession(target.webSocketDebuggerUrl);
      try {
        const result = await session.send("Runtime.evaluate", {
          expression: `({ id: chrome.runtime.id,
            name: chrome.runtime.getManifest().name,
            version: chrome.runtime.getManifest().version })`,
          returnByValue: true,
        });
        log("Worker identity:", JSON.stringify(result?.result?.value));
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      } finally {
        session.close();
      }
    }
    const workerDeadline = Date.now() + 8000;
    let swTarget;
    do {
      swTarget = await selectExtensionTarget(await cdpHttpGet(DEBUG_PORT, "/json/list"), manifest, probeWorker);
      if (!swTarget) await sleep(200);
    } while (!swTarget && Date.now() < workerDeadline);
    if (!swTarget) {
      console.error("Browser stderr:", chromeStderr);
      throw new Error("Unpacked extension was not loaded by this browser");
    }

    let finalSearch = "";
    try { finalSearch = new URL(finalUrl).search; } catch { /* ignore */ }

    for (const param of PARAMS_TO_STRIP) {
      const present = new URLSearchParams(finalSearch).has(param);
      check(
        `URL param stripped: ${param}`,
        !present,
        present ? `param still present in final URL: ${finalUrl}` : ""
      );
    }
    check("Generic ref and route parameters preserved",
      JSON.stringify(new URLSearchParams(finalSearch).getAll("ref")) === JSON.stringify(["invite42", "chapter2"]) &&
      new URLSearchParams(finalSearch).get("route") === "reader");

    // ------------------------------------------------------------------
    // 7. Assert: background service worker returns a valid report
    // ------------------------------------------------------------------
    // Identify and connect directly to the extension service worker target.
    const extensionId = swTarget ? new URL(swTarget.url).hostname : null;
    log("Extension ID:", extensionId || "(not found)");

    if (extensionId && swTarget.webSocketDebuggerUrl) {
      extensionCdp = await openCdpSession(swTarget.webSocketDebuggerUrl);
      await extensionCdp.send("Runtime.enable");

      async function evaluateExtension(expression) {
        const result = await extensionCdp.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout: 6000,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      }

      const extensionIdentity = await evaluateExtension(`({
        id: chrome.runtime.id,
        name: chrome.runtime.getManifest().name,
        version: chrome.runtime.getManifest().version
      })`);
      log("Extension identity:", JSON.stringify(extensionIdentity));

      // Ask the unpacked browser's rule engine about synthetic requests, without
      // contacting catalog hosts. A wrong registrable site fails on one boundary.
      const { trackers } = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/tracker-catalog.json"), "utf8"));
      const { isThirdPartyTrackerHost } = globalThis.GetBlockedTrackerScope;
      const siteCases = trackers.flatMap(({ domain, site = domain }) => {
        const suffix = site.slice(site.indexOf(".") + 1);
        return [
          [domain, site], [domain, "sibling." + site],
          ["nested." + domain, "sibling." + site], [domain, "different-site." + suffix]
        ];
      });
      siteCases.push(
        ["api.segment.io.", "other.io"], ["api.segment.io.", "app.segment.io"],
        ["api.segment.io.", "app.segment.io."], ["api.segment.io", "app.segment.io."],
        ["api.segment.io..", "api.segment.io.."], ["api.segment.io..", "app.segment.io.."]
      );
      const expectedCases = siteCases.map(([target, frame]) => [target, frame, isThirdPartyTrackerHost(target, frame)]);
      const mismatches = await evaluateExtension(`(async () => {
        const mismatches = [];
        for (const [requestHost, initiatorHost, expected] of ${JSON.stringify(expectedCases)}) {
          const { matchedRules } = await chrome.declarativeNetRequest.testMatchOutcome({
            url: "https://" + requestHost + "/pixel", initiator: "http://" + initiatorHost, type: "image"
          });
          const blocked = matchedRules.some(rule => rule.rulesetId === "getblocked_static_rules" && rule.ruleId === 1);
          if (blocked !== expected) mismatches.push({ requestHost, initiatorHost, expected, blocked });
        }
        return mismatches;
      })()`);
      check("Catalog site boundaries agree with Chrome DNR for every tracker",
        Array.isArray(mismatches) && mismatches.length === 0, JSON.stringify(mismatches));

      const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
      const popupTargetResult = await browserCdp.send("Target.createTarget", {
        url: popupUrl,
      });
      await sleep(500);
      const popupTargets = await cdpHttpGet(DEBUG_PORT, "/json/list");
      const popupTarget = popupTargets.find(
        (target) => target.id === popupTargetResult.targetId
      );
      if (!popupTarget?.webSocketDebuggerUrl) {
        throw new Error(
          `Could not open the extension popup page: ${popupTargets
            .map((target) => `${target.type}:${target.url}`)
            .join(", ")}`
        );
      }
      popupCdp = await openCdpSession(popupTarget.webSocketDebuggerUrl);
      await popupCdp.send("Runtime.enable");
      await sleep(500);

      async function evaluatePopup(expression) {
        const result = await popupCdp.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout: 6000,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      }

      const switchStyle = `(() => {
        const track = document.querySelector('.switch-track');
        const style = getComputedStyle(track);
        return { track: style.transitionDuration,
          thumb: getComputedStyle(track, '::after').transitionDuration,
          focus: document.activeElement?.id === 'decoy-mode-toggle' &&
            document.activeElement.matches(':focus-visible') &&
            style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 };
      })()`;
      await popupCdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }]
      });
      await popupCdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await popupCdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      const reducedStyle = await evaluatePopup(switchStyle);
      check("Popup: reduced motion removes switch transitions and preserves keyboard focus",
        reducedStyle?.track === "0s" && reducedStyle.thumb === "0s" && reducedStyle.focus,
        JSON.stringify(reducedStyle));
      await popupCdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }]
      });
      const defaultStyle = await evaluatePopup(switchStyle);
      check("Popup: default switch transitions and keyboard focus remain available",
        parseFloat(defaultStyle?.track) > 0 && parseFloat(defaultStyle?.thumb) > 0 && defaultStyle?.focus,
        JSON.stringify(defaultStyle));

      const initialPopup = await evaluatePopup(`({
        checked: document.querySelector("#decoy-mode-toggle")?.checked,
        scope: document.querySelector("#decoy-mode-scope")?.textContent || "",
        description: document.querySelector("#decoy-mode-description")?.textContent || "",
        experimental:
          document.querySelector(".experimental-badge")?.textContent?.trim(),
        estimateLabel:
          document.querySelector("#page-blocked")?.previousElementSibling?.textContent?.trim(),
        statusLive:
          document.querySelector("#status-line")?.getAttribute("aria-live")
      })`);
      check(
        "Popup: experimental Decoy Mode toggle is present and off by default",
        initialPopup?.checked === false &&
          initialPopup?.experimental === "Experimental",
        JSON.stringify(initialPopup)
      );
      check(
        "Popup: normal-mode count is labeled as an estimate",
        initialPopup?.estimateLabel ===
          "Estimated tracker resources on this page",
        JSON.stringify(initialPopup)
      );
      check("Popup: global scope is explained before enabling Decoy Mode",
        initialPopup?.scope.includes("all websites") &&
        initialPopup.scope.includes("pauses tracker blocking everywhere") &&
        initialPopup.description.includes("all websites"), JSON.stringify(initialPopup)
      );
      check("Popup: status updates use a polite live region",
        initialPopup?.statusLive === "polite",
        JSON.stringify(initialPopup)
      );

      const initialCommunity = await evaluatePopup(`({
        checked: document.querySelector('#unsafe-domains-toggle')?.checked,
        disabled: document.querySelector('#unsafe-domains-toggle')?.disabled,
        scope: document.querySelector('#unsafe-domains-scope')?.textContent || ''
      })`);
      check("Community list: popup is off by default and explains unverified reports",
        initialCommunity?.checked === false && initialCommunity.disabled === false &&
        initialCommunity.scope.includes('unverified') && initialCommunity.scope.includes('Decoy Mode'),
        JSON.stringify(initialCommunity));
      const communityUrl = `http://${COMMUNITY_HOST}:${TEST_PORT}/package.json`;
      const childCommunityUrl = `http://child.${COMMUNITY_HOST}:${TEST_PORT}/package.json`;
      const localFetch = url => evaluatePopup(`(async () => {
        try {
          const response = await fetch(${JSON.stringify(url)});
          return { loaded: response.ok, name: (await response.json()).name };
        } catch { return { loaded: false }; }
      })()`);
      const privatePathStatus = await evaluatePopup(`fetch("http://127.0.0.1:${TEST_PORT}/.git/config").then(response => response.status)`);
      check("Fixture server serves only explicit test files", privatePathStatus === 404);
      const allowedCommunity = await localFetch(communityUrl);
      check("Community list: disabled rules allow the locally mapped host",
        allowedCommunity?.loaded === true && allowedCommunity.name === 'getblocked', JSON.stringify(allowedCommunity));
      const enabledCommunity = await evaluatePopup(`(async () => {
        const toggle = document.querySelector('#unsafe-domains-toggle');
        toggle.click();
        await new Promise(resolve => setTimeout(resolve, 400));
        return { checked: toggle.checked, disabled: toggle.disabled };
      })()`);
      const communityRulesets = await evaluateExtension(`chrome.declarativeNetRequest.getEnabledRulesets()`);
      check("Community list: popup enables the separate ruleset",
        enabledCommunity?.checked === true && enabledCommunity.disabled === false &&
        communityRulesets?.includes('getblocked_unsafe_domains') && communityRulesets.includes('getblocked_static_rules'),
        JSON.stringify({ enabledCommunity, communityRulesets }));
      check("Community list: blocks listed hosts and subdomains",
        (await localFetch(communityUrl))?.loaded === false && (await localFetch(childCommunityUrl))?.loaded === false);
      const blockedNavigation = await pageCdp.send("Page.navigate", { url: `${communityUrl}?utm_source=test` });
      check("Community list: blocks top-level visits before URL cleanup",
        blockedNavigation.errorText === 'net::ERR_BLOCKED_BY_CLIENT', JSON.stringify(blockedNavigation));
      // Restore the original page for the existing tracker and Decoy checks.
      await pageCdp.send("Page.navigate", { url: testUrl });
      await sleep(WAIT_MS);

      const tabId = await evaluateExtension(`
        (async () => {
          const tabs = await chrome.tabs.query({});
          return tabs.find((tab) =>
            String(tab.url || "").includes("/test/manual-test.html")
          )?.id ?? -1;
        })()
      `);
      const report = await evaluateExtension(`
        getReport(${JSON.stringify(tabId)}).then((report) => ({ ok: true, report }))
      `);

      log("Background report:", JSON.stringify(report));

      if (report?.ok) {
        check(
          "Background report: ok === true",
          report.ok === true,
          JSON.stringify(report)
        );
        check(
          "Background report: localOnly flag present",
          report.report?.localOnly === true,
          JSON.stringify(report?.report)
        );

        // manual-test.html has a tracking pixel, iframe, tracker scripts, and
        // a link with tracking params — at least one signal should be nonzero.
        const page = report.report?.page || {};
        const totalActivity =
          (page.trackerElementsDetected || 0) +
          (page.trackingLinksDetected || 0) +
          (page.estimatedTrackerRequests || 0) +
          (page.trackingParamsRemoved || 0);

        check(
          "Background report: nonzero page activity",
          totalActivity > 0,
          `totalActivity=${totalActivity}, page=${JSON.stringify(page)}`
        );

        const normalBadgeText = await evaluateExtension(`
          chrome.action.getBadgeText({ tabId: ${JSON.stringify(tabId)} })
        `);
        const normalActionTitle = await evaluateExtension(`
          chrome.action.getTitle({ tabId: ${JSON.stringify(tabId)} })
        `);
        check(
          "Background report: badge matches blocked estimate",
          normalBadgeText === String(page.blockedOnPage || ""),
          `badge=${JSON.stringify(normalBadgeText)}, blocked=${page.blockedOnPage}`
        );
        check(
          "Background report: badge title identifies the estimated count",
          normalActionTitle ===
            `Estimated tracker resources on this page: ${page.blockedOnPage || 0}`,
          `title=${JSON.stringify(normalActionTitle)}, blocked=${page.blockedOnPage}`
        );
      } else {
        check("Background report: valid response", false, JSON.stringify(report));
      }

      // Verify the estimate through the same report endpoint as the popup. A fresh
      // document would also scan successfully, so require a persisted pageshow.
      const historyUrl = `http://127.0.0.1:${TEST_PORT}/test/history.html`;
      const historyReport = () => evaluatePopup(`chrome.runtime.sendMessage({
        type: 'GETBLOCKED_REPORT', tabId: ${JSON.stringify(tabId)}
      }).then(response => response.report?.page.blockedOnPage)`);
      const historyBadge = () => evaluateExtension(`chrome.action.getBadgeText({tabId: ${JSON.stringify(tabId)}})`);
      async function waitForHistoryCount(count) {
        for (let attempt = 0; attempt < 50; attempt++) {
          if (await historyReport() === count && await historyBadge() === String(count || "")) return true;
          await sleep(100);
        }
        return false;
      }
      await pageCdp.send("Page.navigate", { url: historyUrl });
      check("History: fresh document reports its tracker estimate", await waitForHistoryCount(1));
      const history = await pageCdp.send("Page.getNavigationHistory");
      await pageCdp.send("Page.navigate", { url: "about:blank" });
      check("History: navigating away clears the estimate and badge", await waitForHistoryCount(0));
      await pageCdp.send("Page.navigateToHistoryEntry", { entryId: history.entries[history.currentIndex].id });
      const recovered = await waitForHistoryCount(1);
      const persisted = await pageCdp.send("Runtime.evaluate", {
        expression: "document.documentElement.dataset.restored", returnByValue: true
      });
      check("History: Chrome restored the cached document", persisted.result.value === "true");
      check("History: the restored page repopulates the popup report and badge", recovered);
      await pageCdp.send("Page.navigate", { url: testUrl });
      await sleep(WAIT_MS);

      const fixturePolicy = await pageCdp.send("Runtime.evaluate", {
        expression: 'document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\').content',
        returnByValue: true
      });
      check("Manual fixture restricts scripts to its own origin and denies external connections",
        fixturePolicy.result.value.split(";").map(part => part.trim()).includes("default-src 'none'") &&
        fixturePolicy.result.value.includes("script-src 'self'") &&
        !fixturePolicy.result.value.includes("connect-src"));
      const enabledPopup = await evaluatePopup(`
        (async () => {
          const toggle = document.querySelector("#decoy-mode-toggle");
          toggle.click();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return {
            checked: toggle.checked,
            description: document.querySelector("#decoy-mode-description")?.textContent || "",
            status: document.querySelector("#status-line")?.textContent || ""
          };
        })()
      `);
      decoyModeEnabledByTest =
        enabledPopup?.checked === true &&
        enabledPopup?.status.includes("IP address");
      check(
        "Popup: Decoy Mode enabled with network privacy warning",
        decoyModeEnabledByTest,
        JSON.stringify(enabledPopup)
      );
      check("Popup: enabled mode warns that blocking is paused on all websites",
        enabledPopup?.description.includes("On for all websites") &&
        enabledPopup.status.includes("paused on all websites"), JSON.stringify(enabledPopup));

      const disabledRuleIds = await evaluateExtension(`
        chrome.declarativeNetRequest.getDisabledRuleIds({
          rulesetId: "getblocked_static_rules"
        })
      `);
      check(
        "Decoy Mode: blocking rule disabled and cleanup rule enabled",
        Array.isArray(disabledRuleIds) &&
          disabledRuleIds.includes(1) &&
          !disabledRuleIds.includes(1000),
        JSON.stringify(disabledRuleIds)
      );
      check("Community list: remains enabled and blocks locally mapped requests during Decoy Mode",
        (await evaluateExtension(`getUnsafeDomainBlocking()`)) === true &&
        (await localFetch(communityUrl))?.loaded === false);

      const firstConfiguration = await evaluateExtension(`
        getDecoyConfiguration().then((configuration) => ({
          ok: true,
          configuration
        }))
      `);
      const secondConfiguration = await evaluateExtension(`
        getDecoyConfiguration().then((configuration) => ({
          ok: true,
          configuration
        }))
      `);
      check(
        "Decoy Mode: one coherent session profile",
        firstConfiguration?.configuration?.profile?.userId &&
          firstConfiguration.configuration.profile.userId ===
            secondConfiguration?.configuration?.profile?.userId,
        JSON.stringify({ firstConfiguration, secondConfiguration })
      );

      const secondTarget = await browserCdp.send("Target.createTarget", {
        url: `http://localhost:${TEST_PORT}${TEST_PATH}?ref=second-site`
      });
      await sleep(WAIT_MS);
      const secondTargets = await cdpHttpGet(DEBUG_PORT, "/json/list");
      const secondWorker = secondTargets.find(target => target.id === secondTarget.targetId);
      if (!secondWorker?.webSocketDebuggerUrl) throw new Error("Second site target not found");
      secondPageCdp = await openCdpSession(secondWorker.webSocketDebuggerUrl);
      const secondTabId = await evaluateExtension(`(async () => {
        const tabs = await chrome.tabs.query({});
        return tabs.find(tab => String(tab.url || '').startsWith('http://localhost:${TEST_PORT}/'))?.id;
      })()`);
      async function exerciseDecoy(pageSession, id) {
        const click = await pageSession.send("Runtime.evaluate", {
          expression: 'document.querySelector("#exercise-decoy").click()'
        });
        if (click.exceptionDetails) throw new Error("Unable to run Decoy fixture");
        let report;
        for (let attempt = 0; attempt < 50; attempt++) {
          report = await evaluateExtension(`getReport(${JSON.stringify(id)})`);
          if (report?.page.decoyedRequests > 0) break;
          await sleep(100);
        }
        return report;
      }
      const secondReport = await exerciseDecoy(secondPageCdp, secondTabId);
      check("Decoy Mode: global preference applies to a different site",
        secondReport?.decoyMode === true && secondReport.page?.decoyedRequests > 0,
        JSON.stringify(secondReport));
      await browserCdp.send("Target.activateTarget", { targetId: secondTarget.targetId });
      await popupCdp.send("Page.reload");
      await sleep(500);
      const reopenedPopup = await evaluatePopup(`({
        checked: document.querySelector('#decoy-mode-toggle')?.checked,
        description: document.querySelector('#decoy-mode-description')?.textContent || '',
        status: document.querySelector('#status-line')?.textContent || ''
      })`);
      check("Popup: reopening for another site retains the global warning",
        reopenedPopup?.checked === true && reopenedPopup.description.includes("all websites") &&
        reopenedPopup.status.includes("paused on all websites"), JSON.stringify(reopenedPopup));

      await pageCdp.send("Page.navigate", { url: testUrl });
      await sleep(WAIT_MS);

      const decoyUrlResult = await pageCdp.send("Runtime.evaluate", {
        expression: "location.href",
        returnByValue: true,
      });
      const decoyPageUrl = decoyUrlResult?.result?.value || "";
      const decoySearch = new URL(decoyPageUrl).searchParams;
      check(
        "Decoy Mode: URL cleanup remains enabled",
        PARAMS_TO_STRIP.every((param) => !decoySearch.has(param)),
        decoyPageUrl
      );
      check("Decoy Mode: generic ref and route parameters preserved",
        JSON.stringify(decoySearch.getAll("ref")) === JSON.stringify(["invite42", "chapter2"]) &&
        decoySearch.get("route") === "reader");

      const decoyReport = await exerciseDecoy(pageCdp, tabId);
      check(
        "Decoy Mode: modified requests counted without false blocks",
        decoyReport?.decoyMode === true &&
          decoyReport?.page?.decoyedRequests > 0 &&
          decoyReport?.page?.blockedOnPage === 0,
        JSON.stringify(decoyReport)
      );
      const decoyBadgeText = await evaluateExtension(`
        chrome.action.getBadgeText({ tabId: ${JSON.stringify(tabId)} })
      `);
      const decoyActionTitle = await evaluateExtension(`
        chrome.action.getTitle({ tabId: ${JSON.stringify(tabId)} })
      `);
      check(
        "Decoy Mode: badge matches decoyed request count",
        decoyBadgeText ===
          String(decoyReport?.page?.decoyedRequests || ""),
        `badge=${JSON.stringify(decoyBadgeText)}, report=${JSON.stringify(decoyReport)}`
      );
      check(
        "Decoy Mode: badge title identifies the decoyed request count",
        decoyActionTitle ===
          `Reported Decoy replacements on this page: ${decoyReport?.page?.decoyedRequests || 0}`,
        `title=${JSON.stringify(decoyActionTitle)}, report=${JSON.stringify(decoyReport)}`
      );

      const disabledPopup = await evaluatePopup(`
        (async () => {
          const toggle = document.querySelector("#decoy-mode-toggle");
          toggle.click();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return {
            checked: toggle.checked,
            status: document.querySelector("#status-line")?.textContent || ""
          };
        })()
      `);
      const disabledConfiguration = await evaluateExtension(`
        getDecoyConfiguration()
      `);
      decoyModeEnabledByTest = disabledConfiguration?.enabled === true;
      check(
        "Popup: normal blocking restored and setting saved",
        disabledPopup?.checked === false &&
          disabledConfiguration?.enabled === false,
        JSON.stringify({ disabledPopup, disabledConfiguration })
      );
      const restoredReports = await evaluateExtension(`Promise.all([
        getReport(${JSON.stringify(tabId)}), getReport(${JSON.stringify(secondTabId)})
      ])`);
      const restoredRuleIds = await evaluateExtension(`chrome.declarativeNetRequest.getDisabledRuleIds({
        rulesetId: 'getblocked_static_rules'
      })`);
      check("Decoy Mode: disabling restores catalog blocking on both sites",
        restoredReports?.length === 2 && restoredReports.every(report => report.decoyMode === false) &&
        Array.isArray(restoredRuleIds) && !restoredRuleIds.includes(1) && !restoredRuleIds.includes(1000),
        JSON.stringify({ restoredReports, restoredRuleIds }));
      await popupCdp.send("Page.reload");
      await sleep(500);
      const restoredCommunity = await evaluatePopup(`document.querySelector('#unsafe-domains-toggle')?.checked`);
      check("Community list: reopening popup reflects the saved enabled state", restoredCommunity === true);
      await evaluatePopup(`(async () => {
        document.querySelector('#unsafe-domains-toggle').click();
        await new Promise(resolve => setTimeout(resolve, 400));
      })()`);
      const disabledCommunity = await localFetch(communityUrl);
      check("Community list: disabling restores access without disabling tracker rules",
        disabledCommunity?.loaded === true && disabledCommunity.name === 'getblocked' &&
        (await evaluateExtension(`chrome.declarativeNetRequest.getEnabledRulesets()`))?.includes('getblocked_static_rules'));
    } else {
      warn(
        "Could not determine extension ID from service-worker target.\n" +
          "         Skipping background report check."
      );
      check("Background report: extension loaded", false);
    }

    // ------------------------------------------------------------------
    // 8. Assert: no unexpected runtime exceptions in the page
    // ------------------------------------------------------------------
    check(
      "No unexpected runtime exceptions",
      runtimeExceptions.length === 0,
      runtimeExceptions.slice(0, 3).join(" | ")
    );

  } catch (err) {
    // Graceful skip for known unsupported environments
    if (passed === 0 && failed === 0 &&
      err.message &&
      (err.message.includes("Timed out waiting for port") ||
        err.message.includes("Could not connect to CDP") ||
        err.message.includes("Unpacked extension was not loaded") ||
        err.message.includes("headless"))
    ) {
      unavailable(err.message);
    } else {
      console.error(PREFIX, "Unexpected error:", err);
      failed++;
    }
  } finally {
    // ------------------------------------------------------------------
    // Cleanup: close CDP connections, kill Chrome, clean up temp dir
    // ------------------------------------------------------------------
    if (extensionCdp && decoyModeEnabledByTest) {
      try {
        await extensionCdp.send("Runtime.evaluate", {
          expression: `setDecoyMode(false)`,
          awaitPromise: true,
          returnByValue: true,
        });
      } catch { /* Temp profile cleanup also discards the setting. */ }
    }
    if (popupCdp) { try { popupCdp.close(); } catch { /* ignore */ } }
    if (extensionCdp) { try { extensionCdp.close(); } catch { /* ignore */ } }
    if (pageCdp) { try { pageCdp.close(); } catch { /* ignore */ } }
    if (secondPageCdp) { try { secondPageCdp.close(); } catch { /* ignore */ } }
    if (browserCdp) { try { browserCdp.close(); } catch { /* ignore */ } }

    if (chromeProcess) {
      try { chromeProcess.kill(); } catch { /* ignore */ }
      await sleep(500); // Allow Chrome to release file handles before rmSync
    }

    if (fileServer) { fileServer.close(() => {}); }

    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); }
      catch { /* Windows may briefly lock files after Chrome exits */ }
    }
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  if (skipped) {
    log("SKIP: Browser test did not run in this environment.");
    process.exit(0);
  }

  log("");
  log(`Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    log("All checks passed. \u2728");
    process.exit(0);
  } else {
    console.error(PREFIX, `${failed} check(s) failed.`);
    process.exit(1);
  }
}

main();
