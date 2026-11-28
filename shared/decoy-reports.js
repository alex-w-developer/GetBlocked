(function defineDecoyReports() {
  const transports = new Set(["fetch", "xhr", "beacon"]);
  const maxCount = 64;

  function catalogDomain(report, domains) {
    if (report?.type !== "request-decoyed" || !transports.has(report.transport) ||
        typeof report.hostname !== "string" || report.hostname.length > 253 ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(report.hostname)) return null;

    let host = report.hostname;
    while (!domains.has(host)) {
      const dot = host.indexOf(".");
      if (dot < 0) return null;
      host = host.slice(dot + 1);
    }
    return host;
  }

  function isValidBatch(message, domains) {
    return Number.isInteger(message.count) && message.count > 0 && message.count <= maxCount &&
      Array.isArray(message.domains) && message.domains.length > 0 &&
      message.domains.length <= message.count && message.domains.length <= domains.size &&
      message.domains.every((host) => domains.has(host));
  }

  globalThis.GetBlockedDecoyReports = Object.freeze({ catalogDomain, isValidBatch, maxCount });
})();
