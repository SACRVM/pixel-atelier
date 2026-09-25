# Pixel Atelier

A pixel and sprite editor with frames, onion skin and palettes. It runs
in the browser with no install and no build step. Built on
[SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit); runs standalone or
as an app on a SACRVM desktop.

```bash
npx serve .
```

`serve.json` tells the dev server not to cache, so a reload always picks up
the current files.

## What it does

The editor of the Atelier, the sprite studio of BunnyBot's web app, as a
standalone app. The canvas fills the screen. **Tools**, **Selection**,
**Palette** and **Preview** are floating windows over it: drag them where you want them,
close them, and bring them back from the top bar.

- **Tools:** pencil, eraser, line, rectangle and ellipse (outline or filled),
  fill, eyedropper, brush 1–4 px. Alt+click picks a color with any tool,
  Shift+click draws a line from the last point.
- **Selection:** a marquee whose contents float once touched. Drag or nudge it
  with the arrows, flip it (Shift+H / Shift+V), trim it to the object, and
  copy / cut / paste in place. Pasting also takes images from other apps.
- **Frames:** add, duplicate and delete in the bar at the bottom. Jump with
  ←/→ or 1–0. Onion skin wraps the loop, and the preview plays the animation
  while you paint.
- **Palette:** DawnBringer 32 to start with, or load your own: a GIMP palette
  (`.gpl`), a list of hex colors (`.hex` / `.txt`, as Lospec exports them) or
  an image, whose colors are taken in reading order. *Used* shows the sprite's
  own colors, most used first.
- **Speed:** set the animation's frames per second in the preview window.
  It is saved with the sprite.

The UI speaks English and German and follows the page's language, which is
switched once for all SACRVM APPKIT apps (on a desktop, by the desktop).

## Files

A sprite is saved as a **plain PNG**: its frames sit side by side in a
horizontal strip, so any image tool or game engine can read it. Playback
speed and the palette are stored alongside the pixels in a private `tEXt`
chunk (`pixel-atelier`). Other programs simply ignore the chunk.

When you open any other image, the app asks how many frames sit side by side
in it.

Open and save go through the kit's file layer. On a SACRVM desktop they use
whatever file space the desktop provides. The standalone page does the same
as the appkit's own hub: a shared file space in the browser, with "this
device" one click away in the same dialog. The app also autosaves your work in
its own storage and restores it on the next start.

## Shape

`app.json` (manifest), `app.js` (the app), `app.css`, `index.html` (the
standalone harness) and `kit/`, the vendored kit. `kit/VERSION` says which
version it is, and `kit/` is never edited here.
