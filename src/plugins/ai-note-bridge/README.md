# AI ↔ Note Bridge

Self-contained module that handles every flow between an AI WebView
(Claude / ChatGPT / Gemini) and a Note view. Other modules import from
the public surface in `index.ts`; nothing else should know the
internal layout.

## Two user-facing flows

### 1. Live chat sync (automatic, no toggle)

Whenever AIWebView and NoteView are both mounted, every newly
completed AI turn is forwarded into the note as it finishes streaming.

- Trigger: SSE `message_stop` (or per-service equivalent) on the guest.
- Payload: assistant Markdown with Artifact placeholders replaced by a
  callout asking the user to manually copy from the page.
- No CDP / no mouse simulation / no page interference. The user keeps
  reading the AI page; the note just collects the text.

### 2. "Save to Note" button (one-shot, full history)

Toolbar button. Click → freeze the AI webview (overlay + progress +
cancel) → walk the entire conversation top-down, one turn at a time:
fetch text, fetch artifact PNGs (via Copy-to-clipboard CDP), verify
counts match, emit. Cancel button on the overlay aborts at the next
safe point.

Strict serial: turn N+1 starts only after turn N has emitted (or been
verified-failed and downgraded to a callout).

Refuses to start if no NoteView is currently open in the right slot.

## What this module is NOT responsible for

- Rendering the menu (right-click) — that's `plugins/web/context-menu`
- Inserting nodes into ProseMirror — NoteView's `sync-note-receiver`
  receives `as:append-turn` ViewMessages and handles insertion
- Webview lifecycle, service switching — that's `AIWebView.tsx`

## Layout

```
ai-note-bridge/
  index.ts                  public surface (default exports)
  types.ts                  Session, TurnState, MessageContext, etc.
  pipeline/
    extract-pipeline.ts     serial pipeline used by the save button
    claude-artifacts.ts     Claude Artifact PNG fallback
    verify.ts               post-extraction count verification
  triggers/
    sse-trigger.ts          live-chat trigger (SSE message_stop)
  ui/
    SaveToNoteButton.tsx    toolbar button + freeze overlay
```
