# Symphony Kenya - Marine Layer Review

Static review web app for the marine layers tracked by the Mombasa 2026 modelling team. The current build ships the full planned checklist of 89 layers — some carry raster data already, the rest are placeholders awaiting data.

**Live:** https://slu-marten.github.io/symphony-kenya-review/

## What reviewers see

- A Leaflet map with the active layer rendered as a coloured raster on top of a switchable basemap (Light / Minimal / Satellite / Ocean).
- A sidebar listing all layers grouped under **Ecosystem components** and **Pressures**, with a search box and per-layer flag dots showing which layers the reviewer has already submitted feedback on. Layers without raster data yet are marked with a yellow **Data needed** badge.
- A right-hand panel with compact metadata (subtheme, providers, dates, contact) plus a "Show full metadata" modal and a per-layer review form.
- A **cell-value tooltip**: hover (desktop) or tap (mobile) over the map to see the raw raster value (0–100) at that cell. Real nodata cells show no tooltip; "transparent zero" cells correctly report `0.0`.
- For **Data needed** layers the map shows only the basemap plus a "no data yet" card; reviewers can still leave a note in the review form suggesting suitable data sources.
- Mobile layout: sidebar collapses into a hamburger drawer, right panel becomes a bottom sheet you can expand.

## Quick start

### 1. Preprocess the source data

```bash
pip install -r scripts/requirements.txt
python scripts/preprocess.py
```

Reads the multiband GeoTIFFs and metadata CSV in `../Layers_260427_250m/` and writes:
- `public/data/layers.json` — one record per CSV row, each with a `data_available` flag, plus the raster grid metadata and bounds
- `public/data/maps/{ecosystem,pressure}/*.webp` — lossless WebP per data layer (YlGn ramp for ecosystem, YlOrRd for pressure)
- `public/data/values/{ecosystem,pressure}/*.bin.gz` — gzipped UInt8 quantized value grid per data layer, used by the hover tooltip and canvas-tile renderer

Placeholder rows (CSV rows with an empty `band` column) appear in `layers.json` with `data_available: false`, `map_file: null`, `values_file: null` — no WebP/bin.gz is generated for them.

The decompressed value bins encode each cell as `round(value / 100 * 254)` with `255` reserved for nodata, at native TIFF resolution (2541×1447 = ~3.6 MB raw). Gzipping typically yields a 10–100× smaller payload (most cells are 0 or nodata), so the average over-the-wire size is around 130 KB — important on slow mobile connections. The browser stream-decompresses via `DecompressionStream('gzip')`.

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
python scripts/preprocess.py                            # full run: JSON + WebPs + value bins
python scripts/preprocess.py --json-only                # rebuild layers.json only
python scripts/preprocess.py --maps-only                # rebuild WebPs + value bins (no JSON)
python scripts/preprocess.py --values-only              # rebuild value bins only
python scripts/preprocess.py --skip-values              # render WebPs but skip value bins
python scripts/preprocess.py --theme ecosystem          # restrict to one theme
python scripts/preprocess.py --theme pressure --band 1  # single band
python scripts/preprocess.py --low-res                  # WebPs at 2x downsampled; bins always native
```

## Adding or updating a layer

The 89 entries from the planning checklist are already in `../Layers_260427_250m/metadata_Layers_260427_250m.csv` as either populated rows (`band` filled in → has a TIFF band, PNG, and value bin) or placeholders (`band` empty → renders as **Data needed** in the UI).

The most common operation is **filling in a placeholder** as new raster data arrives.

### Filling in a placeholder (raster data has arrived)

1. **Drop the new TIFF(s)** into `../Layers_260427_250m/New layers/`. They can be at any resolution and slightly different bounds — `merge_new_layers.py` resamples them onto the destination grid (2541×1447, EPSG:3857) via bilinear interpolation.
2. **Edit `scripts/merge_new_layers.py`** — point the `MERGES` list at your new file(s) and the destination stack(s) (`ecosystem_Layers_260427_250m.tif` and/or `pressure_Layers_260427_250m.tif`).
3. **Run** `python scripts/merge_new_layers.py` — the new band(s) get appended to the matching stack with their `descriptions` preserved.
4. **Bump `n_bands`** in `scripts/preprocess.py` to match the new band count on the affected stack(s).
5. **Edit the CSV row** — find the placeholder whose `title` matches the new layer and set its `band` to the newly-added band index. Fill in `data_providers`, `latest_update`, `temporal_*`, `data_collected`, `method_summary`, `known_limitations`, `source_citation`, `lineage`, `links`, and the contact fields. Leave fields you don't have empty (the UI shows them as "—").
6. **Run** `python scripts/preprocess.py` — regenerates `layers.json`, the WebP, and the gzipped value bin. (Re-renders all bands; that's harmless and gives you a clean output.)
7. **Verify locally** with `npm run dev` — open the layer in the sidebar and confirm the badge is gone, the raster renders, and the hover tooltip reports plausible values.
8. **Commit and deploy**:
   ```powershell
   git add public/data/layers.json scripts/
   git commit -m "Add data for <layer name>"
   git push
   npm run deploy
   ```

### Adding a brand-new placeholder

Append a row to the CSV with `theme`, `subtheme`, `title`, and `description` filled in and `band` empty. Run `python scripts/preprocess.py --json-only`, commit, push, deploy.

### Editing only metadata for an existing layer

Edit the CSV row. Run `python scripts/preprocess.py --json-only` (no need to re-render PNGs). Commit, push, deploy.

### Removing a layer

There is no helper script for this yet — do it manually with a short rasterio snippet to drop the band, then remove the matching CSV row, decrement `n_bands`, delete the matching `.webp` and `.bin.gz`, rerun `python scripts/preprocess.py`. The `.bak.tif` snapshots in `../Layers_260427_250m/` are a safety net if you need to roll back.

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
  scripts/merge_new_layers.py       — appends new TIFF bands onto a stack (reused per data drop)
  public/data/layers.json              — one record per CSV row + raster meta + bounds
  public/data/maps/{theme}/*.webp      — per-band lossless WebP, one per data layer (gitignored on main)
  public/data/values/{theme}/*.bin.gz  — per-band gzipped UInt8 value grids, one per data layer (gitignored on main)
  src/                              — Vite + Vanilla JS SPA (Leaflet)
```

`maps/` and `values/` are gitignored on `main` and only land on `gh-pages` via `npm run deploy`. The TIFFs and CSV live outside the repo at `../Layers_260427_250m/`. Reviewer feedback persists in browser localStorage and (optionally) a shared Google Sheet.

## Notes on rasterio install (Windows)

`pip install rasterio` typically works on Python 3.11+ via prebuilt wheels (GDAL bundled). If wheels fail on a newer Python, pin a known-good version: `pip install rasterio==1.3.10`. As a last resort, install GDAL via conda first.

If you hit a `DATABASE.LAYOUT.VERSION.MINOR` PROJ error on a machine with QGIS / PostgreSQL installed, that's a stale `PROJ_LIB` env var — `preprocess.py` overrides it at the top of the script, so just run via that script rather than calling rasterio directly.
