(function connectGetBlockedDecoyBridge() {
  const BRIDGE_CHANNEL = "getblocked-decoy-bridge-v1";
  const DECOY_MODE_KEY = "getblockedDecoyMode";
  const channel = new MessageChannel();
  const bridgePort = channel.port1;

  function hasValidExtensionContext() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch (error) {
      return false;
    }
  }

  function publishConfiguration(configuration) {
    bridgePort.postMessage({
      type: "configure",
      enabled: configuration?.enabled === true,
      profile: configuration?.profile || null
    });
  }

  function requestConfiguration() {
    if (!hasValidExtensionContext()) {
      return;
    }

    chrome.runtime
      .sendMessage({ type: "GETBLOCKED_DECOY_CONFIG" })
      .then((response) => {
        if (response?.ok) {
          publishConfiguration(response.configuration);
        }
      })
      .catch(() => {});
  }

  bridgePort.onmessage = (event) => {
    if (
      event.data?.type !== "request-decoyed" ||
      !hasValidExtensionContext()
    ) {
      return;
    }

    chrome.runtime
      .sendMessage({
        type: "GETBLOCKED_DECOYED_REQUEST",
        hostname: event.data.hostname,
        transport: event.data.transport
      })
      .catch(() => {});
  };
  bridgePort.start();

  window.postMessage(
    { channel: BRIDGE_CHANNEL, type: "connect" },
    "*",
    [channel.port2]
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[DECOY_MODE_KEY]) {
      requestConfiguration();
    }
  });

  requestConfiguration();
})();
