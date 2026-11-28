(function installGetBlockedDecoyInterceptor() {
  const { catalogHostname, isThirdPartyTrackerHost } = globalThis.GetBlockedTrackerScope;
  const transform = globalThis.GetBlockedDecoyTransform;
  const BRIDGE_CHANNEL = "getblocked-decoy-bridge-v1";
  const xhrState = new WeakMap();
  let bridgePort = null;
  const state = {
    enabled: false,
    profile: null
  };

  const nativeFetch = globalThis.fetch;
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  const nativeXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const nativeSendBeacon = Navigator.prototype.sendBeacon;
  const MAX_BODY_BYTES = 64 * 1024;
  const MAX_BODY_CHUNKS = 64;
  const MAX_BODY_WAIT_MS = 50;

  function isReady() {
    return state.enabled && state.profile && typeof state.profile === "object";
  }

  function getContentType(headers) {
    try {
      return new Headers(headers).get("content-type") || "";
    } catch (error) {
      return "";
    }
  }

  function thirdPartyTrackerUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, document.baseURI);
      const initiatorHost = window.origin === "null" ? "" : new URL(window.origin).hostname;
      return isThirdPartyTrackerHost(url.hostname, initiatorHost) ? url : null;
    } catch (error) {
      return null;
    }
  }

  function reportDecoyed(hostname, transport) {
    bridgePort?.postMessage({
      type: "request-decoyed",
      hostname: catalogHostname(hostname),
      transport
    });
  }

  function connectBridge(event) {
    if (
      bridgePort ||
      event.source !== window ||
      event.data?.channel !== BRIDGE_CHANNEL ||
      event.data.type !== "connect" ||
      !event.ports?.[0]
    ) {
      return;
    }

    bridgePort = event.ports[0];
    bridgePort.onmessage = (messageEvent) => {
      if (messageEvent.data?.type !== "configure") {
        return;
      }

      state.enabled = messageEvent.data.enabled === true;
      state.profile = messageEvent.data.profile || null;
    };
    bridgePort.start();
    window.removeEventListener("message", connectBridge);
  }

  window.addEventListener("message", connectBridge);

  // Request exposes even a string body as a stream. A slow or large upload
  // must reach fetch without waiting for a complete buffered copy.
  async function readSmallBody(request) {
    const reader = request.clone().body.getReader();
    const chunks = [];
    let size = 0;
    let complete = false;
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => {});
    }, MAX_BODY_WAIT_MS);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (expired) return null;
        if (done) {
          complete = true;
          return new Blob(chunks);
        }
        size += value.byteLength;
        if (size > MAX_BODY_BYTES || chunks.length >= MAX_BODY_CHUNKS) return null;
        chunks.push(value);
      }
    } finally {
      clearTimeout(timeout);
      if (!complete && !expired) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  // Web IDL reads RequestInit dictionary members by name. Delegate each
  // option to the original object, including inherited options and getters.
  function withBody(options, body) {
    return new Proxy({}, {
      get: (_, name) => name === "body" ? body : options?.[name]
    });
  }

  function supportsEmbeddedText(contentType) {
    const charset = /;\s*charset\s*=\s*"?([^";\s]+)/.exec(contentType)?.[1];
    return (!charset || charset === "utf-8" || charset === "utf8") &&
      (contentType.includes("json") || contentType.startsWith("text/") ||
       contentType.includes("application/x-www-form-urlencoded"));
  }

  async function prepareFetch(input, init, trackerUrl) {
    const urlResult = transform.replaceUrl(trackerUrl, state.profile);
    const fallback = { input, init, changed: false };
    let nextInit = init;
    let bodyForNewUrl = null;
    let bodyChanged = false;
    try {
      if (input instanceof Request && input.body && init?.body == null) {
        // Transfer the body and apply caller options just as fetch would.
        // This effective Request stays usable if the clone cannot be read.
        fallback.input = new Request(input, init);
        fallback.init = undefined;
        nextInit = undefined;
        const contentType = getContentType(fallback.input.headers).toLowerCase();
        if (!supportsEmbeddedText(contentType)) return fallback;
        const bytes = await readSmallBody(fallback.input);
        if (!bytes) return fallback;
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await bytes.arrayBuffer());
        const bodyResult = transform.replaceText(text, state.profile, contentType);
        bodyChanged = bodyResult.changed;
        bodyForNewUrl = bodyChanged ? bodyResult.value : bytes;
        if (bodyChanged && !urlResult.changed) nextInit = { body: bodyResult.value };
      } else if (init?.body != null) {
        const bodyResult = transform.replaceBody(
          init.body, state.profile, getContentType(init.headers || input?.headers)
        );
        if (bodyResult.changed) {
          bodyChanged = true;
          nextInit = withBody(init, bodyResult.value);
        }
      }

      let nextInput = fallback.input;
      if (urlResult.changed) {
        nextInput = nextInput instanceof Request
          ? new Request(urlResult.value, withBody(nextInput, bodyForNewUrl))
          : urlResult.value;
      }
      return { input: nextInput, init: nextInit, changed: urlResult.changed || bodyChanged };
    } catch {
      return fallback;
    }
  }

  if (typeof nativeFetch === "function") {
    globalThis.fetch = async function getBlockedDecoyFetch(input, init) {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const trackerUrl = isReady() ? thirdPartyTrackerUrl(rawUrl) : null;
      if (!trackerUrl) return Reflect.apply(nativeFetch, this, arguments);

      const prepared = await prepareFetch(input, init, trackerUrl);
      if (prepared.changed) reportDecoyed(trackerUrl.hostname, "fetch");
      return Reflect.apply(nativeFetch, this, [prepared.input, prepared.init]);
    };
  }

  XMLHttpRequest.prototype.open = function getBlockedDecoyXhrOpen(
    method,
    rawUrl,
    ...rest
  ) {
    const trackerUrl = thirdPartyTrackerUrl(rawUrl);
    let nextUrl = rawUrl;
    let changed = false;

    if (isReady() && trackerUrl) {
      const result = transform.replaceUrl(trackerUrl, state.profile);
      nextUrl = result.value;
      changed = result.changed;
    }

    xhrState.set(this, {
      changed,
      headers: {},
      hostname: trackerUrl?.hostname,
      reported: false
    });

    return Reflect.apply(nativeXhrOpen, this, [method, nextUrl, ...rest]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function getBlockedDecoyXhrHeader(
    name,
    value
  ) {
    const requestState = xhrState.get(this);
    if (requestState) {
      requestState.headers[String(name).toLowerCase()] = String(value);
    }
    return Reflect.apply(nativeXhrSetRequestHeader, this, arguments);
  };

  XMLHttpRequest.prototype.send = function getBlockedDecoyXhrSend(body) {
    const requestState = xhrState.get(this);
    let nextBody = body;

    if (isReady() && requestState?.hostname) {
      const result = transform.replaceBody(
        body,
        state.profile,
        requestState.headers["content-type"] || ""
      );
      nextBody = result.value;
      requestState.changed = requestState.changed || result.changed;
    }

    if (requestState?.changed && !requestState.reported) {
      requestState.reported = true;
      reportDecoyed(requestState.hostname, "xhr");
    }

    return Reflect.apply(nativeXhrSend, this, [nextBody]);
  };

  if (typeof nativeSendBeacon === "function") {
    Navigator.prototype.sendBeacon = function getBlockedDecoySendBeacon(
      rawUrl,
      body
    ) {
      const trackerUrl = isReady() ? thirdPartyTrackerUrl(rawUrl) : null;

      if (!trackerUrl) {
        return Reflect.apply(nativeSendBeacon, this, arguments);
      }

      const urlResult = transform.replaceUrl(trackerUrl, state.profile);
      const bodyResult = transform.replaceBody(body, state.profile);

      if (urlResult.changed || bodyResult.changed) {
        reportDecoyed(trackerUrl.hostname, "beacon");
      }

      return Reflect.apply(nativeSendBeacon, this, [
        urlResult.value,
        bodyResult.value
      ]);
    };
  }
})();
