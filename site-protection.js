// Chrome persists these dynamic rules across restarts and extension updates.
// A worker caches the reads. Only a successful atomic rule change invalidates it.
let siteRulesPromise;

function getSiteRules() {
  if (!siteRulesPromise) {
    siteRulesPromise = chrome.declarativeNetRequest.getDynamicRules().catch((error) => {
      siteRulesPromise = undefined;
      throw error;
    });
  }
  return siteRulesPromise;
}

function siteHostname(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.hostname : null;
  } catch {
    return null;
  }
}

function siteFilter(hostname) {
  const escaped = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^https?://([^/@]*@)?${escaped}(:[0-9]+)?/`;
}

function findSiteRule(rules, hostname) {
  const filter = siteFilter(hostname);
  return rules.find(rule => rule.action.type === "allowAllRequests" &&
    rule.condition.regexFilter === filter);
}

async function getSiteProtection(rawUrl) {
  const hostname = siteHostname(rawUrl);
  if (!hostname) return null;
  return { hostname, enabled: !findSiteRule(await getSiteRules(), hostname) };
}

async function setSiteProtection(tabId, hostname, enabled) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !hostname || siteHostname(tab.url) !== hostname) {
    throw new Error("The active website changed. Reopen the popup and try again.");
  }

  const rules = await getSiteRules();
  const existing = findSiteRule(rules, hostname);
  if (enabled && existing) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [existing.id] });
  } else if (!enabled && !existing) {
    const usedIds = new Set(rules.map(rule => rule.id));
    let id = 1;
    while (usedIds.has(id)) id++;
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [{
      id,
      // At equal priority allowAllRequests precedes URL cleanup (2).
      // The independent community block (3) still wins, even in child frames.
      priority: 2,
      action: { type: "allowAllRequests" },
      condition: { regexFilter: siteFilter(hostname), resourceTypes: ["main_frame"] }
    }] });
  }
  siteRulesPromise = undefined;
}
