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

function requestReport(tabId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "GETBLOCKED_REPORT", tabId },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Report unavailable"));
          return;
        }

        resolve(response.report);
      }
    );
  });
}

function setDecoyMode(enabled) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "SET_GETBLOCKED_DECOY_MODE", enabled },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || "Unable to update Decoy Mode"));
          return;
        }

        resolve(response.configuration);
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
  renderUnsafeDomainSetting(report.unsafeDomainBlocking === true);
  unsafeDomainsToggleEl.disabled = false;
  footerEl.classList.toggle("is-warning", decoyMode === true);

  if (decoyMode) {
    modeSummaryEl.textContent = "Decoy Mode is on for all websites.";
    decoyModeDescriptionEl.textContent =
      "On for all websites: tracker blocking is paused, URL cleanup stays on, and supported analytics identifiers are replaced.";
    statusLineEl.textContent =
      "Tracker blocking is paused on all websites. Trackers may still see your IP address and other network metadata.";
  } else {
    modeSummaryEl.textContent = "Blocking known trackers and cleaning URLs.";
    decoyModeDescriptionEl.textContent =
      "Off: known third-party tracker requests are blocked on all websites.";
    statusLineEl.textContent =
      "GetBlocked! keeps its report data on your device.";
  }
}

function renderUnsafeDomainSetting(enabled) {
  unsafeDomainsToggleEl.checked = enabled;
  unsafeDomainsDescriptionEl.textContent = enabled
    ? "On: listed domains and their subdomains are blocked. Tracker statistics do not count these blocks."
    : "Off: the community list is disabled. It is bundled locally and is not updated automatically.";
}

function setUnsafeDomainBlocking(enabled) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "SET_GETBLOCKED_UNSAFE_DOMAINS", enabled },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error || !response?.ok) {
          reject(new Error(error?.message || response?.error || "Unable to update the community list"));
          return;
        }
        resolve(response.configuration);
      }
    );
  });
}

async function handleUnsafeDomainsChange() {
  const enabled = unsafeDomainsToggleEl.checked;
  unsafeDomainsToggleEl.disabled = true;
  try {
    const configuration = await setUnsafeDomainBlocking(enabled);
    renderUnsafeDomainSetting(configuration.enabled);
  } catch (error) {
    renderUnsafeDomainSetting(!enabled);
    statusLineEl.textContent = "Community list could not be updated. Try again.";
  } finally {
    unsafeDomainsToggleEl.disabled = false;
  }
}

async function loadReport() {
  try {
    const tab = await queryActiveTab();
    if (!tab?.id) {
      throw new Error("No active page found");
    }

    const report = await requestReport(tab.id);
    renderReport(report);
  } catch (error) {
    statusLineEl.textContent = "Open a web page to see a local report.";
    unsafeDomainsToggleEl.disabled = true;
    unsafeDomainsDescriptionEl.textContent = "List setting unavailable. Reopen the popup to try again.";
  }
}

async function handleDecoyModeChange() {
  const enabled = decoyModeToggleEl.checked;
  decoyModeToggleEl.disabled = true;

  try {
    await setDecoyMode(enabled);
    await loadReport();
  } catch (error) {
    decoyModeToggleEl.checked = !enabled;
    statusLineEl.textContent = "Decoy Mode could not be updated. Try again.";
  } finally {
    decoyModeToggleEl.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", loadReport);
decoyModeToggleEl.addEventListener("change", handleDecoyModeChange);
unsafeDomainsToggleEl.addEventListener("change", handleUnsafeDomainsChange);
