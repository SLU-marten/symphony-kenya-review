# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static Vite + Vanilla JS SPA for reviewing 20 marine layers (12 ecosystem components + 8 pressures) from the WIO Symphony / Mombasa 2026 project. Live at <https://slu-marten.github.io/symphony-kenya-review/>.

## Commands

```bash
# Preprocessing (regenerates public/data/layers.json + maps/ + values/)
pip install -r scripts/requirements.txt           # one-time
python scripts/preprocess.py                      # full run: JSON + 20 PNGs + 20 value bins
python scripts/preprocess.py --json-only          # only rebuild layers.json (also recomputes bounds + raster meta)
python scripts/preprocess.py --maps-only          # skip JSON; render PNGs + value bins
python scripts/preprocess.py --values-only        # skip JSON + PNGs; only refresh value bins
python scripts/preprocess.py --skip-values        # render PNGs but not value bins
python scripts/preprocess.py --theme ecosystem --band 1   # single band
python scripts/preprocess.py --low-res            # PNGs at 2x downsampled (~3 MB); bins always native
python scripts/preprocess.py --compress           # pngquant if available

# Dev / build / deploy
npm install                                       # one-time
npm run dev                                       # http://localhost:5173/symphony-kenya-review/
npm run build                                     # production build to dist/
npm run deploy                                    # vite build && gh-pages -d dist
```

After editing source: `git add . && git commit -m "..." && git push` updates `main`. To publish: `npm run deploy`. Pages auto-rebuilds (~30-60 s) on every `gh-pages` push.

There are no tests, no linter, no formatter configured.

## Architecture

### Data flow

```
../Layers_260427_250m/   scripts/preprocess.py            public/data/             dist/data/
ecosystem_*.tif  (12) →  render_band per band         →   maps/ecosystem/*.png   ─┐
ecosystem_*.tif  (12) →  render_band_values per band  →   values/ecosystem/*.bin ─┤
pressure_*.tif    (8) →  render_band per band         →   maps/pressure/*.png    ─┤  vite build
pressure_*.tif    (8) →  render_band_values per band  →   values/pressure/*.bin  ─┤  copies public/
metadata_*.csv        →  parse_metadata               →   layers.json             ─┤  → gh-pages branch
(reference TIFF       →  compute_bounds_and_dims      →   layers.json.bounds     ─┘
  bounds + dims)         via transform_bounds              + layers.json.raster
```

The source TIFFs and CSV live **outside this repo** at `../Layers_260427_250m/` (sibling folder, not in git, ~560 MB). On a fresh clone the contents of `public/data/maps/` and `public/data/values/` don't exist — both gitignored on `main`. Vite copies them into `dist/` during build, so the `gh-pages` branch always has them. To work locally you must first run `python scripts/preprocess.py`.

`layers.json` is wrapped: `{ bounds: [[south, west], [north, east]], raster: { width, height, value_min, value_max, encoding, nodata, quant_max }, layers: [...] }`. `bounds` is in EPSG:4326 (lat/lon) — the format Leaflet's `imageOverlay` expects. `raster` describes the value-bin grid (native TIFF dims) and the UInt8 quantization.

### Two-branch deploy

- **`main`** = source. Never has the rendered PNGs.
- **`gh-pages`** = the built `dist/` only. Recreated wholesale by `npm run deploy`. Never edit by hand.

### Frontend wiring

`src/main.js` is the bootstrap. The right panel is two cards: a compact metadata view (`infoPanel.js`) with a "Show full metadata" button that opens a wide modal, and a review form (`reviewForm.js`). The map viewer (`mapViewer.js`) uses **Leaflet** — `#map-container` is the Leaflet root, with a CARTO Positron raster tile layer as the basemap and an `L.imageOverlay(layerUrl, bounds)` for the active layer. The custom zoom buttons call `map.zoomIn/Out/fitBounds(dataBounds)` directly; Leaflet's own zoom control is disabled. Layer PNGs have transparent zeros so the tile basemap shows through where the data is zero.

`mapViewer.js` calls `map.invalidateSize()` at the top of every `showMap()` because `#layer-view` starts hidden — Leaflet otherwise computes a zero-sized container at init.

`mapViewer.js` also lazy-loads the active layer's value bin (`Uint8Array`, native TIFF resolution) on every `showMap()`, caching loaded bins in-memory keyed by `theme:slug`. `mousemove` (desktop hover) and `click` (mobile tap) lookup the cell value via `latLngToLayerPoint` so the EPSG:3857 projection of the cursor lat/lng lands on the correct overlay pixel; the resulting raw byte is dequantized through `raster.value_min/value_max/quant_max/nodata` and shown in a small floating tooltip near the pointer.

Persistence is browser-local: `reviewService.js` writes to `localStorage` keys `symphonyKenya_reviews` (per-layer) and `symphonyKenya_reviewerInfo` (one-time setup modal). Each `saveReview` also fires a `no-cors` POST to `SHEETS_URL` when set — the Apps Script appends a row.

## Gotchas

### `PROJ_LIB` on Windows
The very top of `scripts/preprocess.py` overrides `PROJ_LIB`/`PROJ_DATA` to rasterio's bundled `proj_data` BEFORE importing rasterio. Many Windows boxes (with PostgreSQL/QGIS installed) export a stale `PROJ_LIB` pointing to an older PROJ database — every CRS lookup then fails with a `DATABASE.LAYOUT.VERSION.MINOR` mismatch. Keep the override at the top.

### Source raster CRS
The TIFFs are in **EPSG:3857 (Web Mercator)** — not lat/lon, not UTM. `compute_bounds_latlon()` reads `src.crs` and `src.bounds` from a reference TIFF and reprojects to EPSG:4326 via `rasterio.warp.transform_bounds`. The TIFFs being in EPSG:3857 also happens to be Leaflet's native CRS — so the `imageOverlay` raster aligns pixel-perfect with the tile basemap with no warp at runtime. TIFFs in a different CRS would still work for `compute_bounds_latlon()` but the overlay would be slightly distorted (Leaflet stretches between the four lat/lon corners as if the image were also in EPSG:3857).

### Flag values vs. labels
Display labels in the form are `OK / Minor revision / Major revision`, but stored values everywhere (localStorage, the Sheet, sidebar dot CSS classes `flag-green/flag-yellow/flag-red`) are still `green / yellow / red`. **Don't rename the stored values** — every existing review would lose its flag.

### Transparent zeros are a render-time choice
`render_band()` masks `arr <= 0.0` to alpha=0 so the tile basemap shows through. In the source TIFFs, `0` is a real value (no presence / no pressure), not nodata. A transparent pixel in the displayed PNG ≠ no data in the source. Consequently `render_band_values()` does **not** mask zero — only NaN and explicit nodata become the sentinel `255`. Hovering over a "transparent" pixel will correctly report `0.0`; only true nodata cells show no tooltip.

### Value bins are always native resolution
`render_band_values()` ignores `--low-res` and writes at full TIFF resolution (~3.7 MB UInt8 per layer). Lookups should hit the un-resampled source value; downsampling for the PNG is purely a visual choice. If you change PNG dims, you don't need to regenerate the bins.

### Tile basemap attribution is required
The CARTO Positron tiles used in `mapViewer.js` are free but require the OSM + CARTO attribution string baked into `L.tileLayer(...)`. Don't strip it. If you swap to another tile provider (Stadia, Maptiler, Esri), update the attribution accordingly.

### `SHEETS_URL` is hardcoded and visible in the deployed bundle
`src/services/reviewService.js` has the Apps Script web-app URL inline. Vite bakes it into `dist/assets/index-*.js`, so anyone with DevTools can read it. If the Sheet starts getting spammed, redeploy the Apps Script as a *new deployment* (gives a new URL — the old one stops working), then update the constant. The `import.meta.env.VITE_SHEETS_URL` fallback path in the source is currently commented out.

### Native-resolution PNGs are the default
`preprocess.py` renders at 2541×1447 by default (~6 MB total for 20 PNGs). `--low-res` gives the older 2x-downsampled output. `--full-res` is a deprecated no-op alias.

## Reference docs

- `GOOGLE_SHEETS_SETUP.md` — Apps Script code, deploy steps, sheet column schema, troubleshooting.
- `README.md` — reviewer-facing intro and quick-start.
