(function scanForTrackingSignals() {
  const { TRACKING_PARAMS, TRACKER_DOMAINS, TRACKER_CATEGORIES } =
    globalThis.GetBlockedConfig;
  const trackedParamSet = new Set(TRACKING_PARAMS);
  const trackerDomainSet = new Set(TRACKER_DOMAINS);
  const TRACKABLE_SELECTOR =
    "a[href],area[href],form[action],img[src],iframe[src],script[src],link[href]";
  const SCAN_DEBOUNCE_MS = 600;
  let scanTimer = 0;
  let observer = null;
  let contextActive = true;

  function stopScanning() {
    contextActive = false;

    try {
      window.clearTimeout(scanTimer);
    } catch (error) {
      // The page's old extension world may already be unavailable.
    }

    try {
      observer?.disconnect();
    } catch (error) {
      // The observer belongs to the invalidated extension world.
    }

    observer = null;
  }

  function hasValidExtensionContext() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch (error) {
      return false;
    }
  }

  function sendPageSignals(payload) {
    try {
      if (!hasValidExtensionContext()) {
        stopScanning();
        return;
      }

      chrome.runtime
        .sendMessage({
          type: "GETBLOCKED_PAGE_SIGNALS",
          payload
        })
        .catch(stopScanning);
    } catch (error) {
      stopScanning();
    }
  }

  function getElementUrl(element) {
    if (element.hasAttribute("href")) {
      return element.getAttribute("href");
    }

    if (element.hasAttribute("src")) {
      return element.getAttribute("src");
    }

    if (element.hasAttribute("action")) {
      return element.getAttribute("action");
    }

    return "";
  }

  function toAbsoluteUrl(rawUrl) {
    try {
      return new URL(rawUrl, window.location.href);
    } catch (error) {
      return null;
    }
  }

  function hasTrackingParams(url) {
    for (const key of url.searchParams.keys()) {
      if (trackedParamSet.has(key)) {
        return true;
      }
    }

    return false;
  }

  function isKnownTrackerHost(hostname) {
    return Array.from(trackerDomainSet).some((domain) => {
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  }

  function getTrackerCategories(hostname) {
    const categories = [];

    for (const [category, domains] of Object.entries(TRACKER_CATEGORIES)) {
      const matched = domains.some((domain) => {
        return hostname === domain || hostname.endsWith(`.${domain}`);
      });

      if (matched) {
        categories.push(category);
      }
    }

    return categories;
  }

  function isApproxThirdParty(url) {
    const pageHost = window.location.hostname.toLowerCase();
    const requestHost = url.hostname.toLowerCase();

    return (
      requestHost !== pageHost &&
      !requestHost.endsWith(`.${pageHost}`) &&
      !pageHost.endsWith(`.${requestHost}`)
    );
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return true;
    }

    if (element.matches("script,link")) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function scanPage() {
    if (!contextActive || !hasValidExtensionContext()) {
      stopScanning();
      return;
    }

    try {
      const elements = Array.from(document.querySelectorAll(TRACKABLE_SELECTOR));
      const trackerResourceUrls = new Set();
      const detectedCategories = new Set();
      let trackingLinks = 0;
      let trackerElements = 0;
      let visibleAttempts = 0;

      for (const element of elements) {
        const rawUrl = getElementUrl(element);
        if (!rawUrl) {
          continue;
        }

        const url = toAbsoluteUrl(rawUrl);
        if (!url || !["http:", "https:"].includes(url.protocol)) {
          continue;
        }

        const knownTrackerResource =
          isKnownTrackerHost(url.hostname) && isApproxThirdParty(url);
        const trackingLink =
          element.matches("a[href],area[href],form[action]") &&
          hasTrackingParams(url);

        if (trackingLink) {
          trackingLinks += 1;
          detectedCategories.add("URL tracking parameters");
        }

        if (knownTrackerResource) {
          trackerElements += 1;
          for (const category of getTrackerCategories(url.hostname)) {
            detectedCategories.add(category);
          }

          if (!element.matches("a[href],area[href],form[action]")) {
            trackerResourceUrls.add(url.href);
          }
        }

        if ((trackingLink || knownTrackerResource) && isVisible(element)) {
          visibleAttempts += 1;
        }
      }

      sendPageSignals({
        trackingLinksDetected: trackingLinks,
        trackerElementsDetected: trackerElements,
        visibleAttempts,
        estimatedTrackerRequests: trackerResourceUrls.size,
        detectedCategories: Array.from(detectedCategories)
      });
    } catch (error) {
      stopScanning();
    }
  }

  function scheduleScan() {
    try {
      if (!contextActive || !hasValidExtensionContext()) {
        stopScanning();
        return;
      }

      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scanPage, SCAN_DEBOUNCE_MS);
    } catch (error) {
      stopScanning();
    }
  }

  scanPage();

  if (contextActive) {
    observer = new MutationObserver(() => {
      scheduleScan();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "src", "action", "style", "class"]
    });
  }
})();
