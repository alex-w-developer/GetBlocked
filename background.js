importScripts("shared/config.js");

const { TRACKING_PARAMS } = globalThis.GetBlockedConfig;

const TAB_STATS_KEY = "getblockedTabStats";
const PENDING_NAVIGATION_KEY = "getblockedPendingNavigation";
const OBSOLETE_TOTALS_KEY = "getblockedTotals";

let updateQueue = Promise.resolve();

function queueUpdate(task) {
  updateQueue = updateQueue.then(task).catch((error) => {
    console.warn("GetBlocked update failed:", error);
  });
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

  await updateTabStats(tabId, () => safeSignals);
  await syncBlockedEstimateForTab(tabId, safeSignals.estimatedTrackerRequests);
}

async function getReport(tabId) {
  await updateQueue;
  await syncDnrActionCountForTab(tabId);

  const pageStats = await getTabStats(tabId);

  return {
    page: pageStats,
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
  queueUpdate(clearTransientLocalData);
  setDnrActionBadgeEnabled();
});

chrome.runtime.onStartup.addListener(() => {
  queueUpdate(clearTransientLocalData);
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

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  queueUpdate(() => resetTabStats(details.tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueUpdate(() => removeTabLocalData(tabId));
});

chrome.runtime.onMessage.addListener(handleMessage);
