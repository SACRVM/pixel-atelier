# Pixel Atelier

A pixel and sprite editor with layers, frames, onion skin and palettes. It runs
in the browser with no install and no build step. Built on
[SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit); runs standalone or
as an app on a SACRVM desktop.

```bash
npx serve .
```

## What it does

- **Tools:** pencil, eraser, fill, eyedropper, line, rectangle and ellipse
  (outline or filled), brush 1–4 px. Alt+click picks a color with any tool,
  Shift+click draws a line from the last point.
- **Selection:** a marquee whose contents float once touched. Drag or nudge it
  with the arrows, flip it (Shift+H / Shift+V), trim it to its content, and
  copy / cut / paste in place. Pasting also takes images from other apps.
- **Frames:** add, duplicate, delete and reorder. Onion skin wraps the loop.
  Play the animation in place, or watch it in the preview while you paint.
- **Layers:** add, duplicate, reorder, rename, hide and lock.
- **Palette:** starts from DawnBringer 32. Switch to *Used* to see the
  sprite's own colors, most used first.

Press `?` in the app for every shortcut.

## Files

A document is saved as a **plain PNG**: its frames sit side by side in a
horizontal strip, so any image tool or game engine can read it. Layers,
playback speed and the palette are stored alongside the pixels in a private
`tEXt` chunk (`pixel-atelier`), so opening the file here again restores the
full document. Other programs simply ignore the chunk.

When you open any other image, the app asks how many frames sit side by side
in it. **Export** writes a scaled copy (one frame or the whole sheet) and never
touches the document's own file.

Open and save go through the kit's file layer: standalone this is your device,
on a desktop it is the host's file space. The app also autosaves your work in
its own storage and restores it on the next start.

## Shape

`app.json` (manifest), `app.js` (the app), `app.css`, `index.html` (the
standalone harness) and `kit/`, the vendored kit. `kit/VERSION` says which
version it is, and `kit/` is never edited here.
