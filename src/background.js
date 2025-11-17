chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;

  // Just send the message; let the content script decide
  chrome.tabs.sendMessage(
    tab.id,
    {type: "TR2ZWO_DOWNLOAD"},
    () => {
      // In MV3, sendMessage can fail if no content script is loaded
      if (chrome.runtime.lastError) {
        console.warn(
          "[TR2ZWO] Could not send TR2ZWO_DOWNLOAD message:",
          chrome.runtime.lastError.message
        );
      } else {
        console.log("[TR2ZWO] TR2ZWO_DOWNLOAD message sent to tab", tab.id);
      }
    }
  );
});

