# Paste Module

Third-party clipboard → KRIG Note block tree. Each common source
(Word, Excel, Notion, AI assistants, Wikipedia, VS Code, …) has its
own quirks that produce ugly results if handled by a single generic
converter. This module holds the dispatcher and per-source handlers.

See `docs/note/Paste-Module-Design.md` for the full design and
per-source roadmap. This README is a quick map for contributors.

## Layout

```
paste/
  README.md                  ← this file
  types.ts                   ← PasteHandler / PasteClipboard / PasteResult
  html-to-markdown.ts        ← generic HTML → Markdown converter
  smart-paste-plugin.ts      ← ProseMirror plugin (dispatcher + Cmd+V /
                               Cmd+Shift+V handling)
  sources/
    generic.ts               ← always-match catch-all handler
    (word.ts, notion.ts …)   ← TODO: one per source
```

## Dispatch flow

1. User pastes. ProseMirror routes the event to `smart-paste-plugin`.
2. Plugin inspects `event.clipboardData` into a `PasteClipboard`
   (`{plain, html, hasImage}`).
3. If Shift held → plain text path (no handler dispatch).
4. Else iterate `HANDLERS` in priority order (`specific → generic`);
   first handler whose `detect()` returns true is invoked.
5. Handler returns `{markdown, via}`. Empty `markdown` = soft skip,
   try next.
6. Dispatcher feeds the chosen markdown through
   `viewAPI.markdownToPMNodes` (main-process `md-to-pm`) and replaces
   the current selection with the result.

## Adding a new source handler

1. Make `sources/<name>.ts` exporting a `PasteHandler`:

```ts
export const myHandler: PasteHandler = {
  name: 'myName',
  detect(cb) { return /<some_signature/i.test(cb.html); },
  toMarkdown(cb) { /* produce markdown */ },
};
```

2. Import it in `smart-paste-plugin.ts` and `unshift` into `HANDLERS`
   so it runs before `genericHandler`.

3. Add per-source quirks / known-broken cases to the design doc.

## Not in this module

- **Image paste** (screenshot, copy-image-from-browser) — handled by
  `src/plugins/note/plugins/paste-media.ts` before dispatch. That
  plugin defers to us only when the clipboard also has structural
  HTML (Word/Excel send a PNG fallback).
- **In-editor copy/paste** — default ProseMirror roundtrip, not
  reprocessed here.
- **Markdown file import** — `src/main/storage/md-to-atoms.ts` path,
  unrelated to clipboard.
