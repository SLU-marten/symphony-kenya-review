# Symphony Kenya - Marine Layer Review

Static review web app for the 20 marine layers (12 ecosystem components + 8 pressures) produced by the Mombasa 2026 modelling team.

**Live:** https://slu-marten.github.io/symphony-kenya-review/

## What reviewers see

- A Leaflet map with the active layer rendered as a coloured raster on top of a switchable basemap (Light / Minimal / Satellite / Ocean).
- A sidebar listing all 20 layers grouped under **Ecosystem components** and **Pressures**, with a search box and per-layer flag dots showing which layers the reviewer has already submitted feedback on.
- A right-hand panel with compact metadata (subtheme, providers, dates, contact) plus a "Show full metadata" modal and a per-layer review form.
- A **cell-value tooltip**: hover (desktop) or tap (mobile) over the map to see the raw raster value (0–100) at that cell. Real nodata cells show no tooltip; "transparent zero" cells correctly report `0.0`.
- Mobile layout: sidebar collapses into a hamburger drawer, right panel becomes a bottom sheet you can expand.

## Quick start

### 1. Preprocess the source data

```bash
pip install -r scripts/requirements.txt
python scripts/preprocess.py
```

Reads the multiband GeoTIFFs and metadata CSV in `../Layers_260427_250m/` and writes:
- `public/data/layers.json` — 20 layer metadata records, raster grid metadata, and bounds
- `public/data/maps/ecosystem/*.png` — 12 coloured band PNGs (YlGn ramp)
- `public/data/maps/pressure/*.png` — 8 coloured band PNGs (YlOrRd ramp)
- `public/data/values/ecosystem/*.bin` — 12 UInt8 quantized value grids (for the tooltip)
- `public/data/values/pressure/*.bin` — 8 UInt8 quantized value grids

The `.bin` files encode each cell's value as `round(value / 100 * 254)` with `255` reserved for nodata. They're written at native TIFF resolution (2541×1447 ≈ 3.6 MB per layer, ~71 MB total).

### 2. Run the dev server

```bash
npm install
npm run dev
```

Open http://localhost:5173/symphony-kenya-review/ in a browser.

### 3. Build for deployment

```bash
npm run build       # outputs to dist/
npm run preview     # serves the built site locally
npm run deploy      # pushes dist/ to gh-pages branch
```

`npm run deploy` runs `vite build` first (which copies everything in `public/` into `dist/`) then publishes `dist/` to the `gh-pages` branch. GitHub Pages auto-rebuilds in ~30–60 s.

## Preprocess CLI

```bash
python scripts/preprocess.py                            # full run: JSON + PNGs + value bins
python scripts/preprocess.py --json-only                # rebuild layers.json only
python scripts/preprocess.py --maps-only                # rebuild PNGs + value bins (no JSON)
python scripts/preprocess.py --values-only              # rebuild value bins only
python scripts/preprocess.py --skip-values              # render PNGs but skip value bins
python scripts/preprocess.py --theme ecosystem          # restrict to one theme
python scripts/preprocess.py --theme pressure --band 1  # single band
python scripts/preprocess.py --low-res                  # PNGs at 2x downsampled (~3 MB total); bins always native
python scripts/preprocess.py --compress                 # invoke pngquant on PNGs
```

## Reviewer flow

1. On first visit, a setup modal collects Name, Email, Area of expertise, and contact consent (saved to localStorage; reopen via "Edit reviewer info" link).
2. Pick the **Ecosystem** or **Pressures** tab in the sidebar; click a layer.
3. Inspect the coloured map (drag to pan, scroll/+/-/Reset to zoom) and the metadata panel. Hover or tap any cell to see its underlying value.
4. Submit a per-layer review:
   - **Flag**: Green (keep) / Yellow (keep with caution) / Red (remove)
   - **Comment** (free text)
   - **Review focus**: Data accuracy, Data completeness, Visualization, Method, Other
   - **Better data?** Yes/No (+ optional source link)

The flag dot in the sidebar updates immediately so you can see which layers you've already reviewed.

## Collecting reviews

Each `Submit review` saves to the reviewer's browser localStorage **and**, if Google Sheets sync is configured, fire-and-forgets a row to your Sheet. See `GOOGLE_SHEETS_SETUP.md` for the one-time Apps Script deploy.

Without Sheets sync, reviews stay only in the reviewer's browser.

## Data layout

```
symphony_kenya_review/
  scripts/preprocess.py             — CSV/TIFF preprocessor
  public/data/layers.json           — 20 layer records + raster meta + bounds
  public/data/maps/{theme}/*.png    — per-band PNG renders (gitignored on main)
  public/data/values/{theme}/*.bin  — per-band UInt8 value grids (gitignored on main)
  src/                              — Vite + Vanilla JS SPA (Leaflet)
```

`maps/` and `values/` are gitignored on `main` and only land on `gh-pages` via `npm run deploy`. The TIFFs and CSV live outside the repo at `../Layers_260427_250m/`. Reviewer feedback persists in browser localStorage and (optionally) a shared Google Sheet.

## Notes on rasterio install (Windows)

`pip install rasterio` typically works on Python 3.11+ via prebuilt wheels (GDAL bundled). If wheels fail on a newer Python, pin a known-good version: `pip install rasterio==1.3.10`. As a last resort, install GDAL via conda first.

If you hit a `DATABASE.LAYOUT.VERSION.MINOR` PROJ error on a machine with QGIS / PostgreSQL installed, that's a stale `PROJ_LIB` env var — `preprocess.py` overrides it at the top of the script, so just run via that script rather than calling rasterio directly.
