(function installGetBlockedDecoyInterceptor() {
  const { TRACKER_DOMAINS } = globalThis.GetBlockedConfig;
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

  function trackerHostname(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      return transform.isKnownTrackerHost(url.hostname, TRACKER_DOMAINS)
        ? url.hostname.toLowerCase()
        : "";
    } catch (error) {
      return "";
    }
  }

  function reportDecoyed(hostname, transport) {
    bridgePort?.postMessage({
      type: "request-decoyed",
      hostname,
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

  if (typeof nativeFetch === "function") {
    globalThis.fetch = async function getBlockedDecoyFetch(input, init) {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const hostname = isReady() ? trackerHostname(rawUrl) : "";

      if (!hostname) {
        return Reflect.apply(nativeFetch, this, arguments);
      }

      let changed = false;
      let nextInput = input;
      let nextInit = init;
      const urlResult = transform.replaceUrl(
        rawUrl,
        window.location.href,
        state.profile
      );

      if (urlResult.changed) {
        changed = true;
        nextInput =
          input instanceof Request
            ? new Request(urlResult.value, input)
            : urlResult.value;
      }

      try {
        const suppliedBody = init?.body;
        const contentType = getContentType(init?.headers || input?.headers);

        if (suppliedBody !== undefined && suppliedBody !== null) {
          const bodyResult = transform.replaceBody(
            suppliedBody,
            state.profile,
            contentType
          );

          if (bodyResult.changed) {
            changed = true;
            nextInit = { ...(init || {}), body: bodyResult.value };
          }
        } else if (
          input instanceof Request &&
          !input.bodyUsed &&
          !["GET", "HEAD"].includes(input.method.toUpperCase()) &&
          (contentType.includes("json") ||
            contentType.includes("application/x-www-form-urlencoded") ||
            contentType.startsWith("text/"))
        ) {
          const bodyText = await input.clone().text();
          const bodyResult = transform.replaceText(
            bodyText,
            state.profile,
            contentType
          );

          if (bodyResult.changed) {
            changed = true;
            nextInit = { ...(init || {}), body: bodyResult.value };
          }
        }
      } catch (error) {
        // Unsupported, locked, or streaming bodies pass through unchanged.
      }

      if (changed) {
        reportDecoyed(hostname, "fetch");
      }

      return Reflect.apply(nativeFetch, this, [nextInput, nextInit]);
    };
  }

  XMLHttpRequest.prototype.open = function getBlockedDecoyXhrOpen(
    method,
    rawUrl,
    ...rest
  ) {
    const hostname = trackerHostname(rawUrl);
    let nextUrl = rawUrl;
    let changed = false;

    if (isReady() && hostname) {
      const result = transform.replaceUrl(
        rawUrl,
        window.location.href,
        state.profile
      );
      nextUrl = result.value;
      changed = result.changed;
    }

    xhrState.set(this, {
      changed,
      headers: {},
      hostname,
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
      const hostname = isReady() ? trackerHostname(rawUrl) : "";

      if (!hostname) {
        return Reflect.apply(nativeSendBeacon, this, arguments);
      }

      const urlResult = transform.replaceUrl(
        rawUrl,
        window.location.href,
        state.profile
      );
      const bodyResult = transform.replaceBody(body, state.profile);

      if (urlResult.changed || bodyResult.changed) {
        reportDecoyed(hostname, "beacon");
      }

      return Reflect.apply(nativeSendBeacon, this, [
        urlResult.value,
        bodyResult.value
      ]);
    };
  }
})();
