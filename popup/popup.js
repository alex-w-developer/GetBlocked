const pageBlockedEl = document.querySelector("#page-blocked");
const trackingLinksCleanedEl = document.querySelector(
  "#tracking-links-cleaned"
);
const visibleAttemptsEl = document.querySelector("#visible-attempts");
const detectedCategoriesEl = document.querySelector("#detected-categories");
const statusLineEl = document.querySelector("#status-line");

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

function renderReport(report) {
  const { page } = report;
  const categories = Array.isArray(page.detectedCategories)
    ? page.detectedCategories
    : [];

  pageBlockedEl.textContent = formatCount(page.blockedOnPage);
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

  statusLineEl.textContent = "No browsing data leaves your device.";
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
  }
}

document.addEventListener("DOMContentLoaded", loadReport);
