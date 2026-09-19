const BACKEND_URL =
  "http://127.0.0.1:8000/browser-events";


// --------------------------------------------------
// CURRENT PAGE FOR EACH TAB
// --------------------------------------------------

const tabPages = new Map();


// --------------------------------------------------
// URL HELPERS
// --------------------------------------------------

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Unknown";
  }
}


function getUrlParts(url) {
  try {
    const parsed = new URL(url);

    return {
      domain: parsed.hostname,
      path: parsed.pathname
    };

  } catch {
    return {
      domain: "Unknown",
      path: ""
    };
  }
}


// --------------------------------------------------
// FILTER BROWSER INTERNAL URLS
// --------------------------------------------------

function isBrowserInternalUrl(url) {

  if (!url) {
    return true;
  }

  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  );
}


// --------------------------------------------------
// FILTER OUR OWN BACKEND
// --------------------------------------------------

function isOwnBackend(url) {

  return (
    url.startsWith(
      "http://127.0.0.1:8000"
    ) ||
    url.startsWith(
      "http://localhost:8000"
    )
  );
}
function isLocalDevelopmentUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

// --------------------------------------------------
// SEND EVENT TO FASTAPI
// --------------------------------------------------

async function sendEvent(event) {

  try {

    const response = await fetch(
      BACKEND_URL,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify(event)
      }
    );

    if (!response.ok) {

      console.error(
        "Backend rejected browser event:",
        response.status
      );
    }

  } catch (error) {

    console.error(
      "Could not send browser event:",
      error
    );
  }
}


// --------------------------------------------------
// PAGE NAVIGATION
// --------------------------------------------------

chrome.webNavigation.onCommitted.addListener(
  (details) => {

    // Only track the main page.
    if (details.frameId !== 0) {
      return;
    }

    const url = details.url;

    // Ignore browser internal pages.
    if (isBrowserInternalUrl(url)) {
      return;
    }

    // Ignore our own application/backend
    // and local development servers.
    if (isOwnBackend(url) || isLocalDevelopmentUrl(url)) {
      return;
    }

    const pageParts = getUrlParts(url);

    const domain = pageParts.domain;


    // Remember the current page for this tab.
    tabPages.set(
      details.tabId,
      {
        url: url,
        domain: domain
      }
    );


    // Send navigation event.
    sendEvent({

      timestamp:
        new Date().toISOString(),

      event_type:
        "navigation",

      tab_id:
        details.tabId,

      page_url:
        url,

      page_domain:
        domain,

      domain:
        domain,

      path:
        pageParts.path,

      initiator:
        null,

      method:
        "GET",

      resource_type:
        "main_frame"
    });

  }
);


// --------------------------------------------------
// NETWORK REQUEST
// --------------------------------------------------

chrome.webRequest.onBeforeRequest.addListener(

  async (details) => {

    const url = details.url;

    if (
  isOwnBackend(url) ||
  isLocalDevelopmentUrl(url)
) {
  return;
}

if (isBrowserInternalUrl(url)) {
  return;
}


    // -----------------------------------------
    // FIND CURRENT PAGE
    // -----------------------------------------

    let page =
      tabPages.get(details.tabId);


    // If we don't know the page yet,
    // ask the browser for the current tab.
    if (!page && details.tabId >= 0) {

      try {

        const tab =
          await chrome.tabs.get(
            details.tabId
          );

        if (
          tab &&
          tab.url &&
          !isBrowserInternalUrl(tab.url) &&
          !isOwnBackend(tab.url) &&
          !isLocalDevelopmentUrl(tab.url)
        ) {

          const pageParts =
            getUrlParts(tab.url);

          page = {
            url: tab.url,
            domain: pageParts.domain
          };

          // Save it for future requests.
          tabPages.set(
            details.tabId,
            page
          );
        }

      } catch (error) {

        // Tab may have been closed.
        page = null;
      }
    }


    const pageUrl =
      page?.url || null;


    const pageDomain =
      page?.domain || "Unknown";


    // -----------------------------------------
    // REQUEST URL
    // -----------------------------------------

    const urlParts =
      getUrlParts(url);


    // -----------------------------------------
    // SEND EVENT
    // -----------------------------------------

    sendEvent({

      timestamp:
        new Date().toISOString(),

      event_type:
        "request",

      tab_id:
        details.tabId,


      // Page responsible for request
      page_url:
        pageUrl,

      page_domain:
        pageDomain,


      // Requested resource
      domain:
        urlParts.domain,

      path:
        urlParts.path,


      // Browser-provided initiator
      initiator:
        details.initiator || pageUrl,


      method:
        details.method || "UNKNOWN",


      resource_type:
        details.type || "other"

    });

  },

  {
    urls: ["<all_urls>"]
  }

);


// --------------------------------------------------
// TAB CLOSED
// --------------------------------------------------

chrome.tabs.onRemoved.addListener(
  (tabId) => {

    tabPages.delete(tabId);

  }
);