/**
 * User Message Capture Script
 *
 * Injects into AI pages to detect when the user sends a message.
 * Strategy: monitor the input box — when its content goes from non-empty to empty,
 * the user just sent a message. This is reliable across all three AI services.
 *
 * Stores the last sent message in window.__krig_last_user_message.
 */

export function getUserMessageCaptureScript(inputSelector: string): string {
  return `(function() {
  if (window.__krig_user_capture_installed) return 'already_installed';
  window.__krig_user_capture_installed = true;
  window.__krig_last_user_message = '';

  var selector = ${JSON.stringify(inputSelector)};
  var lastContent = '';

  function getInputContent() {
    var selectors = selector.split(',').map(function(s) { return s.trim(); });
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        return (el.textContent || el.value || '').trim();
      }
    }
    return '';
  }

  // Poll every 200ms — lightweight and works across all frameworks
  setInterval(function() {
    var current = getInputContent();
    if (lastContent.length > 0 && current.length === 0) {
      // Input went from non-empty to empty → user just sent a message
      window.__krig_last_user_message = lastContent;
    }
    lastContent = current;
  }, 200);

  return 'installed';
})()`;
}
