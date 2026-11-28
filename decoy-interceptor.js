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
    const stopReading = () => {
      expired = true;
      void reader.cancel().catch(() => {});
    };
    request.signal.addEventListener("abort", stopReading, { once: true });
    const timeout = setTimeout(stopReading, MAX_BODY_WAIT_MS);
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
      request.signal.removeEventListener("abort", stopReading);
      if (!complete && !expired) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  // Web IDL reads RequestInit dictionary members by name. Delegate each
  // option to the original object, including inherited options and getters.
  function withBody(options, body, explicitOptions) {
    return new Proxy({}, {
      get(_, name) {
        if (name === "body") return body;
        return options && name in options ? options[name] : explicitOptions?.[name];
      }
    });
  }

  function supportsEmbeddedText(contentType) {
    const charset = /;\s*charset\s*=\s*"?([^";\s]+)/.exec(contentType)?.[1];
    return (!charset || charset === "utf-8" || charset === "utf8") &&
      (contentType.includes("json") || contentType.startsWith("text/") ||
       contentType.includes("application/x-www-form-urlencoded"));
  }

  function keepaliveBodyFits(body) {
    const text = body instanceof URLSearchParams ? body.toString() : body;
    return typeof text !== "string" ||
      (text.length <= MAX_BODY_BYTES && new TextEncoder().encode(text).length <= MAX_BODY_BYTES);
  }

  async function rewriteEmbeddedRequest(request, init, urlResult, profile) {
    const contentType = getContentType(request.headers).toLowerCase();
    const inspectText = supportsEmbeddedText(contentType);
    if (request.signal.aborted || (!inspectText && !urlResult.changed)) return null;

    // Snapshot exposed Request options and explicit write-only RequestInit
    // values (e.g. priority) before waiting for the body.
    const destination = urlResult.changed
      ? new Request(urlResult.value, withBody(request, null, init))
      : request;
    const bytes = await readSmallBody(request);
    if (!bytes || request.signal.aborted) return null;
    if (inspectText) {
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(await bytes.arrayBuffer());
      } catch {
        // Preserve the exact bytes if only the URL can be changed.
      }
      if (text !== undefined) {
        const result = transform.replaceText(text, profile, contentType);
        if (result.changed && (!request.keepalive || keepaliveBodyFits(result.value))) {
          return new Request(destination, { body: result.value });
        }
      }
    }
    return urlResult.changed ? new Request(destination, { body: bytes }) : null;
  }

  if (typeof nativeFetch === "function") {
    globalThis.fetch = async function getBlockedDecoyFetch(input, init) {
      if (!isReady() || arguments.length === 0) return Reflect.apply(nativeFetch, this, arguments);
      // Native fetch coerces a non-Request URL argument once.
      const nativeInput = input instanceof Request ? input : `${input}`;
      const rawUrl = nativeInput instanceof Request ? nativeInput.url : nativeInput;
      const trackerUrl = thirdPartyTrackerUrl(rawUrl);
      if (!trackerUrl) return Reflect.apply(nativeFetch, this, [nativeInput, init]);

      const profile = state.profile;
      const urlResult = transform.replaceUrl(trackerUrl, profile);
      if (input instanceof Request && input.body && init?.body == null) {
        // Transfer the original body and capture caller options just as fetch
        // would. A suspended, oversized or aborted upload keeps this Request.
        const effective = new Request(input, init);
        let rewritten;
        try {
          rewritten = await rewriteEmbeddedRequest(effective, init, urlResult, profile);
        } catch {
          // Some Request types cannot be rebuilt with a new URL.
        }
        if (rewritten) reportDecoyed(trackerUrl.hostname, "fetch");
        return Reflect.apply(nativeFetch, this, [rewritten || effective]);
      }

      // Native fetch snapshots a direct BodyInit, headers and options during
      // the call. Dispatch this path before control returns to the caller.
      let nextInput = nativeInput;
      let nextInit = init;
      let changed = false;
      try {
        if (urlResult.changed) {
          nextInput = input instanceof Request
            ? new Request(urlResult.value, withBody(input, null))
            : urlResult.value;
          changed = true;
        }
        const keepalive = init?.keepalive ?? input?.keepalive;
        // The UA chooses the multipart boundary and serialized length. Keep
        // its original FormData so a valid keepalive upload stays in quota.
        if (init?.body != null && !(keepalive && init.body instanceof FormData)) {
          const result = transform.replaceBody(init.body, profile, getContentType(init.headers || input?.headers));
          if (result.changed && (!keepalive || keepaliveBodyFits(result.value))) {
            nextInit = withBody(init, result.value);
            changed = true;
          }
        }
      } catch {
        return Reflect.apply(nativeFetch, this, [nativeInput, init]);
      }

      if (changed) reportDecoyed(trackerUrl.hostname, "fetch");
      return Reflect.apply(nativeFetch, this, [nextInput, nextInit]);
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
