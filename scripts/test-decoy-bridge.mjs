import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function load(context, file) {
  vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context, { filename: file });
}
const runtimeId = "extension-id";
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("isolated bridge validates and batches only the current frame's enabled reports", async () => {
  const sent = [];
  const port = { start() {}, postMessage() {} };
  const events = {};
  let onChange, flush;
  let enabled = false;
  const context = vm.createContext({
    MessageChannel: class { port1 = port; port2 = {}; },
    window: { postMessage() {}, addEventListener(name, listener) { events[name] = listener; } },
    setTimeout(fn) { assert.equal(flush, undefined); flush = fn; return 1; },
    clearTimeout() { flush = undefined; },
    chrome: {
      runtime: {
        id: runtimeId,
        async sendMessage(message) {
          if (message.type === "GETBLOCKED_DECOY_CONFIG") {
            return { ok: true, configuration: { enabled }, reportDomains: ["api.segment.io"] };
          }
          sent.push(structuredClone(message));
        }
      },
      storage: { onChanged: { addListener(fn) { onChange = fn; } } }
    }
  });
  for (const file of ["shared/decoy-reports.js", "decoy-bridge.js"]) load(context, file);
  const deliver = (overrides) => port.onmessage({ data: {
    type: "request-decoyed", hostname: "sub.api.segment.io", transport: "fetch", ...overrides
  } });
  await nextTurn();
  deliver();
  assert.equal(flush, undefined);
  enabled = true;
  onChange({ getblockedDecoyMode: { newValue: true } }, "local");
  await nextTurn();
  for (const overrides of [
    { type: "configure" }, { hostname: "unlisted.example" }, { hostname: "user@api.segment.io" },
    { hostname: "x".repeat(254) + ".api.segment.io" }, { hostname: {} }, { transport: "other" }
  ]) deliver(overrides);
  assert.equal(flush, undefined);
  for (let i = 0; i < 70; i++) deliver();
  assert.equal(sent.length, 0);
  flush();
  assert.deepEqual(sent, [{ type: "GETBLOCKED_DECOYED_REQUESTS", count: 64, domains: ["api.segment.io"] }]);
  deliver({ transport: "beacon" });
  events.pagehide();
  assert.equal(flush, undefined);
  deliver({ transport: "xhr" });
  enabled = false;
  onChange({ getblockedDecoyMode: { newValue: false } }, "local");
  assert.equal(flush, undefined);
  deliver();
  assert.equal(flush, undefined);
});
