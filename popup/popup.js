const pageBlockedEl = document.querySelector("#page-blocked");
const pageDecoyedEl = document.querySelector("#page-decoyed");
const trackingLinksCleanedEl = document.querySelector(
  "#tracking-links-cleaned"
);
const visibleAttemptsEl = document.querySelector("#visible-attempts");
const detectedCategoriesEl = document.querySelector("#detected-categories");
const statusLineEl = document.querySelector("#status-line");
const footerEl = document.querySelector(".footer");
const modeSummaryEl = document.querySelector("#mode-summary");
const decoyModeToggleEl = document.querySelector("#decoy-mode-toggle");
const decoyModeDescriptionEl = document.querySelector(
  "#decoy-mode-description"
);
const unsafeDomainsToggleEl = document.querySelector("#unsafe-domains-toggle");
const unsafeDomainsDescriptionEl = document.querySelector("#unsafe-domains-description");
const siteProtectionToggleEl = document.querySelector("#site-protection-toggle");
const siteProtectionDescriptionEl = document.querySelector("#site-protection-description");
let reportedTabId;
let reportedSite;

function formatCount(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function sendPopupMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      message,
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Extension request failed"));
          return;
        }

        resolve(response);
      }
    );
  });
}

function renderReport(report) {
  const { page, decoyMode } = report;
  const categories = Array.isArray(page.detectedCategories)
    ? page.detectedCategories
    : [];

  pageBlockedEl.textContent = formatCount(page.blockedOnPage);
  pageDecoyedEl.textContent = formatCount(page.decoyedRequests);
  trackingLinksCleanedEl.textContent = formatCount(page.trackingLinksCleaned);
  visibleAttemptsEl.textContent = formatCount(page.visibleAttempts);
  detectedCategoriesEl.replaceChildren(
    ...(categories.length > 0
      ? categories.map((category) => {
          const item = document.createElement("li");
          item.textContent = category;
          return item;
        })
      : [document.createElement("li")])
  );

  if (categories.length === 0) {
    const emptyItem = detectedCategoriesEl.firstElementChild;
    emptyItem.textContent = "No categories detected on this page";
    emptyItem.className = "is-empty";
  }

  decoyModeToggleEl.checked = decoyMode === true;
  decoyModeToggleEl.disabled = false;
  renderUnsafeDomainSetting(report.unsafeDomainBlocking === true);
  unsafeDomainsToggleEl.disabled = false;
  footerEl.classList.toggle("is-warning", decoyMode === true);

  if (decoyMode) {
    modeSummaryEl.textContent = "Decoy Mode is on for all websites.";
    decoyModeDescriptionEl.textContent =
      "On for all websites. Where site protection is enabled, URLs are cleaned and supported analytics identifiers are replaced.";
    statusLineEl.textContent =
      "Tracker blocking is paused on all websites. Trackers may still see your IP address and other network metadata.";
  } else {
    modeSummaryEl.textContent = "Blocking known trackers and cleaning URLs.";
    decoyModeDescriptionEl.textContent =
      "Off for all websites. Known third-party tracker requests are blocked where site protection is enabled.";
    statusLineEl.textContent =
      "GetBlocked! keeps its report data on your device.";
  }
  reportedSite = report.site;
  siteProtectionToggleEl.disabled = !reportedSite;
  siteProtectionToggleEl.checked = reportedSite?.enabled === true;
  siteProtectionDescriptionEl.textContent = reportedSite
    ? `${reportedSite.hostname} only. Reload its open tabs after changing this setting. The community list keeps its own setting.`
    : "Open an HTTP or HTTPS page to change protection for its hostname.";
  if (reportedSite && (page.sitePaused || !reportedSite.enabled)) {
    if (reportedSite.enabled) {
      modeSummaryEl.textContent = "Site protection enabled. Reload to apply.";
    } else {
      modeSummaryEl.textContent = page.sitePaused ? "Site protection is paused on this page." : "Site pause saved. Reload to apply.";
    }
  }
}

function renderUnsafeDomainSetting(enabled) {
  unsafeDomainsToggleEl.checked = enabled;
  unsafeDomainsDescriptionEl.textContent = enabled
    ? "On: listed domains and their subdomains are blocked. Tracker statistics do not count these blocks."
    : "Off: the community list is disabled. It is bundled locally and is not updated automatically.";
}

async function loadReport() {
  try {
    const tab = await queryActiveTab();
    if (!Number.isInteger(tab?.id)) {
      throw new Error("No active page found");
    }

    const { report } = await sendPopupMessage({ type: "GETBLOCKED_REPORT", tabId: tab.id });
    renderReport(report);
    reportedTabId = tab.id;
    return true;
  } catch (error) {
    modeSummaryEl.textContent = "Protection settings unavailable.";
    statusLineEl.textContent = "Could not load the local report. Reopen the popup to try again.";
    decoyModeToggleEl.disabled = true;
    decoyModeDescriptionEl.textContent = "Decoy Mode setting unavailable.";
    siteProtectionToggleEl.disabled = true;
    siteProtectionDescriptionEl.textContent = "Site setting unavailable.";
    unsafeDomainsToggleEl.disabled = true;
    unsafeDomainsDescriptionEl.textContent = "List setting unavailable. Reopen the popup to try again.";
    return false;
  }
}

async function changeSetting(message, settingName) {
  decoyModeToggleEl.disabled = true;
  unsafeDomainsToggleEl.disabled = true;
  siteProtectionToggleEl.disabled = true;
  try {
    await sendPopupMessage(message);
  } catch (error) {
    if (await loadReport()) {
      statusLineEl.textContent = `${settingName} could not be updated. ${error.message}`;
    }
    return;
  }
  await loadReport();
}

document.addEventListener("DOMContentLoaded", loadReport);
decoyModeToggleEl.addEventListener("change", () => changeSetting({
  type: "SET_GETBLOCKED_DECOY_MODE", enabled: decoyModeToggleEl.checked
}, "Decoy Mode"));
unsafeDomainsToggleEl.addEventListener("change", () => changeSetting({
  type: "SET_GETBLOCKED_UNSAFE_DOMAINS", enabled: unsafeDomainsToggleEl.checked
}, "Community list"));
siteProtectionToggleEl.addEventListener("change", () => changeSetting({
  type: "SET_GETBLOCKED_SITE_PROTECTION", tabId: reportedTabId,
  hostname: reportedSite?.hostname, enabled: siteProtectionToggleEl.checked
}, "Site protection"));
