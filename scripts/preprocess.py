"""
Preprocess the Mombasa 2026 multiband GeoTIFFs + metadata CSV into the
shape consumed by the Symphony Kenya review web app:

  public/data/layers.json                       ({ bounds, raster, layers })
  public/data/maps/{theme}/<slug>.webp          (lossless, one per data layer)
  public/data/values/{theme}/<slug>.bin.gz      (UInt8 quantized, gzipped)

Value bins are quantized 0..254 over the [0, 100] range with 255 as the
nodata sentinel. Always written at the TIFF's native resolution so the
hover/tap tooltip in the web app sees the un-resampled source value. The
raw UInt8 stream is gzipped (~30x smaller, since most cells are 0 or 255)
and decompressed in the browser via DecompressionStream.
"""
from __future__ import annotations

import argparse
import csv
import gc
import gzip
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

# Override PROJ_LIB/PROJ_DATA to rasterio's bundled proj_data BEFORE importing
# rasterio. On Windows, PostgreSQL/QGIS commonly leave a stale PROJ_LIB env var
# pointing to an older PROJ database (DATABASE.LAYOUT.VERSION.MINOR mismatch),
# which makes every CRS lookup fail.
_rasterio_spec = importlib.util.find_spec("rasterio")
if _rasterio_spec and _rasterio_spec.submodule_search_locations:
    for _loc in _rasterio_spec.submodule_search_locations:
        _candidate = os.path.join(_loc, "proj_data")
        if os.path.isdir(_candidate):
            os.environ["PROJ_LIB"] = _candidate
            os.environ["PROJ_DATA"] = _candidate
            break

import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from PIL import Image
import matplotlib

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT.parent / "Layers_260427_250m"
OUT_DATA_DIR = PROJECT_ROOT / "public" / "data"
MAPS_DIR = OUT_DATA_DIR / "maps"
VALUES_DIR = OUT_DATA_DIR / "values"
JSON_PATH = OUT_DATA_DIR / "layers.json"
CSV_PATH = DATA_DIR / "metadata_Layers_260427_250m.csv"

THEMES = {
    "ecosystem": {
        "tif": DATA_DIR / "ecosystem_Layers_260427_250m.tif",
        "cmap": "YlGn",
        "n_bands": 22,
    },
    "pressure": {
        "tif": DATA_DIR / "pressure_Layers_260427_250m.tif",
        "cmap": "YlOrRd",
        "n_bands": 8,
    },
}

VALUE_RANGE = (0.0, 100.0)
# UInt8 quantization: 0 → 0, 100 → 254, NaN/explicit-nodata → 255.
VALUES_NODATA = 255
VALUES_QUANT_MAX = 254
PLACEHOLDER_VALUES = {"", "n/a", "na", "later", "add later", "v"}
DATE_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")


def slugify(title: str) -> str:
    s = title.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def normalize_value(s: str | None) -> str | None:
    if s is None:
        return None
    s = s.strip()
    if s.lower() in PLACEHOLDER_VALUES:
        return None
    return s


def normalize_date(s: str | None) -> str | None:
    if s is None:
        return None
    m = DATE_RE.match(s)
    if not m:
        return s
    y, mo, d = m.groups()
    return f"{y}-{int(mo):02d}-{int(d):02d}"


def split_links(s: str | None) -> list[str]:
    if s is None:
        return []
    out: list[str] = []
    for token in re.split(r"\s+", s):
        token = token.strip().rstrip(".,;)")
        if token.startswith("http://") or token.startswith("https://"):
            out.append(token)
    return out


def build_layer_record(row: dict, band: int | None, map_relpath: str | None, values_relpath: str | None) -> dict:
    theme_key = (row.get("theme") or "").strip().lower()
    title = (row.get("title") or "").strip()
    return {
        "theme": theme_key,
        "band": band,
        "slug": slugify(title),
        "title": title,
        "subtheme": normalize_value(row.get("subtheme")),
        "description": normalize_value(row.get("description")),
        "providers": normalize_value(row.get("data_providers")),
        "latest_update": normalize_date(normalize_value(row.get("latest_update"))),
        "temporal_start": normalize_date(normalize_value(row.get("temporal_start"))),
        "temporal_end": normalize_date(normalize_value(row.get("temporal_end"))),
        "data_collected": normalize_date(normalize_value(row.get("data_collected"))),
        "method_summary": normalize_value(row.get("method_summary")),
        "known_limitations": normalize_value(row.get("known_limitations")),
        "source_citation": normalize_value(row.get("source_citation")),
        "lineage": normalize_value(row.get("lineage")),
        "links": split_links(row.get("links")),
        "contact": {
            "name": normalize_value(row.get("contact_name")),
            "email": normalize_value(row.get("contact_email")),
            "phone": normalize_value(row.get("contact_phone")),
            "org": normalize_value(row.get("contact_org")),
        },
        "data_available": band is not None,
        "map_file": map_relpath,
        "values_file": values_relpath,
    }


def parse_metadata(csv_path: Path) -> list[dict]:
    records: list[dict] = []
    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            theme_raw = (row.get("theme") or "").strip().lower()
            if theme_raw not in THEMES:
                continue
            title = (row.get("title") or "").strip()
            if not title:
                continue
            band_raw = (row.get("band") or "").strip()
            slug = slugify(title)
            if band_raw:
                band = int(band_raw)
                map_relpath = f"data/maps/{theme_raw}/{slug}.webp"
                values_relpath = f"data/values/{theme_raw}/{slug}.bin.gz"
            else:
                band = None
                map_relpath = None
                values_relpath = None
            records.append(build_layer_record(row, band, map_relpath, values_relpath))
    # Alphabetical by title within each theme (ecosystem first, then pressure).
    records.sort(
        key=lambda r: (
            0 if r["theme"] == "ecosystem" else 1,
            r["title"].lower(),
        )
    )
    return records


def render_band(
    tif_path: Path,
    band_idx: int,
    out_path: Path,
    cmap_name: str,
    value_range: tuple[float, float] = VALUE_RANGE,
    downsample: int = 2,
) -> None:
    with rasterio.open(tif_path) as src:
        nodata = src.nodata
        descriptions = src.descriptions
        arr = src.read(band_idx).astype(np.float32, copy=False)

    if band_idx == 1:
        print(
            f"    [info] {tif_path.name} band {band_idx}: "
            f"nodata={nodata}, dtype={arr.dtype}, "
            f"description={descriptions[band_idx - 1] if descriptions else '?'}, "
            f"range=({np.nanmin(arr):.4f}, {np.nanmax(arr):.4f})"
        )

    nodata_mask = (arr == nodata) if nodata is not None else np.zeros_like(arr, dtype=bool)
    zero_mask = arr <= 0.0
    mask = nodata_mask | np.isnan(arr) | zero_mask

    lo, hi = value_range
    norm = np.clip((arr - lo) / max(hi - lo, 1e-9), 0.0, 1.0)

    cmap = matplotlib.colormaps[cmap_name]
    rgba_float = cmap(norm)
    rgba = (rgba_float * 255.0).astype(np.uint8)
    rgba[mask, 3] = 0

    img = Image.fromarray(rgba, "RGBA")
    if downsample > 1:
        new_size = (img.width // downsample, img.height // downsample)
        img = img.resize(new_size, Image.LANCZOS)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Lossless WebP with method=6 (slow encode, smallest output). The maps are
    # transparent-background gradients over nodata — compresses very efficiently
    # losslessly. Keeps the underlay sharp at high zoom levels in the brief
    # window before the canvas tile layer takes over.
    img.save(out_path, "WEBP", lossless=True, method=6)

    del arr, norm, rgba_float, rgba, img
    gc.collect()


def render_band_values(
    tif_path: Path,
    band_idx: int,
    out_path: Path,
    value_range: tuple[float, float] = VALUE_RANGE,
) -> tuple[int, int]:
    """Write a gzipped UInt8-quantized binary of cell values at native TIFF resolution.

    Encoding: value in [lo, hi] → round((value-lo)/(hi-lo) * 254), clipped.
    NaN or explicit nodata → VALUES_NODATA (255). Zero is preserved as a real
    value (unlike the WebP, which renders zero as transparent).

    The raw stream is gzipped (compresslevel=9) because most cells are 0 or
    nodata — typical compression ratios are 10–100x, giving a payload around
    30–300 KB instead of the raw 3.6 MB. Decompressed client-side via
    DecompressionStream('gzip').

    Returns (width, height) so callers can record the grid dimensions.
    """
    with rasterio.open(tif_path) as src:
        nodata = src.nodata
        arr = src.read(band_idx).astype(np.float32, copy=False)

    nodata_mask = (arr == nodata) if nodata is not None else np.zeros_like(arr, dtype=bool)
    invalid = nodata_mask | np.isnan(arr)

    lo, hi = value_range
    span = max(hi - lo, 1e-9)
    clipped = np.clip(arr, lo, hi)
    quantized = np.rint((clipped - lo) / span * VALUES_QUANT_MAX).astype(np.uint8)
    quantized[invalid] = VALUES_NODATA

    h, w = quantized.shape
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_path, "wb", compresslevel=9) as fh:
        fh.write(quantized.tobytes())

    del arr, clipped, quantized
    gc.collect()
    return (int(w), int(h))


def write_json(payload: dict, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    n = len(payload.get("layers", []))
    b = payload.get("bounds")
    print(f"  wrote {out_path} ({n} layers, bounds={b})")


def reference_tif() -> Path:
    for cfg in THEMES.values():
        if cfg["tif"].exists():
            return cfg["tif"]
    raise FileNotFoundError("No source TIFF found")


def compute_bounds_and_dims() -> tuple[list[list[float]], int, int]:
    """Return ([[south, west], [north, east]] in EPSG:4326, width, height) from the reference TIFF.

    The bounds are what Leaflet's imageOverlay expects; width/height are the
    native pixel dimensions used to size the value-bin grid.
    """
    ref = reference_tif()
    with rasterio.open(ref) as src:
        if src.crs is None:
            raise RuntimeError(f"{ref.name} has no CRS — cannot compute bounds")
        # transform_bounds returns (west, south, east, north)
        west, south, east, north = transform_bounds(
            src.crs, "EPSG:4326", *src.bounds, densify_pts=21
        )
        width, height = src.width, src.height
    return [[south, west], [north, east]], int(width), int(height)


def render_theme(
    theme_key: str,
    records: list[dict],
    downsample: int,
    only_band: int | None,
    do_maps: bool,
    do_values: bool,
) -> None:
    cfg = THEMES[theme_key]
    tif = cfg["tif"]
    cmap_name = cfg["cmap"]
    flags = ", ".join(filter(None, ["maps" if do_maps else None, "values" if do_values else None]))
    print(f"  rendering theme={theme_key} from {tif.name} (cmap={cmap_name}, downsample={downsample}, {flags})")
    theme_records = [r for r in records if r["theme"] == theme_key and r["band"] is not None]
    for rec in theme_records:
        if only_band is not None and rec["band"] != only_band:
            continue
        if do_maps:
            out_path = MAPS_DIR / theme_key / f"{rec['slug']}.webp"
            render_band(tif, rec["band"], out_path, cmap_name, downsample=downsample)
            size_kb = out_path.stat().st_size / 1024
            print(f"    band {rec['band']:>2} webp -> {out_path.relative_to(PROJECT_ROOT)} ({size_kb:.0f} KB)")
        if do_values:
            bin_path = VALUES_DIR / theme_key / f"{rec['slug']}.bin.gz"
            w, h = render_band_values(tif, rec["band"], bin_path)
            size_kb = bin_path.stat().st_size / 1024
            print(f"    band {rec['band']:>2} bin -> {bin_path.relative_to(PROJECT_ROOT)} ({w}x{h}, {size_kb:.0f} KB)")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--theme", choices=list(THEMES.keys()), help="Restrict to one theme")
    p.add_argument("--band", type=int, help="Restrict to one band index (1-based)")
    p.add_argument("--json-only", action="store_true", help="Only rebuild layers.json")
    p.add_argument("--maps-only", action="store_true", help="Only rebuild WebPs and value bins (no JSON)")
    p.add_argument("--values-only", action="store_true", help="Only rebuild value bins (no JSON, no WebPs)")
    p.add_argument("--skip-values", action="store_true", help="Skip value bin generation")
    p.add_argument("--low-res", action="store_true", help="Render WebPs at 2x downsampled (1270x723); default is native 2541x1447. Value bins are always native.")
    p.add_argument("--full-res", action="store_true", help="Deprecated alias; native is now the default")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    do_json = not args.maps_only and not args.values_only
    do_maps = not args.json_only and not args.values_only
    do_values = not args.json_only and not args.skip_values

    if not CSV_PATH.exists():
        print(f"ERROR: CSV not found: {CSV_PATH}", file=sys.stderr)
        return 1

    print(f"Reading metadata: {CSV_PATH}")
    records = parse_metadata(CSV_PATH)
    n_eco = sum(1 for r in records if r['theme']=='ecosystem')
    n_pres = sum(1 for r in records if r['theme']=='pressure')
    n_data = sum(1 for r in records if r['data_available'])
    n_placeholder = len(records) - n_data
    print(f"  parsed {len(records)} rows ({n_eco} ecosystem + {n_pres} pressure; {n_data} with data, {n_placeholder} placeholders)")

    if do_json:
        print("Computing lat/lon bounds and dimensions from reference TIFF...")
        try:
            bounds, width, height = compute_bounds_and_dims()
        except Exception as e:
            print(f"  ERROR computing bounds: {e}", file=sys.stderr)
            return 1
        payload = {
            "bounds": bounds,
            "raster": {
                "width": width,
                "height": height,
                "value_min": VALUE_RANGE[0],
                "value_max": VALUE_RANGE[1],
                "encoding": "uint8",
                "nodata": VALUES_NODATA,
                "quant_max": VALUES_QUANT_MAX,
            },
            "layers": records,
        }
        write_json(payload, JSON_PATH)

    downsample = 2 if args.low_res else 1

    if do_maps or do_values:
        themes_to_run = [args.theme] if args.theme else list(THEMES.keys())
        for theme_key in themes_to_run:
            if not THEMES[theme_key]["tif"].exists():
                print(f"  [skip] {theme_key}: TIFF not found at {THEMES[theme_key]['tif']}")
                continue
            render_theme(
                theme_key, records, downsample, args.band,
                do_maps=do_maps, do_values=do_values,
            )

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
