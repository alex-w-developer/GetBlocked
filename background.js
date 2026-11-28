importScripts("shared/config.js");
importScripts("site-protection.js");
importScripts("shared/decoy-reports.js");

const {
  BLOCK_RULE_ID,
  CLEAN_URL_RULE_ID,
  TRACKING_PARAMS,
  TRACKER_DOMAINS,
  TRACKER_CATEGORIES
} = globalThis.GetBlockedConfig;

const TAB_STATS_KEY = "getblockedTabStats";
const PENDING_NAVIGATION_KEY = "getblockedPendingNavigation";
const OBSOLETE_TOTALS_KEY = "getblockedTotals";
const DECOY_MODE_KEY = "getblockedDecoyMode";
const DECOY_SESSION_PROFILE_KEY = "getblockedDecoySessionProfile";
const UNSAFE_DOMAINS_KEY = "getblockedUnsafeDomains";
const UNSAFE_RULESET_ID = "getblocked_unsafe_domains";

let updateQueue = Promise.resolve();
const decoyReportBudgets = new Map();
const decoyReportDomains = new Set(TRACKER_DOMAINS);
const MAX_BATCHES_PER_TAB = 4;

function queueUpdate(task) {
  const operation = updateQueue.then(task);
  updateQueue = operation.catch((error) => {
    console.warn("GetBlocked update failed:", error);
  });
  return operation;
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sessionStorageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function sessionStorageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.session.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function updateStaticRules(options) {
  return chrome.declarativeNetRequest.updateStaticRules(options);
}

function setBadgeText(tabId, text) {
  return new Promise((resolve) => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      resolve();
      return;
    }

    chrome.action.setBadgeText({ tabId, text }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function setActionTitle(tabId, title) {
  return new Promise((resolve) => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      resolve();
      return;
    }

    chrome.action.setTitle({ tabId, title }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function configureActionBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });

  chrome.declarativeNetRequest.setExtensionActionOptions(
    { displayActionCountAsBadgeText: false },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function createEmptyTabStats() {
  return {
    decoyedRequests: 0,
    trackingLinksCleaned: 0,
    trackingParamsRemoved: 0,
    visibleAttempts: 0,
    trackingLinksDetected: 0,
    trackerElementsDetected: 0,
    estimatedTrackerRequests: 0,
    detectedCategories: [],
    updatedAt: Date.now()
  };
}

function getTrackerCategories(hostname) {
  return Object.entries(TRACKER_CATEGORIES)
    .filter(([, domains]) => {
      return domains.some((domain) => {
        return hostname === domain || hostname.endsWith(`.${domain}`);
      });
    })
    .map(([category]) => category);
}

function createFakeSessionProfile() {
  const firstNames = ["Alex", "Casey", "Jordan", "Morgan", "Riley", "Taylor"];
  const lastNames = ["Avery", "Hayes", "Parker", "Reed", "Rowan", "Sage"];
  const randomValues = crypto.getRandomValues(new Uint32Array(4));
  const token = Array.from(randomValues, (value) => {
    return value.toString(16).padStart(8, "0");
  }).join("");
  const firstName = firstNames[randomValues[0] % firstNames.length];
  const lastName = lastNames[randomValues[1] % lastNames.length];
  const username = `${firstName}.${lastName}.${token.slice(0, 6)}`.toLowerCase();
  const phoneSuffix = String(randomValues[2] % 100).padStart(2, "0");

  return Object.freeze({
    anonymousId: `anon_${token}`,
    clientId: `${randomValues[0]}.${randomValues[1]}`,
    userId: `user_${token.slice(0, 20)}`,
    deviceId: `device_${token.slice(8, 28)}`,
    sessionId: `session_${token.slice(16)}`,
    email: `${username}@example.invalid`,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    username,
    phone: `+120255501${phoneSuffix}`
  });
}

async function getDecoyMode() {
  const result = await storageGet(DECOY_MODE_KEY);
  return result[DECOY_MODE_KEY] === true;
}

async function getUnsafeDomainBlocking() {
  const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
  return rulesets.includes(UNSAFE_RULESET_ID);
}

async function applyUnsafeDomainRuleState(enabled) {
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? [UNSAFE_RULESET_ID] : [],
    disableRulesetIds: enabled ? [] : [UNSAFE_RULESET_ID]
  });
}

async function syncUnsafeDomainRuleStateFromStorage() {
  const result = await storageGet(UNSAFE_DOMAINS_KEY);
  await applyUnsafeDomainRuleState(result[UNSAFE_DOMAINS_KEY] === true);
}

async function setUnsafeDomainBlocking(enabled) {
  const previous = await getUnsafeDomainBlocking();
  await applyUnsafeDomainRuleState(enabled);
  try {
    await storageSet({ [UNSAFE_DOMAINS_KEY]: enabled });
  } catch (error) {
    await applyUnsafeDomainRuleState(previous);
    throw error;
  }
  return { enabled };
}

let pendingSessionProfile;
function ensureDecoySessionProfile() {
  if (!pendingSessionProfile) {
    pendingSessionProfile = loadOrCreateSessionProfile().finally(() => {
      pendingSessionProfile = undefined;
    });
  }
  return pendingSessionProfile;
}

async function loadOrCreateSessionProfile() {
  const result = await sessionStorageGet(DECOY_SESSION_PROFILE_KEY);
  const existing = result[DECOY_SESSION_PROFILE_KEY];

  if (existing && typeof existing === "object") {
    return existing;
  }

  const profile = createFakeSessionProfile();
  await sessionStorageSet({ [DECOY_SESSION_PROFILE_KEY]: profile });
  return profile;
}

async function applyDecoyRuleState(enabled) {
  await updateStaticRules({
    rulesetId: "getblocked_static_rules",
    disableRuleIds: enabled ? [BLOCK_RULE_ID] : [],
    enableRuleIds: enabled
      ? [CLEAN_URL_RULE_ID]
      : [BLOCK_RULE_ID, CLEAN_URL_RULE_ID]
  });
}

async function syncDecoyRuleStateFromStorage() {
  await applyDecoyRuleState(await getDecoyMode());
}

async function setDecoyMode(enabled) {
  const previous = await getDecoyMode();
  const profile = enabled ? await ensureDecoySessionProfile() : null;
  await applyDecoyRuleState(enabled);
  try {
    await storageSet({ [DECOY_MODE_KEY]: enabled });
  } catch (error) {
    await applyDecoyRuleState(previous);
    throw error;
  }

  // The setting is committed. A later report also refreshes the tab badge.
  try {
    await syncAllTabBadges(await getAllTabStats(), enabled);
  } catch (error) {
    console.warn("Unable to refresh GetBlocked badges:", error);
  }
  return { enabled, profile };
}

async function getDecoyConfiguration(sender) {
  await updateQueue;
  let enabled = await getDecoyMode();
  if (enabled && sender) {
    // New frames and global mode changes follow their current document until
    // its next top-level navigation, even if the user just saved an exception.
    const { sitePaused } = await getTabStats(sender.tab.id);
    const topLevelUrl = sender.frameId === 0 ? sender.url : sender.tab.url;
    enabled = sitePaused === undefined ? (await getSiteProtection(topLevelUrl))?.enabled !== false : !sitePaused;
  }
  return {
    enabled,
    profile: enabled ? await ensureDecoySessionProfile() : null
  };
}

function normalizeTabStats(stats) {
  return {
    ...createEmptyTabStats(),
    ...(stats || {}),
    estimatedTrackerRequests: stats?.estimatedTrackerRequests ?? stats?.blockedOnPage ?? 0
  };
}

function countTrackingParams(rawUrl) {
  try {
    const url = new URL(rawUrl);
    let count = 0;

    for (const paramName of TRACKING_PARAMS) {
      count += url.searchParams.getAll(paramName).length;
    }

    return count;
  } catch (error) {
    return 0;
  }
}

async function getAllTabStats() {
  const result = await storageGet(TAB_STATS_KEY);
  return result[TAB_STATS_KEY] || {};
}

async function setAllTabStats(tabStats) {
  await storageSet({
    [TAB_STATS_KEY]: tabStats
  });
}

function getActiveBadgeCount(stats, decoyMode) {
  const count = decoyMode ? stats.decoyedRequests : stats.estimatedTrackerRequests;
  return Math.max(0, Number(count) || 0);
}

async function syncBadgeForTab(tabId, stats, decoyMode = null) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  const mode = decoyMode === null ? await getDecoyMode() : decoyMode;
  if (stats?.sitePaused) {
    await Promise.all([setBadgeText(tabId, ""), setActionTitle(tabId, "Site protection paused")]);
    return;
  }
  const count = getActiveBadgeCount(normalizeTabStats(stats), mode);
  const title = mode
    ? `Reported Decoy replacements on this page: ${count}`
    : `Estimated tracker resources on this page: ${count}`;

  await Promise.all([
    setBadgeText(tabId, count > 0 ? String(count) : ""),
    setActionTitle(tabId, title)
  ]);
}

async function syncAllTabBadges(tabStats, decoyMode = null) {
  await Promise.all(
    Object.entries(tabStats).map(([tabId, stats]) => {
      return syncBadgeForTab(Number(tabId), stats, decoyMode);
    })
  );
}

async function getTabStats(tabId) {
  const tabStats = await getAllTabStats();
  return normalizeTabStats(tabStats[String(tabId)]);
}

async function updateTabStats(tabId, updater) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return createEmptyTabStats();
  }

  const tabStats = await getAllTabStats();
  const current = normalizeTabStats(tabStats[String(tabId)]);
  if (current.sitePaused) return current;
  const next = normalizeTabStats({
    ...current,
    ...updater(current),
    updatedAt: Date.now()
  });

  await setAllTabStats({
    ...tabStats,
    [String(tabId)]: next
  });
  await syncBadgeForTab(tabId, next);

  return next;
}

async function resetTabStats(tabId, initialStats = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  const tabStats = await getAllTabStats();

  const next = normalizeTabStats({
    ...createEmptyTabStats(),
    ...initialStats,
    updatedAt: Date.now()
  });

  await setAllTabStats({
    ...tabStats,
    [String(tabId)]: next
  });
  await syncBadgeForTab(tabId, next);
}

async function setPendingNavigation(tabId, trackingParamCount) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  const result = await storageGet(PENDING_NAVIGATION_KEY);
  const pending = result[PENDING_NAVIGATION_KEY] || {};
  const key = String(tabId);

  if (trackingParamCount <= 0) {
    delete pending[key];
  } else {
    pending[key] = {
      trackingParamCount,
      updatedAt: Date.now()
    };
  }

  await storageSet({
    [PENDING_NAVIGATION_KEY]: pending
  });
}

async function popPendingNavigation(tabId) {
  const result = await storageGet(PENDING_NAVIGATION_KEY);
  const pending = result[PENDING_NAVIGATION_KEY] || {};
  const key = String(tabId);
  const current = pending[key] || { trackingParamCount: 0 };

  if (Object.prototype.hasOwnProperty.call(pending, key)) {
    delete pending[key];
    await storageSet({
      [PENDING_NAVIGATION_KEY]: pending
    });
  }

  return current;
}

async function removeTabLocalData(tabId) {
  const [statsResult, pendingResult] = await Promise.all([
    storageGet(TAB_STATS_KEY),
    storageGet(PENDING_NAVIGATION_KEY)
  ]);
  const tabStats = statsResult[TAB_STATS_KEY] || {};
  const pending = pendingResult[PENDING_NAVIGATION_KEY] || {};
  const key = String(tabId);

  delete tabStats[key];
  delete pending[key];

  await Promise.all([
    storageSet({ [TAB_STATS_KEY]: tabStats }),
    storageSet({ [PENDING_NAVIGATION_KEY]: pending })
  ]);
}

async function clearTransientLocalData() {
  await storageRemove([TAB_STATS_KEY, PENDING_NAVIGATION_KEY, OBSOLETE_TOTALS_KEY]);
}

async function updatePageSignals(tabId, signals) {
  const detectedCategories = Array.isArray(signals.detectedCategories)
    ? signals.detectedCategories.filter((category) => {
        return typeof category === "string" && category.length > 0;
      })
    : [];
  const safeSignals = {
    visibleAttempts: Math.max(0, Number(signals.visibleAttempts) || 0),
    trackingLinksDetected: Math.max(
      0,
      Number(signals.trackingLinksDetected) || 0
    ),
    trackerElementsDetected: Math.max(
      0,
      Number(signals.trackerElementsDetected) || 0
    ),
    estimatedTrackerRequests: Math.max(
      0,
      Number(signals.estimatedTrackerRequests) || 0
    ),
    detectedCategories
  };

  await updateTabStats(tabId, (current) => ({
    ...safeSignals,
    detectedCategories: Array.from(
      new Set([...current.detectedCategories, ...safeSignals.detectedCategories])
    )
  }));
}

async function recordDecoyedRequests(tabId, message) {
  if (!(await getDecoyMode())) return;
  await updateTabStats(tabId, (current) => ({
    decoyedRequests: current.decoyedRequests + message.count,
    detectedCategories: Array.from(
      new Set([...current.detectedCategories, ...message.domains.flatMap(getTrackerCategories)])
    )
  }));
}

function acceptDecoyBatch(tabId, message) {
  const now = performance.now();
  let budget = decoyReportBudgets.get(tabId);
  if (!budget) {
    budget = { start: now, used: 0, pending: 0 };
    decoyReportBudgets.set(tabId, budget);
  }
  if (now - budget.start >= 1000) {
    budget.start = now;
    budget.used = 0;
  }
  if (budget.used >= MAX_BATCHES_PER_TAB || budget.pending >= MAX_BATCHES_PER_TAB) return;
  budget.used++;
  budget.pending++;
  queueUpdate(async () => {
    try {
      await recordDecoyedRequests(tabId, message);
    } finally {
      budget.pending--;
    }
  });
}

async function getReport(tabId) {
  await updateQueue;
  const decoyMode = await getDecoyMode();
  const pageStats = await getTabStats(tabId);
  await syncBadgeForTab(tabId, pageStats, decoyMode);

  return {
    page: { ...pageStats, blockedOnPage: decoyMode || pageStats.sitePaused ? 0 : getActiveBadgeCount(pageStats, false) },
    site: await getSiteProtection((await chrome.tabs.get(tabId)).url),
    decoyMode,
    unsafeDomainBlocking: await getUnsafeDomainBlocking(),
    localOnly: true,
    counterMode: "local_estimate"
  };
}

function isPopupSender(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup/popup.html");
}

function isTabSender(sender) {
  return sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && sender.tab.id >= 0;
}

function handleMessage(message, sender, sendResponse) {
  if (message?.type === "SET_GETBLOCKED_SITE_PROTECTION") {
    if (!isPopupSender(sender) ||
        !Number.isInteger(message.tabId) || message.tabId < 0 ||
        typeof message.hostname !== "string" || typeof message.enabled !== "boolean") {
      sendResponse({ ok: false, error: "Invalid site setting request" });
      return false;
    }
    queueUpdate(() => setSiteProtection(message.tabId, message.hostname, message.enabled))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message || "Unable to update site protection" }));
    return true;
  }

  if (message?.type === "SET_GETBLOCKED_UNSAFE_DOMAINS") {
    if (!isPopupSender(sender) || typeof message.enabled !== "boolean") {
      sendResponse({ ok: false, error: "Invalid community-list setting request" });
      return false;
    }
    queueUpdate(() => setUnsafeDomainBlocking(message.enabled))
      .then((configuration) => sendResponse({ ok: true, configuration }))
      .catch((error) => sendResponse({
        ok: false,
        error: error.message || "Unable to update the community list"
      }));
    return true;
  }

  if (message?.type === "GETBLOCKED_PAGE_SIGNALS") {
    const tabId = sender.tab?.id;
    const signals = message.payload || {};

    queueUpdate(() => updatePageSignals(tabId, signals));

    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GETBLOCKED_DECOYED_REQUESTS") {
    if (!isTabSender(sender) || sender.documentLifecycle !== "active" ||
        !globalThis.GetBlockedDecoyReports.isValidBatch(message, decoyReportDomains)) {
      sendResponse({ ok: false, error: "Invalid Decoy report" });
      return false;
    }
    acceptDecoyBatch(sender.tab.id, message);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GETBLOCKED_DECOY_CONFIG") {
    if (!isTabSender(sender)) {
      sendResponse({ ok: false, error: "Invalid Decoy configuration request" });
      return false;
    }
    getDecoyConfiguration(sender)
      .then((configuration) => sendResponse({
        ok: true, configuration, reportDomains: configuration.enabled ? TRACKER_DOMAINS : []
      }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Unable to load Decoy Mode"
        });
      });
    return true;
  }

  if (message?.type === "SET_GETBLOCKED_DECOY_MODE") {
    if (!isPopupSender(sender) || typeof message.enabled !== "boolean") {
      sendResponse({ ok: false, error: "Invalid Decoy Mode setting request" });
      return false;
    }
    const enabled = message.enabled;
    queueUpdate(() => setDecoyMode(enabled))
      .then((configuration) => sendResponse({ ok: true, configuration }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Unable to update Decoy Mode"
        });
      });
    return true;
  }

  if (message?.type === "GETBLOCKED_REPORT") {
    if (!isPopupSender(sender) || !Number.isInteger(message.tabId) || message.tabId < 0) {
      sendResponse({ ok: false, error: "Invalid popup report request" });
      return false;
    }
    getReport(message.tabId)
      .then((report) => sendResponse({ ok: true, report }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Unable to load report"
        });
      });
    return true;
  }

  return false;
}

chrome.runtime.onInstalled.addListener(() => {
  queueUpdate(async () => {
    await clearTransientLocalData();
    await syncDecoyRuleStateFromStorage();
    await syncUnsafeDomainRuleStateFromStorage();
  });
  configureActionBadge();
});

chrome.runtime.onStartup.addListener(() => {
  queueUpdate(async () => {
    await clearTransientLocalData();
    await syncDecoyRuleStateFromStorage();
    await syncUnsafeDomainRuleStateFromStorage();
  });
  configureActionBadge();
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  const trackingParamCount = countTrackingParams(details.url);
  queueUpdate(() => setPendingNavigation(details.tabId, trackingParamCount));
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  queueUpdate(async () => {
    const pending = await popPendingNavigation(details.tabId);
    const remainingTrackingParams = countTrackingParams(details.url);
    const trackingParamsRemoved = Math.max(
      0,
      (pending.trackingParamCount || 0) - remainingTrackingParams
    );

    await resetTabStats(details.tabId, {
      sitePaused: (await getSiteProtection(details.url))?.enabled === false,
      trackingLinksCleaned: trackingParamsRemoved > 0 ? 1 : 0,
      trackingParamsRemoved
    });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  decoyReportBudgets.delete(tabId);
  queueUpdate(() => removeTabLocalData(tabId));
});

chrome.runtime.onMessage.addListener(handleMessage);

configureActionBadge();
