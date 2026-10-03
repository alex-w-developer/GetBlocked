// Other browser extensions can also expose a background.js worker.
// Verify the manifest instead of selecting the first filename match.
export async function selectExtensionTarget(targets, manifest, probe) {
  for (const target of targets) {
    if (target.type !== "service_worker" || !target.webSocketDebuggerUrl) continue;
    let url;
    try { url = new URL(target.url); } catch { continue; }
    if (url.protocol !== "chrome-extension:" ||
        url.pathname !== `/${manifest.background.service_worker}`) continue;
    try {
      const identity = await probe(target);
      if (identity?.name === manifest.name && identity?.version === manifest.version &&
          identity?.id === url.hostname) return target;
    } catch {
      // A worker may disappear while Chrome starts; try remaining candidates.
    }
  }
  return null;
}
