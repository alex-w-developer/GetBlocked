(function exposeGetBlockedDecoyTransform(globalScope) {
  const PROFILE_FIELD_MAP = Object.freeze({
    anonymousid: "anonymousId",
    anonymousidentifier: "anonymousId",
    anonid: "anonymousId",
    distinctid: "userId",
    ecid: "anonymousId",
    clientid: "clientId",
    cid: "clientId",
    userid: "userId",
    uid: "userId",
    visitorid: "userId",
    customerid: "userId",
    personid: "userId",
    profileid: "userId",
    deviceid: "deviceId",
    sessionid: "sessionId",
    sid: "sessionId",
    email: "email",
    emailaddress: "email",
    useremail: "email",
    firstname: "firstName",
    givenname: "firstName",
    lastname: "lastName",
    surname: "lastName",
    familyname: "lastName",
    fullname: "fullName",
    displayname: "fullName",
    username: "username",
    phonenumber: "phone",
    mobilephone: "phone",
    phone: "phone"
  });

  function normalizeFieldName(fieldName) {
    return String(fieldName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function replacementForField(fieldName, profile) {
    const profileField = PROFILE_FIELD_MAP[normalizeFieldName(fieldName)];
    const replacement = profileField ? profile?.[profileField] : undefined;

    return typeof replacement === "string" && replacement.length > 0
      ? replacement
      : null;
  }

  function replaceObject(value, profile) {
    if (Array.isArray(value)) {
      let changed = false;
      const nextValue = value.map((item) => {
        const result = replaceObject(item, profile);
        changed = changed || result.changed;
        return result.value;
      });

      return { value: changed ? nextValue : value, changed };
    }

    if (!value || typeof value !== "object") {
      return { value, changed: false };
    }

    let changed = false;
    const nextValue = Object.create(null);

    for (const [key, currentValue] of Object.entries(value)) {
      const replacement = replacementForField(key, profile);

      if (replacement !== null) {
        nextValue[key] = replacement;
        changed = changed || currentValue !== replacement;
        continue;
      }

      const nested = replaceObject(currentValue, profile);
      nextValue[key] = nested.value;
      changed = changed || nested.changed;
    }

    return { value: changed ? nextValue : value, changed };
  }

  function replaceSearchParams(params, profile) {
    let changed = false;
    const nextParams = new URLSearchParams();

    for (const [key, currentValue] of params.entries()) {
      const replacement = replacementForField(key, profile);
      const nextValue = replacement === null ? currentValue : replacement;
      changed = changed || nextValue !== currentValue;
      nextParams.append(key, nextValue);
    }

    return { value: changed ? nextParams : params, changed };
  }

  function replaceUrl(rawUrl, baseUrl, profile) {
    try {
      const url = new URL(rawUrl, baseUrl);
      const result = replaceSearchParams(url.searchParams, profile);

      if (!result.changed) {
        return { value: rawUrl, changed: false, hostname: url.hostname };
      }

      url.search = result.value.toString();
      return { value: url.href, changed: true, hostname: url.hostname };
    } catch (error) {
      return { value: rawUrl, changed: false, hostname: "" };
    }
  }

  function replaceText(text, profile, contentType = "") {
    if (typeof text !== "string" || text.length === 0) {
      return { value: text, changed: false };
    }

    const normalizedType = String(contentType).toLowerCase();
    const trimmed = text.trim();
    const looksLikeJson =
      normalizedType.includes("json") ||
      trimmed.startsWith("{") ||
      trimmed.startsWith("[");

    if (looksLikeJson) {
      try {
        const parsed = JSON.parse(text);
        const result = replaceObject(parsed, profile);
        return result.changed
          ? { value: JSON.stringify(result.value), changed: true }
          : { value: text, changed: false };
      } catch (error) {
        // Fall through to form parsing when a body only resembles JSON.
      }
    }

    const looksLikeForm =
      normalizedType.includes("application/x-www-form-urlencoded") ||
      (!trimmed.includes("\n") && trimmed.includes("="));

    if (looksLikeForm) {
      const result = replaceSearchParams(new URLSearchParams(text), profile);
      return result.changed
        ? { value: result.value.toString(), changed: true }
        : { value: text, changed: false };
    }

    return { value: text, changed: false };
  }

  function replaceBody(body, profile, contentType = "") {
    if (typeof body === "string") {
      return replaceText(body, profile, contentType);
    }

    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return replaceSearchParams(body, profile);
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      let changed = false;
      const nextBody = new FormData();

      for (const [key, currentValue] of body.entries()) {
        const replacement =
          typeof currentValue === "string"
            ? replacementForField(key, profile)
            : null;
        const nextValue = replacement === null ? currentValue : replacement;
        changed = changed || nextValue !== currentValue;
        nextBody.append(key, nextValue);
      }

      return { value: changed ? nextBody : body, changed };
    }

    return { value: body, changed: false };
  }

  function isKnownTrackerHost(hostname, trackerDomains) {
    const normalizedHost = String(hostname || "").toLowerCase();
    return trackerDomains.some((domain) => {
      return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
    });
  }

  function isKnownTrackerUrl(rawUrl, baseUrl, trackerDomains) {
    try {
      return isKnownTrackerHost(
        new URL(rawUrl, baseUrl).hostname,
        trackerDomains
      );
    } catch (error) {
      return false;
    }
  }

  globalScope.GetBlockedDecoyTransform = Object.freeze({
    isKnownTrackerHost,
    isKnownTrackerUrl,
    replaceBody,
    replaceObject,
    replaceSearchParams,
    replaceText,
    replaceUrl,
    replacementForField
  });
})(globalThis);
