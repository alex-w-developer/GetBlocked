(function connectGetBlockedDecoyBridge() {
  const BRIDGE_CHANNEL = "getblocked-decoy-bridge-v1";
  const DECOY_MODE_KEY = "getblockedDecoyMode";
  const channel = new MessageChannel();
  const bridgePort = channel.port1;
  const reports = globalThis.GetBlockedDecoyReports;
  const pendingDomains = new Set();
  let reportDomains = new Set();
  let pendingCount = 0;
  let timer;
  let enabled = false;
  let configurationVersion = 0;

  function hasValidExtensionContext() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch (error) {
      return false;
    }
  }

  function publishConfiguration(configuration, domains = []) {
    enabled = configuration?.enabled === true;
    reportDomains = new Set(domains);
    bridgePort.postMessage({
      type: "configure",
      enabled,
      profile: configuration?.profile || null
    });
  }

  function requestConfiguration() {
    const version = ++configurationVersion;
    if (!hasValidExtensionContext()) {
      return;
    }

    chrome.runtime
      .sendMessage({ type: "GETBLOCKED_DECOY_CONFIG" })
      .then((response) => {
        if (response?.ok && version === configurationVersion) {
          publishConfiguration(response.configuration, response.reportDomains);
        }
      })
      .catch(() => {});
  }

  function clearPendingReports() {
    clearTimeout(timer);
    timer = undefined;
    pendingCount = 0;
    pendingDomains.clear();
  }

  function flushReports() {
    if (enabled && hasValidExtensionContext()) {
      chrome.runtime.sendMessage({
        type: "GETBLOCKED_DECOYED_REQUESTS",
        count: pendingCount,
        domains: Array.from(pendingDomains)
      }).catch(() => {});
    }
    clearPendingReports();
  }

  bridgePort.onmessage = (event) => {
    if (!enabled || pendingCount >= reports.maxCount || !hasValidExtensionContext()) return;
    const domain = reports.catalogDomain(event.data, reportDomains);
    if (!domain) return;
    pendingDomains.add(domain);
    pendingCount++;
    if (timer === undefined) timer = setTimeout(flushReports, 1000);
  };
  bridgePort.start();

  window.postMessage(
    { channel: BRIDGE_CHANNEL, type: "connect" },
    "*",
    [channel.port2]
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[DECOY_MODE_KEY]) {
      if (changes[DECOY_MODE_KEY].newValue !== true) {
        clearPendingReports();
        publishConfiguration(null);
      }
      requestConfiguration();
    }
  });

  window.addEventListener("pagehide", clearPendingReports);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) requestConfiguration();
  });
  requestConfiguration();
})();
