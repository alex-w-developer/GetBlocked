importScripts("shared/config.js");

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

let updateQueue = Promise.resolve();

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

function getBadgeText(tabId) {
  return new Promise((resolve) => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      resolve("");
      return;
    }

    chrome.action.getBadgeText({ tabId }, (badgeText) => {
      const error = chrome.runtime.lastError;
      resolve(error ? "" : badgeText || "");
    });
  });
}

function setDnrActionBadgeEnabled() {
  chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });

  chrome.declarativeNetRequest.setExtensionActionOptions(
    { displayActionCountAsBadgeText: true },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function createEmptyTabStats() {
  return {
    blockedOnPage: 0,
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

function isKnownTrackerHost(hostname) {
  const normalizedHost = String(hostname || "").toLowerCase();
  return TRACKER_DOMAINS.some((domain) => {
    return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
  });
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

async function ensureDecoySessionProfile() {
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
  await applyDecoyRuleState(enabled);
  await storageSet({ [DECOY_MODE_KEY]: enabled });

  if (enabled) {
    await clearBlockedCounts();
  }

  return {
    enabled,
    profile: enabled ? await ensureDecoySessionProfile() : null
  };
}

async function getDecoyConfiguration() {
  const enabled = await getDecoyMode();
  return {
    enabled,
    profile: enabled ? await ensureDecoySessionProfile() : null
  };
}

function normalizeTabStats(stats) {
  return {
    ...createEmptyTabStats(),
    ...(stats || {})
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

function parseDnrActionCount(badgeText) {
  const match = String(badgeText || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
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

async function clearBlockedCounts() {
  const tabStats = await getAllTabStats();
  const updatedAt = Date.now();
  const nextStats = Object.fromEntries(
    Object.entries(tabStats).map(([tabId, stats]) => {
      return [
        tabId,
        normalizeTabStats({
          ...stats,
          blockedOnPage: 0,
          updatedAt
        })
      ];
    })
  );
  await setAllTabStats(nextStats);
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
  const next = normalizeTabStats({
    ...current,
    ...updater(current),
    updatedAt: Date.now()
  });

  await setAllTabStats({
    ...tabStats,
    [String(tabId)]: next
  });

  return next;
}

async function resetTabStats(tabId, initialStats = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  const tabStats = await getAllTabStats();

  await setAllTabStats({
    ...tabStats,
    [String(tabId)]: normalizeTabStats({
      ...createEmptyTabStats(),
      ...initialStats,
      updatedAt: Date.now()
    })
  });
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

async function syncBlockedEstimateForTab(tabId, estimate) {
  const safeEstimate = Math.max(0, Number(estimate) || 0);
  const current = await getTabStats(tabId);

  if (safeEstimate <= current.blockedOnPage) {
    return current;
  }

  return updateTabStats(tabId, () => ({
    blockedOnPage: safeEstimate
  }));
}

async function syncDnrActionCountForTab(tabId) {
  const badgeText = await getBadgeText(tabId);
  const actionCount = parseDnrActionCount(badgeText);
  const current = await getTabStats(tabId);
  const estimatedBlockCount = Math.max(
    0,
    actionCount - current.trackingLinksCleaned
  );

  return syncBlockedEstimateForTab(tabId, estimatedBlockCount);
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
  if (!(await getDecoyMode())) {
    await syncBlockedEstimateForTab(tabId, safeSignals.estimatedTrackerRequests);
  }
}

async function recordDecoyedRequest(tabId, hostname) {
  const normalizedHost = String(hostname || "").toLowerCase();
  if (!(await getDecoyMode()) || !isKnownTrackerHost(normalizedHost)) {
    return;
  }

  await updateTabStats(tabId, (current) => ({
    decoyedRequests: current.decoyedRequests + 1,
    detectedCategories: Array.from(
      new Set([
        ...current.detectedCategories,
        ...getTrackerCategories(normalizedHost)
      ])
    )
  }));
}

async function getReport(tabId) {
  await updateQueue;
  const decoyMode = await getDecoyMode();
  if (!decoyMode) {
    await syncDnrActionCountForTab(tabId);
  }

  const pageStats = await getTabStats(tabId);

  return {
    page: pageStats,
    decoyMode,
    localOnly: true,
    counterMode: "production_estimate"
  };
}

function handleMessage(message, sender, sendResponse) {
  if (message?.type === "GETBLOCKED_PAGE_SIGNALS") {
    const tabId = sender.tab?.id;
    const signals = message.payload || {};

    queueUpdate(() => updatePageSignals(tabId, signals));

    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GETBLOCKED_DECOYED_REQUEST") {
    queueUpdate(() => {
      return recordDecoyedRequest(sender.tab?.id, message.hostname);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GETBLOCKED_DECOY_CONFIG") {
    getDecoyConfiguration()
      .then((configuration) => sendResponse({ ok: true, configuration }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Unable to load Decoy Mode"
        });
      });
    return true;
  }

  if (message?.type === "SET_GETBLOCKED_DECOY_MODE") {
    const enabled = message.enabled === true;
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
  });
  setDnrActionBadgeEnabled();
});

chrome.runtime.onStartup.addListener(() => {
  queueUpdate(async () => {
    await clearTransientLocalData();
    await syncDecoyRuleStateFromStorage();
  });
  setDnrActionBadgeEnabled();
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
      trackingLinksCleaned: trackingParamsRemoved > 0 ? 1 : 0,
      trackingParamsRemoved
    });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueUpdate(() => removeTabLocalData(tabId));
});

chrome.runtime.onMessage.addListener(handleMessage);
