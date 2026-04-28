# Symphony Kenya - Marine Layer Review

Static review web app for the 20 marine layers (12 ecosystem components + 8 pressures) produced by the Mombasa 2026 modelling team.

## Quick start

### 1. Preprocess the source data

```bash
pip install -r scripts/requirements.txt
python scripts/preprocess.py
```

This reads the multiband GeoTIFFs and metadata CSV in `../Layers_260427_250m/` and writes:
- `public/data/layers.json` - 20 layer metadata records
- `public/data/maps/ecosystem/*.png` - 12 colored band PNGs (YlGn ramp)
- `public/data/maps/pressure/*.png` - 8 colored band PNGs (YlOrRd ramp)

### 2. Run the dev server

```bash
npm install
npm run dev
```

Open `http://localhost:5173/symphony-kenya-review/` in a browser.

### 3. Build for deployment

```bash
npm run build       # outputs to dist/
npm run preview     # serves the built site locally
npm run deploy      # pushes dist/ to gh-pages branch
```

## Preprocess CLI

```bash
python scripts/preprocess.py                          # full run
python scripts/preprocess.py --json-only              # rebuild metadata JSON only
python scripts/preprocess.py --maps-only              # rebuild PNGs only
python scripts/preprocess.py --theme ecosystem        # one theme
python scripts/preprocess.py --theme pressure --band 1 # single band
python scripts/preprocess.py --full-res               # 2541x1447 instead of 1270x723
python scripts/preprocess.py --compress               # invoke pngquant on outputs
```

## Reviewer flow

1. On first visit, a setup modal collects Name, Email, Area of expertise, and contact consent (saved to localStorage; reopen via "Edit reviewer info" link).
2. Pick the **Ecosystem** or **Pressures** tab in the sidebar; click a layer.
3. Inspect the colored map (Panzoom: drag, mouse wheel, +/-/Reset) and the metadata panel.
4. Submit a per-layer review:
   - **Flag**: Green (keep) / Yellow (keep with caution) / Red (remove)
   - **Comment** (free text)
   - **Review focus**: Data accuracy, Data completeness, Visualization, Other
   - **Better data?** Yes/No (+ optional source link)

## Collecting reviews

Each `Submit review` saves to the reviewer's browser localStorage **and**, if Google Sheets sync is configured, fire-and-forgets a row to your Sheet. See `GOOGLE_SHEETS_SETUP.md` for the one-time Apps Script deploy.

Without Sheets sync, reviews stay only in the reviewer's browser.

## Data layout

```
symphony_kenya_review/
  scripts/preprocess.py             - CSV/TIFF preprocessor
  public/data/layers.json           - 20 layer records (output)
  public/data/maps/{theme}/*.png    - per-band PNG renders (output)
  src/                              - Vite + Vanilla JS SPA
```

Persistence is browser localStorage only. Each reviewer downloads their own JSON.

## Notes on rasterio install (Windows)

`pip install rasterio` typically works on Python 3.11+ via prebuilt wheels (GDAL bundled). If wheels fail on a newer Python, pin a known-good version: `pip install rasterio==1.3.10`. As a last resort, install GDAL via conda first.
