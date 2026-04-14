/**
 * Context Menu Inject
 *
 * Installs a right-click handler inside AI pages. The custom menu ALWAYS
 * pops on right-click — like every browser does — but enables specific
 * actions based on what was clicked. The big one is "📥 提取到笔记",
 * which is only actionable when the click lands inside an assistant
 * message; elsewhere the item is shown grayed-out so the user still
 * sees the app is alive and clicks somewhere useful.
 *
 * Why both contextmenu and pointerdown/mousedown (button===2)? Some
 * ChatGPT image containers call preventDefault on contextmenu or wrap
 * the image in a component that swallows the event. Listening on the
 * two earlier phases too gives us a reliable signal.
 *
 * Host-side (AIWebView) picks up the signal through the webview's
 * `console-message` event by matching CONTEXT_MENU_MARKER, then renders
 * a React overlay at the reported viewport coordinates.
 *
 * Payload:
 *   { x, y, msgIndex }
 *   - x / y are client coordinates inside the guest viewport
 *   - msgIndex is the 0-based index among all assistantMessage elements
 *     in document order, or -1 if the click wasn't inside one
 */

export const CONTEXT_MENU_MARKER = '__krig_ctx_menu__';

export function getContextMenuInjectScript(
  assistantSelector: string,
  _userSelector: string,
): string {
  return `(function() {
  if (window.__krig_ctx_menu_installed) return 'already_installed';
  window.__krig_ctx_menu_installed = true;

  var aSel = ${JSON.stringify(assistantSelector)};

  // composedPath + closest walk so shadow-DOM / wrapper parents don't hide
  // the real assistant container.
  function findAssistantFromEvent(ev) {
    var parts = aSel.split(',').map(function(s) { return s.trim(); });
    var path = (ev.composedPath && ev.composedPath()) || [];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (!node || !node.matches) continue;
      for (var j = 0; j < parts.length; j++) {
        if (node.matches(parts[j])) return node;
      }
    }
    var t = ev.target;
    for (var k = 0; k < parts.length; k++) {
      if (t && t.closest) {
        var hit = t.closest(parts[k]);
        if (hit) return hit;
      }
    }
    return null;
  }

  function allAssistants() {
    var parts = aSel.split(',').map(function(s) { return s.trim(); });
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var nodes = document.querySelectorAll(parts[i]);
      for (var j = 0; j < nodes.length; j++) out.push(nodes[j]);
    }
    return out;
  }

  // Suppress the next 'contextmenu' event after a pointerdown/mousedown
  // so we only report once per right-click even across multiple channels.
  var suppressContextMenu = false;

  function report(ev) {
    // Don't take over editable regions (input / textarea / contenteditable).
    var t = ev.target;
    while (t && t !== document.body) {
      if (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return false;
      t = t.parentElement;
    }

    var hit = findAssistantFromEvent(ev);
    var msgIndex = -1;
    if (hit) {
      var list = allAssistants();
      msgIndex = list.indexOf(hit);
    } else {
      // Fallback for ChatGPT: DALL·E / Code Interpreter images can sit in
      // a conversation-turn wrapper that isn't the assistant element
      // itself. Walk up to the turn and map it back to an assistant index
      // by counting turn-level assistants in doc order.
      var turnSel = '[data-testid^="conversation-turn-"]';
      var t2 = ev.target;
      var turnEl = (t2 && t2.closest) ? t2.closest(turnSel) : null;
      if (!turnEl) {
        var path2 = (ev.composedPath && ev.composedPath()) || [];
        for (var p = 0; p < path2.length; p++) {
          var n = path2[p];
          if (n && n.matches && n.matches(turnSel)) { turnEl = n; break; }
        }
      }
      if (turnEl) {
        var turns = document.querySelectorAll(turnSel);
        var aIdx = -1;
        for (var ti = 0; ti < turns.length; ti++) {
          // Heuristic: any turn containing an assistant-role or Code
          // Interpreter / image output counts as an "assistant turn".
          var tn = turns[ti];
          var hasAssistant = tn.querySelector('[data-message-author-role="assistant"]') ||
                             tn.querySelector('[data-message-author-role="tool"]') ||
                             tn.querySelector('img');
          if (hasAssistant) aIdx++;
          if (tn === turnEl) {
            msgIndex = aIdx;
            break;
          }
        }
      }
    }

    ev.preventDefault();
    ev.stopPropagation();

    var payload = {
      x: ev.clientX,
      y: ev.clientY,
      msgIndex: msgIndex,
    };
    console.log(${JSON.stringify(CONTEXT_MENU_MARKER)} + JSON.stringify(payload));
    return true;
  }

  document.addEventListener('contextmenu', function(ev) {
    if (suppressContextMenu) {
      suppressContextMenu = false;
      ev.preventDefault();
      return;
    }
    report(ev);
  }, true);

  // Backup channels: some components kill 'contextmenu' but not the
  // preceding mouse events. Fire from here and flag the follow-up
  // contextmenu (if any) to be swallowed silently.
  document.addEventListener('pointerdown', function(ev) {
    if (ev.button !== 2) return;
    if (report(ev)) suppressContextMenu = true;
  }, true);
  document.addEventListener('mousedown', function(ev) {
    if (ev.button !== 2) return;
    if (report(ev)) suppressContextMenu = true;
  }, true);

  return 'installed';
})()`;
}
