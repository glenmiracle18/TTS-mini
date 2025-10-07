type Msg =
  | { type: "GET_SELECTION" }
  | { type: "CLEAR_SELECTION"; selection: string };

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg.type === "GET_SELECTION") {
    const sel = window.getSelection();
    const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
    console.log("Sending selection:", text); // Add logging
    sendResponse(text);
  }

  if (msg.type === "CLEAR_SELECTION") {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    sendResponse({ ok: true });
  }
});

// Add a ping to verify content script is loaded
console.log("Content script loaded");
