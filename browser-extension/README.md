# MAVIS Clipper — Chrome Extension

A minimal Chrome MV3 web clipper that sends the current page (URL + optional selected text and note) to your MAVIS Vault via the `mavis-ingest-url` Supabase edge function.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `browser-extension/` folder.
4. The MAVIS Clipper icon will appear in your toolbar.

## Configure

1. Click the extension icon → **Settings** (or right-click → Options).
2. Enter your **Supabase URL** (e.g. `https://xxxx.supabase.co`).
3. Enter your **Access Token** — find it in MAVIS → Settings → Account, or from the Supabase Auth dashboard under your project's API settings.
4. Click **Save Settings**.

## Usage

1. Browse to any web page.
2. Optionally select some text you want to include.
3. Click the MAVIS Clipper toolbar icon.
4. Optionally add a note in the text area.
5. Click **CLIP TO VAULT** — a green "✓ Saved to Vault" confirms success.

## Icons

The extension references `icon48.png` and `icon128.png`. Generate them from `icon.svg` using any SVG-to-PNG converter before loading the extension — for example:

```bash
# Using Inkscape
inkscape icon.svg --export-filename=icon48.png  --export-width=48
inkscape icon.svg --export-filename=icon128.png --export-width=128

# Using rsvg-convert (librsvg)
rsvg-convert -w 48  -h 48  icon.svg -o icon48.png
rsvg-convert -w 128 -h 128 icon.svg -o icon128.png

# Using ImageMagick (requires librsvg delegate)
convert -background none -resize 48x48   icon.svg icon48.png
convert -background none -resize 128x128 icon.svg icon128.png
```

Chrome will load the extension without icons if the PNG files are missing — the toolbar will show a default puzzle-piece placeholder until the PNGs are added.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome MV3 extension manifest |
| `background.js` | Service worker — handles CLIP messages, POSTs to Supabase |
| `content.js` | Content script — captures selected text from the page |
| `popup.html` / `popup.js` | Extension popup UI |
| `settings.html` / `settings.js` | Options page for Supabase URL + token |
| `icon.svg` | Source icon (generate PNG variants from this) |
| `icon48.png` | 48×48 toolbar icon (generate from icon.svg) |
| `icon128.png` | 128×128 store icon (generate from icon.svg) |
