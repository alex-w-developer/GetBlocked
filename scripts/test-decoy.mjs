import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(rootDir, "shared", "decoy-transform.js"),
  "utf8"
);
const context = vm.createContext({ Blob, File, FormData, URL, URLSearchParams });
vm.runInContext(source, context);

const transform = context.GetBlockedDecoyTransform;
const profile = {
  anonymousId: "anon_consistent",
  clientId: "12345.67890",
  userId: "user_consistent",
  deviceId: "device_consistent",
  sessionId: "session_consistent",
  email: "casey.reed@example.invalid",
  firstName: "Casey",
  lastName: "Reed",
  fullName: "Casey Reed",
  username: "casey_reed",
  phone: "+12025550142"
};

const queryResult = transform.replaceUrl(
  new URL("https://api.segment.io/v1/track?anonymous_id=real&cid=old&event=purchase"),
  profile
);
const queryUrl = new URL(queryResult.value);
assert.equal(queryResult.changed, true);
assert.equal(queryUrl.searchParams.get("anonymous_id"), profile.anonymousId);
assert.equal(queryUrl.searchParams.get("cid"), profile.clientId);
assert.equal(queryUrl.searchParams.get("event"), "purchase");

const jsonResult = transform.replaceText(
  JSON.stringify({
    event: "purchase",
    event_name: "conversion",
    transaction_id: "order-real",
    ad_click_id: "click-real",
    revenue: 49.99,
    products: [{ sku: "sku-real", price: 49.99, quantity: 1 }],
    user_id: "real-user",
    properties: {
      email: "real@example.com",
      first_name: "Real",
      name: "checkout"
    }
  }),
  profile,
  "application/json"
);
const jsonBody = JSON.parse(jsonResult.value);
assert.equal(jsonBody.user_id, profile.userId);
assert.equal(jsonBody.properties.email, profile.email);
assert.equal(jsonBody.properties.first_name, profile.firstName);
assert.equal(jsonBody.event, "purchase");
assert.equal(jsonBody.event_name, "conversion");
assert.equal(jsonBody.transaction_id, "order-real");
assert.equal(jsonBody.ad_click_id, "click-real");
assert.equal(jsonBody.revenue, 49.99);
assert.deepEqual(jsonBody.products, [
  { sku: "sku-real", price: 49.99, quantity: 1 }
]);
assert.equal(jsonBody.properties.name, "checkout");

const repeatedResult = transform.replaceText(
  "user_id=another-real-user&email=another%40example.com",
  profile,
  "application/x-www-form-urlencoded"
);
const repeatedBody = new URLSearchParams(repeatedResult.value);
assert.equal(repeatedBody.get("user_id"), profile.userId);
assert.equal(repeatedBody.get("email"), profile.email);

const unknownResult = transform.replaceText(
  "event=page_view&order_id=order-real&amount=19.95",
  profile,
  "application/x-www-form-urlencoded"
);
assert.equal(unknownResult.changed, false);
assert.equal(
  unknownResult.value,
  "event=page_view&order_id=order-real&amount=19.95"
);

const formBody = new FormData();
formBody.append("email", "real@example.com");
formBody.append(
  "attachment",
  new File(["fixture"], "evidence.txt", { type: "text/plain" })
);
const formResult = transform.replaceBody(formBody, profile);
assert.equal(formResult.changed, true);
assert.equal(formResult.value.get("email"), profile.email);
assert.equal(formResult.value.get("attachment").name, "evidence.txt");
assert.equal(formResult.value.get("attachment").type, "text/plain");

// Exercise each wrapper with local native stubs so no network calls are made.
const calls = [];
class LocalXhr {
  open(method, url) { this.url = url; }
  setRequestHeader() {}
  send() { calls.push(this.url); }
}
class LocalNavigator {
  sendBeacon(url) { calls.push(url); return true; }
}
const frame = {
  origin: "https://publisher.example",
  addEventListener(type, listener) { this.connect = listener; },
  removeEventListener() {}
};
const transportContext = vm.createContext({
  window: frame, document: { baseURI: frame.origin }, URL, URLSearchParams,
  Request, Headers, Blob, FormData, File, TextDecoder, TextEncoder, setTimeout, clearTimeout,
  XMLHttpRequest: LocalXhr, Navigator: LocalNavigator,
  fetch: async (input, init) => {
    calls.push(input);
    if (input instanceof Request || init) {
      const request = new Request(input, init);
      request.signal.throwIfAborted();
      return request;
    }
  }
});
for (const file of ["shared/config.js", "shared/tracker-scope.js", "shared/decoy-transform.js", "decoy-interceptor.js"]) {
  vm.runInContext(fs.readFileSync(path.join(rootDir, file), "utf8"), transportContext);
}
const port = { start() {}, postMessage() {} };
frame.connect({ source: frame, data: { channel: "getblocked-decoy-bridge-v1", type: "connect" }, ports: [port] });
port.onmessage({ data: { type: "configure", enabled: true, profile } });

const relative = "collect?user_id=original";
for (const [origin, base, input, expected] of [
  ["https://publisher.example", "https://publisher.example/", relative, relative],
  ["https://publisher.example", "https://api.segment.io/v1/", relative, "https://api.segment.io/v1/collect?user_id=user_consistent"],
  ["https://app.segment.io", "https://api.segment.io/v1/", relative, relative],
  ["null", "https://api.segment.io/v1/", relative, "https://api.segment.io/v1/collect?user_id=user_consistent"],
  ["https://publisher.example", "https://api.segment.io/", "https://elsewhere.example/" + relative, "https://elsewhere.example/" + relative],
  ["https://publisher.example", "https://other.example/", "https://api.segment.io/" + relative, "https://api.segment.io/collect?user_id=user_consistent"]
]) {
  calls.length = 0;
  frame.origin = origin;
  transportContext.document.baseURI = base;
  await transportContext.fetch(input);
  const xhr = new LocalXhr();
  xhr.open("POST", input);
  xhr.send();
  new LocalNavigator().sendBeacon(input);
  assert.deepEqual(calls, [expected, expected, expected], [origin, base, input].join(" "));
}

const originalUrl = "https://api.segment.io/collect?user_id=original";
const changedUrl = originalUrl.replace("=original", "=" + profile.userId);
for (const enabled of [false, true]) {
  port.onmessage({ data: { type: "configure", enabled, profile } });
  let conversions = 0;
  const urlArgument = { toString() { conversions++; return "https://unlisted.example/path"; } };
  await transportContext.fetch(urlArgument, { method: "GET" });
  assert.equal(conversions, 1);
}
const posted = new Request(originalUrl, {
  method: "POST", keepalive: true, credentials: "include", redirect: "error",
  headers: { "content-type": "application/json", "x-local-test": "kept" },
  body: JSON.stringify({ user_id: "original", event: "page_view" })
});
const rewritten = await transportContext.fetch(posted);
assert.equal(new URL(rewritten.url).searchParams.get("user_id"), profile.userId);
assert.equal(rewritten.keepalive, true);
assert.equal(rewritten.method, "POST");
assert.equal(rewritten.credentials, "include");
assert.equal(rewritten.redirect, "error");
assert.equal(rewritten.headers.get("x-local-test"), "kept");
assert.deepEqual(await rewritten.json(), { user_id: profile.userId, event: "page_view" });
assert.equal(posted.bodyUsed, true);

const inheritedOptions = Object.create({ method: "PUT", keepalive: true, body: "user_id=overridden" });
const overridden = await transportContext.fetch(new Request(originalUrl), inheritedOptions);
assert.equal(overridden.method, "PUT");
assert.equal(overridden.keepalive, true);
assert.equal(await overridden.text(), "user_id=" + profile.userId);

const initialOptions = {
  method: "POST", headers: new Headers({ "x-snapshot": "original" }), body: new URLSearchParams("page=one")
};
const pending = transportContext.fetch(originalUrl, initialOptions);
initialOptions.method = "PUT";
initialOptions.headers.set("x-snapshot", "changed");
initialOptions.body.set("page", "two");
const snapshot = await pending;
assert.equal(snapshot.method, "POST");
assert.equal(snapshot.headers.get("x-snapshot"), "original");
assert.equal(await snapshot.text(), "page=one");

const oversized = "user_id=original&padding=" + "a".repeat(64 * 1024);
for (const keepalive of [false, true]) {
  const large = await transportContext.fetch(new Request(originalUrl, { method: "POST", body: oversized, keepalive }));
  assert.equal(large.url, originalUrl);
  assert.equal(await large.text(), oversized);
}
const nearLimit = "user_id=x&pad=".padEnd(65535, "a");
for (const [input, init] of [
  [new Request(originalUrl, { method: "POST", keepalive: true, body: nearLimit })],
  [originalUrl, { method: "POST", keepalive: true, body: new URLSearchParams(nearLimit) }]
]) {
  const exact = await transportContext.fetch(input, init);
  assert.equal(exact.url, changedUrl);
  assert.equal(await exact.text(), nearLimit);
}
const multipart = new FormData();
multipart.append("user_id", "x");
for (const keepalive of [false, true]) {
  const uploaded = await transportContext.fetch(originalUrl, { method: "POST", keepalive, body: multipart });
  assert.equal(uploaded.url, changedUrl);
  assert.equal((await uploaded.formData()).get("user_id"), keepalive ? "x" : profile.userId);
}

const malformedBytes = Uint8Array.from([...new TextEncoder().encode("user_id=original&data="), 255]);
const binary = await transportContext.fetch(new Request(originalUrl, {
  method: "POST", headers: { "content-type": "text/plain" }, body: malformedBytes
}));
assert.equal(binary.url, changedUrl);
assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), malformedBytes);

const otherEncoding = await transportContext.fetch(new Request(originalUrl, {
  method: "POST", headers: { "content-type": 'text/plain; charset="windows-1252"' }, body: "user_id=original"
}));
assert.equal(otherEncoding.url, changedUrl);
assert.equal(await otherEncoding.text(), "user_id=original");

let finishUpload;
const stream = new ReadableStream({
  start(controller) {
    finishUpload = () => {
      controller.enqueue(new TextEncoder().encode("user_id=original"));
      controller.close();
    };
  }
});
const slow = new Request(originalUrl, {
  method: "POST", duplex: "half", body: stream, headers: { "content-type": "text/plain" }
});
let watchdog;
try {
  const forwarded = await Promise.race([
    transportContext.fetch(slow),
    new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Fetch waited for the upload")), 2000); })
  ]);
  assert.equal(forwarded.url, originalUrl);
  finishUpload();
  finishUpload = null;
  assert.equal(await forwarded.text(), "user_id=original");
} finally {
  clearTimeout(watchdog);
  finishUpload?.();
}

const raw = new Request(originalUrl, { method: "POST", body: "consumed" });
await raw.text();
await assert.rejects(transportContext.fetch(raw), TypeError);
const explicitlyStreamed = new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode("stream data")); controller.close(); }
});
const directStream = await transportContext.fetch(originalUrl, { method: "POST", duplex: "half", body: explicitlyStreamed });
assert.equal(directStream.url, changedUrl);
assert.equal(await directStream.text(), "stream data");

// An abort must interrupt inspection even if the browser delays timers.
let readTimers = 0;
transportContext.setTimeout = () => { readTimers++; return 0; };
for (const alreadyAborted of [true, false]) {
  const controller = new AbortController();
  const reason = new Error("cancelled by caller");
  const stream = new ReadableStream({});
  if (alreadyAborted) controller.abort(reason);
  const request = new Request(originalUrl, {
    method: "POST", body: stream, duplex: "half", signal: controller.signal, headers: { "content-type": "text/plain" }
  });
  const pending = transportContext.fetch(request);
  if (!alreadyAborted) controller.abort(reason);
  let deadline;
  try {
    const guard = new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Abort did not reach fetch")), 1500);
    });
    await assert.rejects(Promise.race([pending, guard]), (error) => error === reason);
  } finally { clearTimeout(deadline); }
  assert.equal(readTimers, alreadyAborted ? 0 : 1);
}
console.log("Decoy transformation checks OK");
