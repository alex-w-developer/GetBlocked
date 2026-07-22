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
const context = vm.createContext({ URL, URLSearchParams });
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

assert.equal(
  transform.isKnownTrackerUrl(
    "https://api.segment.io/v1/track",
    "https://example.com",
    ["segment.io"]
  ),
  true
);
assert.equal(
  transform.isKnownTrackerUrl(
    "https://metrics.example/v1/track",
    "https://example.com",
    ["segment.io"]
  ),
  false
);

const queryResult = transform.replaceUrl(
  "https://api.segment.io/v1/track?anonymous_id=real&cid=old&event=purchase",
  "https://example.com",
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

console.log("Decoy transformation checks OK");
