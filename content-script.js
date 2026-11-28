(function scanForTrackingSignals() {
  const { TRACKING_PARAMS, TRACKER_CATEGORIES } =
    globalThis.GetBlockedConfig;
  const trackedParamSet = new Set(TRACKING_PARAMS);
  const { catalogHostname, isThirdPartyTrackerHost } = globalThis.GetBlockedTrackerScope;
  const TRACKABLE_SELECTOR =
    "a[href],area[href],form[action],img[src],iframe[src],script[src],link[href]";

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
        return;
      }

      chrome.runtime
        .sendMessage({
          type: "GETBLOCKED_PAGE_SIGNALS",
          payload
        })
        .catch(() => {});
    } catch (error) {
      // Reloading an unpacked extension invalidates scripts in existing tabs.
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

  function toAbsoluteUrl(rawUrl, baseURI = document.baseURI || window.location.href) {
    try {
      return new URL(rawUrl, baseURI);
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
    if (!hasValidExtensionContext()) {
      return;
    }

    try {
      const initiatorHost = window.origin === "null" ? "" : window.location.hostname;
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

        const url = toAbsoluteUrl(rawUrl, element.baseURI);
        if (!url || !["http:", "https:"].includes(url.protocol)) {
          continue;
        }

        const knownTrackerResource =
          isThirdPartyTrackerHost(url.hostname, initiatorHost);
        const trackingLink =
          element.matches("a[href],area[href],form[action]") &&
          hasTrackingParams(url);

        if (trackingLink) {
          trackingLinks += 1;
          detectedCategories.add("URL tracking parameters");
        }

        if (knownTrackerResource) {
          trackerElements += 1;
          for (const category of getTrackerCategories(catalogHostname(url.hostname))) {
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
      // A context invalidated during the scan should stop quietly.
    }
  }

  // A restored document keeps its scripts, while the navigation resets its tab report.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) scanPage();
  });
  scanPage();
})();
