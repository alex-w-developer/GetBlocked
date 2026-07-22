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
 *      reasonable (nonzero total activity) values.
 *   3. The popup exposes an experimental Decoy Mode toggle and privacy warning.
 *   4. Decoy Mode keeps URL cleanup on, disables only tracker blocking, reuses
 *      one session profile, counts modified requests, and avoids false blocks.
 *   5. Turning Decoy Mode off through the popup restores normal blocking.
 *   6. No uncaught runtime exceptions are thrown by the extension.
 *
 * Usage:
 *   node scripts/browser-test.mjs
 *
 * Environment variables:
 *   CHROME_PATH   – override Chromium-family browser executable path
 *   TEST_PORT     – override local static server port (default 8765)
 *   DEBUG_PORT    – override Chrome CDP remote debugging port (default 9333)
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_PORT = Number(process.env.TEST_PORT) || 8765;
const DEBUG_PORT = Number(process.env.DEBUG_PORT) || 9333;
const WAIT_MS = 3500; // ms to wait for extension content script after navigation

/** Tracking params the extension should strip (subset to check). */
const PARAMS_TO_STRIP = ["utm_source", "utm_medium", "fbclid", "gclid"];

/** URL loaded in the browser, with tracking params the extension should clean. */
const TEST_PATH = "/test/manual-test.html";
const TEST_PARAMS = "utm_source=test&utm_medium=browser&fbclid=abc123&gclid=xyz789";

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
    return process.env.CHROME_PATH;
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
    const urlPath = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    const filePath = path.join(root, urlPath);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (!filePath.startsWith(rootWithSep) && filePath !== root) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    let targetPath = filePath;
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(targetPath, "index.html");
    }
    if (!fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(targetPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    fs.createReadStream(targetPath).pipe(res);
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

/**
 * Opens a CDP WebSocket session using a raw Node.js net.Socket.
 *
 * Per the WebSocket RFC 6455, client frames MUST be masked. Chrome enforces
 * this and also requires --remote-allow-origins=* (or a matching origin) to
 * accept connections from non-browser clients.
 *
 * Returns { send(method, params) → Promise<result>, on(event, fn), close() }
 */
function openCdpSession(wsUrl) {
  // Normalise hostname: Chrome lists "localhost" but binds to 127.0.0.1
  const normUrl = wsUrl.replace(/^ws:\/\/localhost/, "ws://127.0.0.1");
  const url = new URL(normUrl);
  const wsKey = crypto.randomBytes(16).toString("base64");

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: "127.0.0.1", port: Number(url.port) || 9222 },
      () => {
        // No Origin header needed when Chrome is launched with --remote-allow-origins=*
        socket.write(
          [
            `GET ${url.pathname} HTTP/1.1`,
            `Host: 127.0.0.1:${url.port}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${wsKey}`,
            "Sec-WebSocket-Version: 13",
            "",
            "",
          ].join("\r\n")
        );
      }
    );
    socket.once("error", reject);

    let handshakeDone = false;
    let buf = Buffer.alloc(0);
    let idCounter = 1;
    const pending = new Map();
    const eventHandlers = new Map();

    /**
     * Sends a WebSocket text frame with proper RFC 6455 client-side masking.
     * The mask bit MUST be set for client→server frames.
     */
    function sendWsFrame(text) {
      const payload = Buffer.from(text, "utf8");
      const mask = crypto.randomBytes(4);
      const masked = Buffer.allocUnsafe(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ mask[i % 4];
      }
      const len = payload.length;
      let header;
      if (len < 126) {
        // FIN=1, opcode=1 (text), MASK=1
        header = Buffer.from([0x81, 0x80 | len]);
      } else if (len < 65536) {
        header = Buffer.allocUnsafe(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.allocUnsafe(10);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      socket.write(Buffer.concat([header, mask, masked]));
    }

    /**
     * Parses complete WebSocket frames from a Buffer.
     * Server→client frames are NOT masked (mask bit = 0).
     * Returns { frames: [{opcode, payload}], remaining: Buffer }
     */
    function parseFrames(inBuf) {
      const frames = [];
      let offset = 0;
      while (offset + 2 <= inBuf.length) {
        const b0 = inBuf[offset];
        const b1 = inBuf[offset + 1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let headerLen = 2;
        if (payloadLen === 126) {
          if (inBuf.length - offset < 4) break;
          payloadLen = inBuf.readUInt16BE(offset + 2);
          headerLen = 4;
        } else if (payloadLen === 127) {
          if (inBuf.length - offset < 10) break;
          payloadLen = Number(inBuf.readBigUInt64BE(offset + 2));
          headerLen = 10;
        }
        const maskLen = masked ? 4 : 0;
        const frameEnd = offset + headerLen + maskLen + payloadLen;
        if (inBuf.length < frameEnd) break;
        let payload = inBuf.slice(offset + headerLen + maskLen, frameEnd);
        if (masked) {
          const maskBytes = inBuf.slice(
            offset + headerLen,
            offset + headerLen + 4
          );
          payload = Buffer.from(payload.map((b, i) => b ^ maskBytes[i % 4]));
        }
        frames.push({ opcode, payload });
        offset = frameEnd;
      }
      return { frames, remaining: inBuf.slice(offset) };
    }

    function dispatchFrames(frames) {
      for (const { opcode, payload } of frames) {
        if (opcode === 8) {
          // Close frame — Chrome is shutting down the connection
          socket.destroy();
          return;
        }
        if (opcode !== 1 && opcode !== 2) continue; // skip ping/pong/continuation
        let msg;
        try { msg = JSON.parse(payload.toString("utf8")); }
        catch { continue; }

        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve: res, reject: rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) {
            rej(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            res(msg.result);
          }
        } else if (msg.method) {
          for (const h of (eventHandlers.get(msg.method) || [])) {
            h(msg.params);
          }
        }
      }
    }

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headers = buf.slice(0, idx).toString();
        if (!headers.includes("101")) {
          reject(new Error(`WS handshake failed:\n${headers.slice(0, 400)}`));
          socket.destroy();
          return;
        }
        handshakeDone = true;
        buf = buf.slice(idx + 4);
        resolve({
          send(method, params = {}) {
            return new Promise((res, rej) => {
              const id = idCounter++;
              pending.set(id, { resolve: res, reject: rej });
              sendWsFrame(JSON.stringify({ id, method, params }));
            });
          },
          on(event, handler) {
            if (!eventHandlers.has(event)) eventHandlers.set(event, []);
            eventHandlers.get(event).push(handler);
          },
          close() { socket.destroy(); },
        });
        // Process any frames that arrived with the handshake response
      }
      const { frames, remaining } = parseFrames(buf);
      buf = remaining;
      dispatchFrames(frames);
    });

    socket.once("close", () => {
      for (const { reject: rej } of pending.values()) {
        rej(new Error("CDP socket closed unexpectedly"));
      }
      pending.clear();
    });
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until TCP port is open or timeoutMs elapses. */
function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const s = net.createConnection({ host: "127.0.0.1", port }, () => {
        s.destroy();
        resolve();
      });
      s.on("error", () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    }
    attempt();
  });
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function main() {
  let chromeProcess = null;
  let fileServer = null;
  let browserCdp = null;
  let pageCdp = null;
  let popupCdp = null;
  let extensionCdp = null;
  let decoyModeEnabledByTest = false;
  let tempDir = null;
  let passed = 0;
  let failed = 0;
  let skipped = false;

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
      warn(
        "Chrome not found. Set CHROME_PATH env var or install Chrome.\n" +
          "         Skipping browser test (exit 0)."
      );
      process.exit(0);
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
      // Allow CDP WebSocket connections from non-browser clients.
      // This is safe because the port is ephemeral and bound to 127.0.0.1 only.
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-client-side-phishing-detection",
      "--disable-default-apps",
      "--disable-popup-blocking",
      "--allow-running-insecure-content",
      "--headless=new",
    ];

    chromeProcess = spawn(chromePath, chromeArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    // Capture the browser-level WS URL from Chrome's startup log line.
    let browserWsUrl = null;
    chromeProcess.stderr.on("data", (data) => {
      const line = data.toString();
      const m = line.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) browserWsUrl = m[1];
    });

    chromeProcess.on("exit", (code) => {
      if (code !== null && code !== 0) log(`Chrome exited with code ${code}`);
    });

    // Wait for CDP debug port to open
    log(`Waiting for CDP on port ${DEBUG_PORT} ...`);
    await waitForPort(DEBUG_PORT, 20000);
    // Give the extension service worker time to initialise
    await sleep(2000);

    // ------------------------------------------------------------------
    // 4. Connect to the browser-level CDP target
    // ------------------------------------------------------------------
    if (!browserWsUrl) {
      // Fallback: read from /json/version (Chrome also exposes this)
      const versionInfo = await cdpHttpGet(DEBUG_PORT, "/json/version");
      browserWsUrl = versionInfo.webSocketDebuggerUrl;
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
      allTargets.find((t) => t.targetId === tabTargetId) ||
      allTargets.find((t) => t.type === "page" && t.url === "about:blank");

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

    const loadedTargets = await cdpHttpGet(DEBUG_PORT, "/json/list");
    const extensionLoaded = loadedTargets.some(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith("chrome-extension://") &&
        target.url.includes("background.js")
    );
    if (!extensionLoaded) {
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

    // ------------------------------------------------------------------
    // 7. Assert: background service worker returns a valid report
    // ------------------------------------------------------------------
    // Identify and connect directly to the extension service worker target.
    const latestTargets = await cdpHttpGet(DEBUG_PORT, "/json/list");
    const swTarget = latestTargets.find(
      (t) =>
        t.type === "service_worker" &&
        t.url.startsWith("chrome-extension://") &&
        t.url.includes("background.js")
    );
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
        return result?.result?.value;
      }

      const extensionIdentity = await evaluateExtension(`({
        id: chrome.runtime.id,
        name: chrome.runtime.getManifest().name,
        version: chrome.runtime.getManifest().version
      })`);
      log("Extension identity:", JSON.stringify(extensionIdentity));

      const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
      const popupTargetResult = await browserCdp.send("Target.createTarget", {
        url: popupUrl,
      });
      await sleep(500);
      const popupTargets = await cdpHttpGet(DEBUG_PORT, "/json/list");
      const popupTarget = popupTargets.find(
        (target) => target.targetId === popupTargetResult.targetId
      ) || popupTargets.find((target) => target.url === popupUrl);
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
        return result?.result?.value;
      }

      const initialPopup = await evaluatePopup(`({
        checked: document.querySelector("#decoy-mode-toggle")?.checked,
        experimental:
          document.querySelector(".experimental-badge")?.textContent?.trim()
      })`);
      check(
        "Popup: experimental Decoy Mode toggle is present and off by default",
        initialPopup?.checked === false &&
          initialPopup?.experimental === "Experimental",
        JSON.stringify(initialPopup)
      );

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
      } else {
        check("Background report: valid response", false, JSON.stringify(report));
      }

      const enabledPopup = await evaluatePopup(`
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
      decoyModeEnabledByTest =
        enabledPopup?.checked === true &&
        enabledPopup?.status.includes("IP address");
      check(
        "Popup: Decoy Mode enabled with network privacy warning",
        decoyModeEnabledByTest,
        JSON.stringify(enabledPopup)
      );

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

      const decoyReport = await evaluateExtension(`
        getReport(${JSON.stringify(tabId)}).then((report) => ({ ok: true, report }))
      `);
      check(
        "Decoy Mode: modified requests counted without false blocks",
        decoyReport?.report?.decoyMode === true &&
          decoyReport?.report?.page?.decoyedRequests > 0 &&
          decoyReport?.report?.page?.blockedOnPage === 0,
        JSON.stringify(decoyReport)
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
    // Benign errors caused by the test page intentionally loading tracker
    // scripts and pixels that are blocked by the extension's DNR rules.
    const realErrors = runtimeExceptions.filter((e) => {
      if (e.includes("Failed to fetch")) return false;
      if (e.includes("NetworkError")) return false;
      if (e.includes("net::ERR_")) return false;
      if (e.includes("ERR_BLOCKED_BY_CLIENT")) return false;
      if (e.includes("fbq is not defined")) return false;
      return true;
    });

    check(
      "No unexpected runtime exceptions",
      realErrors.length === 0,
      realErrors.length > 0 ? realErrors.slice(0, 3).join(" | ") : ""
    );

  } catch (err) {
    // Graceful skip for known unsupported environments
    if (
      err.message &&
      (err.message.includes("Timed out waiting for port") ||
        err.message.includes("Could not connect to CDP") ||
        err.message.includes("Unpacked extension was not loaded") ||
        err.message.includes("headless"))
    ) {
      warn(
        "Could not run an unpacked extension in this headless browser.\n" +
          "         Use a compatible Chromium-family build or set CHROME_PATH.\n" +
          "         Skipping browser test (exit 0)."
      );
      skipped = true;
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
    log("Browser test skipped because this browser did not load the unpacked extension.");
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
