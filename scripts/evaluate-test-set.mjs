import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rulesPath = path.join(rootDir, "rules", "rules.json");
const testSetPath = path.join(rootDir, "test", "tracker-test-set.json");

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
const testSet = JSON.parse(fs.readFileSync(testSetPath, "utf8"));

function hostnameFromUrl(rawUrl) {
  return new URL(rawUrl).hostname.toLowerCase();
}

function hostMatchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isThirdParty(requestUrl, topUrl) {
  const requestHost = hostnameFromUrl(requestUrl);
  const topHost = hostnameFromUrl(topUrl);
  return requestHost !== topHost && !requestHost.endsWith(`.${topHost}`);
}

function regexMatches(regexFilter, rawUrl) {
  if (!regexFilter) {
    return false;
  }

  return new RegExp(regexFilter, "i").test(rawUrl);
}

function requestMatchesRule(request, topUrl, rule) {
  const condition = rule.condition || {};
  const requestHost = hostnameFromUrl(request.url);

  if (
    condition.resourceTypes &&
    !condition.resourceTypes.includes(request.type)
  ) {
    return false;
  }

  if (condition.domainType === "thirdParty" && !isThirdParty(request.url, topUrl)) {
    return false;
  }

  if (
    condition.requestDomains &&
    !condition.requestDomains.some((domain) => hostMatchesDomain(requestHost, domain))
  ) {
    return false;
  }

  if (condition.regexFilter && !regexMatches(condition.regexFilter, request.url)) {
    return false;
  }

  return true;
}

function isBlockedByRules(request, topUrl) {
  return rules.some((rule) => {
    return (
      rule.action?.type === "block" &&
      requestMatchesRule(request, topUrl, rule)
    );
  });
}

function trackingParamsRemovedByRules(rawUrl) {
  const url = new URL(rawUrl);
  const redirectRules = rules.filter((rule) => {
    return rule.action?.type === "redirect" && requestMatchesRule(
      { url: rawUrl, type: "main_frame" },
      rawUrl,
      rule
    );
  });

  const paramsToRemove = new Set(
    redirectRules.flatMap((rule) => {
      return rule.action.redirect?.transform?.queryTransform?.removeParams || [];
    })
  );

  let removed = 0;
  for (const paramName of paramsToRemove) {
    removed += url.searchParams.getAll(paramName).length;
  }

  return removed;
}

const requests = testSet.pages.flatMap((page) => {
  return page.requests.map((request) => ({ ...request, topUrl: page.topUrl }));
});

const knownTrackerRequests = requests.filter((request) => request.tracker);
const blockedKnownTrackers = knownTrackerRequests.filter((request) => {
  return isBlockedByRules(request, request.topUrl);
});
const missedKnownTrackers = knownTrackerRequests.filter((request) => {
  return !isBlockedByRules(request, request.topUrl);
});
const before = knownTrackerRequests.length;
const after = before - blockedKnownTrackers.length;
const reduction = before === 0 ? 0 : ((before - after) / before) * 100;

const categories = Array.from(
  new Set(knownTrackerRequests.map((request) => request.category || "Uncategorized"))
).sort((a, b) => a.localeCompare(b));
const categorySummary = categories.map((category) => {
  const categoryRequests = knownTrackerRequests.filter((request) => {
    return (request.category || "Uncategorized") === category;
  });
  const blocked = categoryRequests.filter((request) => {
    return isBlockedByRules(request, request.topUrl);
  }).length;

  return {
    category,
    blocked,
    total: categoryRequests.length
  };
});

const landingParamSummary = testSet.landingUrls.map((url) => {
  return {
    url,
    removedParams: trackingParamsRemovedByRules(url)
  };
});
const totalRemovedParams = landingParamSummary.reduce((sum, item) => {
  return sum + item.removedParams;
}, 0);

console.log(`Test set: ${testSet.name}`);
console.log(`Known tracker requests before extension: ${before}`);
console.log(`Known tracker requests after extension: ${after}`);
console.log(`Blocked by GetBlocked!: ${blockedKnownTrackers.length}`);
console.log(`Reduction: ${reduction.toFixed(1)}%`);
console.log(`Tracking URL parameters removed in landing URL set: ${totalRemovedParams}`);
console.log("");
console.log("Category coverage:");
for (const item of categorySummary) {
  console.log(`- ${item.category}: ${item.blocked}/${item.total}`);
}

if (missedKnownTrackers.length > 0) {
  console.log("");
  console.log("Known tracker fixture requests not blocked:");
  for (const request of missedKnownTrackers) {
    console.log(`- ${request.url}`);
  }
}
