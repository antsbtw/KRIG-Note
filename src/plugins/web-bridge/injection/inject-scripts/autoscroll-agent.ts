/**
 * AI WebView auto-scroll agent.
 *
 * Problem: inside Electron <webview>, the AI sites' built-in
 * auto-scroll-to-bottom behavior sometimes stops firing when a long
 * assistant message streams in. The user then sees their prompt stuck
 * at the top and has to manually drag the scrollbar to follow the
 * answer.
 *
 * Solution: a tiny agent running inside the guest page that:
 *   - Locates the message-list scroll container at startup (walks up
 *     from the most-recent-message selector to the first ancestor with
 *     overflow-y: auto | scroll).
 *   - Watches that container for DOM mutations (new content appended).
 *   - When mutation fires AND the user is currently within THRESHOLD
 *     pixels of the bottom, scrolls back to the bottom.
 *   - When the user deliberately scrolls up past THRESHOLD, remembers
 *     that and stops following until they either return to the bottom
 *     manually, or a floating "↓ 跳到最新" button (rendered by the
 *     host KRIG renderer) forces a jump.
 *
 * The agent exposes its state via globals so the host renderer can
 * read it:
 *   window.__krig_autoscroll_state = {
 *     installed: boolean,
 *     following: boolean,      // true when within threshold
 *     distanceToBottom: number,
 *   };
 *   window.__krig_autoscroll_jumpToBottom(): void;
 *
 * Idempotent: calling the script repeatedly is safe (checks
 * `window.__krig_autoscroll_installed`).
 *
 * Agent version is bumped when logic changes so an old install can be
 * replaced on page navigation (checked via __krig_autoscroll_version).
 */

/**
 * Returns a self-contained script string suitable for
 * webview.executeJavaScript(). Caller may pass a CSS selector hint for
 * the last assistant message; if provided it's used as the starting
 * point for scroll-container detection.
 */
export function getAutoscrollAgentScript(
  assistantMessageSelector: string,
): string {
  return `(function() {
  var VERSION = 1;
  if (window.__krig_autoscroll_version === VERSION) return 'already-installed';
  // If an older version is running, tear it down so the new listeners replace it.
  if (window.__krig_autoscroll_cleanup) {
    try { window.__krig_autoscroll_cleanup(); } catch (e) {}
  }
  window.__krig_autoscroll_version = VERSION;

  var THRESHOLD = 300; // px — follow the bottom when within this many
  var HIDE_BUTTON_AT = 80; // host hides the floating button when below this

  var assistantSel = ${JSON.stringify(assistantMessageSelector)};
  var container = null;
  var observer = null;
  var pinnedFollowing = true;    // following only pauses when the user scrolls up
  var rafPending = false;

  /**
   * Find the scroll container: walk up from the most-recent message
   * until we hit an element whose computed overflow-y is auto/scroll
   * and which is actually scrollable (scrollHeight > clientHeight).
   * Fall back to documentElement so we always have something.
   */
  function locateContainer() {
    var msgs = document.querySelectorAll(assistantSel);
    var start = msgs.length > 0 ? msgs[msgs.length - 1] : document.body;
    var el = start;
    for (var i = 0; i < 20 && el && el !== document.body; i++) {
      try {
        var cs = getComputedStyle(el);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 10) {
          return el;
        }
      } catch (e) {}
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function distanceToBottom() {
    if (!container) return 0;
    return container.scrollHeight - container.scrollTop - container.clientHeight;
  }

  function publishState() {
    window.__krig_autoscroll_state = {
      installed: true,
      following: pinnedFollowing,
      distanceToBottom: distanceToBottom(),
    };
  }

  function scrollToBottom() {
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }

  function onMutate() {
    if (!pinnedFollowing) { publishState(); return; }
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      scrollToBottom();
      publishState();
    });
  }

  function onUserScroll() {
    // When user scrolls up past threshold: pause following.
    // When user returns to within HIDE_BUTTON_AT px: resume following.
    var d = distanceToBottom();
    if (d > THRESHOLD) pinnedFollowing = false;
    if (d < HIDE_BUTTON_AT) pinnedFollowing = true;
    publishState();
  }

  // A "programmatic" scroll that shouldn't flip following.
  window.__krig_autoscroll_jumpToBottom = function () {
    pinnedFollowing = true;
    scrollToBottom();
    publishState();
  };

  function install() {
    container = locateContainer();
    if (!container) return false;

    observer = new MutationObserver(onMutate);
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    container.addEventListener('scroll', onUserScroll, { passive: true });

    // Also watch for the common case where the AI site mounts the
    // scroll container AFTER first assistant message arrives. If we
    // end up on document.body we'll keep retrying every 2s until a
    // real scrollable ancestor appears.
    if (container === (document.scrollingElement || document.documentElement)) {
      var retries = 0;
      var retryTimer = setInterval(function () {
        var next = locateContainer();
        if (next && next !== container) {
          uninstall();
          container = next;
          install();
          clearInterval(retryTimer);
        }
        if (++retries > 15) clearInterval(retryTimer);
      }, 2000);
    }

    publishState();
    return true;
  }

  function uninstall() {
    if (observer) { observer.disconnect(); observer = null; }
    if (container) container.removeEventListener('scroll', onUserScroll);
  }

  window.__krig_autoscroll_installed = true;
  window.__krig_autoscroll_cleanup = uninstall;

  install();
  return 'installed';
})()`;
}

/** Polled by the host renderer to decide whether to show the jump button. */
export function getAutoscrollStateScript(): string {
  return `(function() { return window.__krig_autoscroll_state || { installed: false, following: true, distanceToBottom: 0 }; })()`;
}

/** Triggered by the host renderer when the user clicks the jump button. */
export function getAutoscrollJumpScript(): string {
  return `(function() {
    if (typeof window.__krig_autoscroll_jumpToBottom === 'function') {
      window.__krig_autoscroll_jumpToBottom();
      return true;
    }
    return false;
  })()`;
}
