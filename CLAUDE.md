# pixel-atelier

A standalone pixel / sprite editor built on
[SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit). It is the successor
of the **Atelier** inside BunnyBot's web app
(`SACRVM/bunnybot-web-io`, `public/atelier/` on branch `develop`) — the proven
editor, taken out of its game and made into an app of its own.

## The mission

Rebuild Atelier as a kit app — not a port of its code. Its engine
(`sprite-editor.js`, one 946-line component) is the *spec*: the tools, frames,
onion skin, selection, palette and shortcuts it has are what this app must
have. The UI is built from kit components, which exist for exactly this app
(appkit 2.7.0 "pixel workbench"): `sac-pixel-canvas`, `sac-toolbox`,
`sac-filmstrip`, `sac-layer-list`, `sac-shortcut-sheet`, the colour suite
(`sac-color-picker`, `sac-swatch-grid`, `sac-color-field`), `sac-drop-zone`,
`sac-dialog`. The appkit's `demo/` Pixel Lab shows them working together.

**Leave the domain behind:** nothing BunnyFarm-specific crosses over — no
Firebase, no auth, no Cloud Storage, no farm manifest, no sprite catalog of a
particular game. Identity comes from `context.identity`, files from the kit's
file layer.

## Open / save — the kit's file layer (appkit 2.8.0+)

The appkit built its file layer for this app; use it, do not invent one here.

- **The user's files:** `context.files.open({ accept })` and
  `context.files.save(blob, { name, handle })` → `{ name, file, handle }` or
  `null` (cancelled). Keep the `handle`: passing it back is **Save** (no
  dialog), omitting it is **Save as…**. Standalone this is the device (File
  System Access API, else input + download); on a desktop it is whatever the
  host installed — usually `sac.files.virtual()`, the desktop's shared file
  space. The app never branches on which.
- **The app's own drawer:** `context.fs` — settings, recent files, autosave.
  It stores Blobs too (read back as a File).
- **Unsaved work:** `context.setDirty(true)` on the first edit,
  `setDirty(false)` after a successful save.
- The appkit's Pixel Lab demo (`demo/pixel-lab/app.js`, `_open` / `_save`) is
  the working reference; the style guide documents `sac.files`,
  `<sac-file-browser>` and the rest.

If the kit is missing something, route it to the appkit via Firepit instead of
working around it here.

## The shape (same as every kit app)

**One repo, one app.** `app.json` (the manifest a desktop reads), `app.js`
(custom element, classic script, guarded define), `app.css`, `index.html` as a
standalone harness, and `kit/` — the vendored kit. See
[sacrvm-notes](https://github.com/SACRVM/sacrvm-notes) for a complete example
and the appkit's `CONSUMING.md` for the vendoring recipe.

**No build step, ever.** Vanilla custom elements, plain CSS, `npx serve .` and
F5 — no node_modules, no bundler, no TypeScript.

**The kit is vendored** (autark): `kit/` is the release ZIP's copy, dropped in
verbatim — `kit/VERSION` says which — and never edited here. Use only the
kit's documented API and its tokens — no raw colours.

**Language:** chat in German, code/docs/commits in English.


## Firepit inbox

At the start of a session, read any pending messages in `.firepit/inbox/*.md` — cross-project notes Firepit routes here. Act on each, then mark it done with the `firepit_inbox_complete` MCP tool, passing the message's filename as the `id`.

## Firepit knowledge

Before researching something that may already be known, query the knowledge base with the `firepit_knowledge_search` MCP tool (scope `both` covers this project plus the global base). Save durable findings with `firepit_knowledge_add` — written in English, per the indexing convention. The created markdown files live under `.firepit/knowledge/` and are committed like any other file.

## Firepit pinned knowledge

@.firepit/knowledge-pinned.md

The import above auto-loads the knowledge docs marked `pin: true` in their frontmatter — always-on rules that apply every session without a search. Firepit regenerates the file from the pinned docs; don't edit it directly. Pin/unpin via the pinned flag on `firepit_knowledge_add` / `firepit_knowledge_update`, and keep the pinned set small — everything else stays reachable through `firepit_knowledge_search`.

## Firepit artifacts

When you produce a file the user will want to open — a report, screenshot, diagram, generated image, log excerpt, build output, or an executable you built for them to run — pin it with the `firepit_artifact_add` MCP tool so it appears in the project's paperclip pane. Do this as you produce it, not at the end of the session; a path buried in scrollback is a path the user has to hunt for. Pinning only links the file — it stays where it is, and `firepit_artifact_remove` never deletes it. Check `firepit_artifact_list` first so you update an existing entry instead of piling up near-duplicates, and unpin what has gone stale.

## Firepit conventions

<!-- claude-firepit-fragments -->

@../.firepit/projects/claude.md
@../.firepit/projects/claude-github-public.md

The two imports above are shared files in the Firepit central repo — edit them there and every project follows. They carry policy; the tools themselves are described by Firepit's MCP server at the handshake, so nothing is duplicated between the two.
