(function exposeTrackerScope(globalScope) {
  const sites = new Map(Object.entries(globalScope.GetBlockedConfig.TRACKER_SITES));

  // DNR requestDomains ignores trailing dots when matching a catalog entry.
  function catalogHostname(hostname) {
    return hostname.replace(/\.+$/, "");
  }

  // Inputs are canonical URL hostnames. Look up only the destination's ancestors.
  function isThirdPartyTrackerHost(requestHost, initiatorHost) {
    const host = catalogHostname(requestHost);
    const trailingDots = requestHost.slice(host.length);
    let candidate = host;
    while (candidate) {
      const site = sites.get(candidate);
      if (site) {
        // Chromium retains a single root dot in its registrable-site comparison.
        // Hosts with multiple trailing dots have no registrable site.
        if (trailingDots.length > 1) return initiatorHost !== requestHost;
        const requestSite = site + trailingDots;
        return initiatorHost !== requestSite && !initiatorHost.endsWith("." + requestSite);
      }
      const separator = candidate.indexOf(".");
      if (separator < 0) break;
      candidate = candidate.slice(separator + 1);
    }
    return false;
  }

  globalScope.GetBlockedTrackerScope = Object.freeze({ catalogHostname, isThirdPartyTrackerHost });
})(globalThis);
