"""
Preprocess the Mombasa 2026 multiband GeoTIFFs + metadata CSV into the
shape consumed by the Symphony Kenya review web app:

  public/data/layers.json
  public/data/maps/ecosystem/<slug>.png   (12 PNGs, YlGn ramp)
  public/data/maps/pressure/<slug>.png    ( 8 PNGs, YlOrRd ramp)
"""
from __future__ import annotations

import argparse
import csv
import gc
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
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
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import transform_geom
from PIL import Image
import matplotlib

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT.parent / "Layers_260427_250m"
OUT_DATA_DIR = PROJECT_ROOT / "public" / "data"
MAPS_DIR = OUT_DATA_DIR / "maps"
JSON_PATH = OUT_DATA_DIR / "layers.json"
BASEMAP_PATH = OUT_DATA_DIR / "basemap.png"
CSV_PATH = DATA_DIR / "metadata_Layers_260427_250m.csv"

NE_LAND_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson"
NE_LAND_CACHE = SCRIPT_DIR / "_cache" / "ne_10m_land.geojson"

LAND_RGBA = (220, 224, 228, 255)
COAST_RGBA = (110, 120, 128, 255)

THEMES = {
    "ecosystem": {
        "tif": DATA_DIR / "ecosystem_Layers_260427_250m.tif",
        "cmap": "YlGn",
        "n_bands": 12,
    },
    "pressure": {
        "tif": DATA_DIR / "pressure_Layers_260427_250m.tif",
        "cmap": "YlOrRd",
        "n_bands": 8,
    },
}

VALUE_RANGE = (0.0, 100.0)
PLACEHOLDER_VALUES = {"", "n/a", "na", "later", "add later", "v"}


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


def split_links(s: str | None) -> list[str]:
    if s is None:
        return []
    out: list[str] = []
    for token in re.split(r"\s+", s):
        token = token.strip().rstrip(".,;)")
        if token.startswith("http://") or token.startswith("https://"):
            out.append(token)
    return out


def build_layer_record(row: dict, map_relpath: str) -> dict:
    theme_key = (row.get("theme") or "").strip().lower()
    title = (row.get("title") or "").strip()
    return {
        "theme": theme_key,
        "band": int(row["band"]),
        "slug": slugify(title),
        "title": title,
        "subtheme": normalize_value(row.get("subtheme")),
        "description": normalize_value(row.get("description")),
        "providers": normalize_value(row.get("data_providers")),
        "latest_update": normalize_value(row.get("latest_update")),
        "temporal_start": normalize_value(row.get("temporal_start")),
        "temporal_end": normalize_value(row.get("temporal_end")),
        "data_collected": normalize_value(row.get("data_collected")),
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
        "map_file": map_relpath,
    }


def parse_metadata(csv_path: Path) -> list[dict]:
    records: list[dict] = []
    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            band_raw = (row.get("band") or "").strip()
            theme_raw = (row.get("theme") or "").strip().lower()
            if not band_raw or theme_raw not in THEMES:
                continue
            title = (row.get("title") or "").strip()
            slug = slugify(title)
            map_relpath = f"data/maps/{theme_raw}/{slug}.png"
            records.append(build_layer_record(row, map_relpath))
    records.sort(
        key=lambda r: (0 if r["theme"] == "ecosystem" else 1, r["band"])
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
    img.save(out_path, "PNG", optimize=True)

    del arr, norm, rgba_float, rgba, img
    gc.collect()


def maybe_pngquant(out_path: Path) -> None:
    if not shutil.which("pngquant"):
        print(f"    [warn] pngquant not found on PATH; skipping compression for {out_path.name}")
        return
    subprocess.run(
        [
            "pngquant",
            "--quality=70-90",
            "--speed",
            "1",
            "--force",
            "--output",
            str(out_path),
            str(out_path),
        ],
        check=False,
    )


def write_json(records: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=2, ensure_ascii=False)
    print(f"  wrote {out_path} ({len(records)} layers)")


def fetch_ne_land() -> Path:
    NE_LAND_CACHE.parent.mkdir(parents=True, exist_ok=True)
    if not NE_LAND_CACHE.exists():
        print(f"  downloading Natural Earth 10m land from {NE_LAND_URL}")
        urllib.request.urlretrieve(NE_LAND_URL, NE_LAND_CACHE)
        size_mb = NE_LAND_CACHE.stat().st_size / 1_048_576
        print(f"  cached at {NE_LAND_CACHE} ({size_mb:.1f} MB)")
    return NE_LAND_CACHE


def reference_tif() -> Path:
    for cfg in THEMES.values():
        if cfg["tif"].exists():
            return cfg["tif"]
    raise FileNotFoundError("No source TIFF found for basemap reference")


def build_basemap(downsample: int = 2) -> None:
    ref = reference_tif()
    geo_path = fetch_ne_land()
    with geo_path.open("r", encoding="utf-8") as fh:
        geojson = json.load(fh)

    with rasterio.open(ref) as src:
        src_crs = src.crs
        src_transform = src.transform
        height = src.height
        width = src.width

    if src_crs is None:
        print("  ERROR: source TIFF has no CRS — cannot build basemap.", file=sys.stderr)
        return

    # Rasterize directly at downsampled resolution so the coastline stays a crisp 1 px line.
    if downsample > 1:
        target_transform = src_transform * Affine.scale(downsample)
        target_height = height // downsample
        target_width = width // downsample
    else:
        target_transform = src_transform
        target_height = height
        target_width = width

    print(
        f"  reprojecting {len(geojson['features'])} land features from EPSG:4326 -> {src_crs}"
    )
    geometries = []
    for feat in geojson["features"]:
        geom = feat.get("geometry")
        if not geom:
            continue
        try:
            reproj = transform_geom("EPSG:4326", src_crs, geom)
        except Exception as e:
            print(f"    [warn] skipping feature: {e}")
            continue
        geometries.append(reproj)

    print(f"  rasterizing land mask -> {target_width}x{target_height}")
    mask = rasterize(
        [(g, 1) for g in geometries],
        out_shape=(target_height, target_width),
        transform=target_transform,
        fill=0,
        all_touched=False,
        dtype=np.uint8,
    ).astype(bool)

    land_eroded = (
        np.roll(mask, 1, axis=0)
        & np.roll(mask, -1, axis=0)
        & np.roll(mask, 1, axis=1)
        & np.roll(mask, -1, axis=1)
    )
    coast = mask & ~land_eroded

    rgba = np.zeros((target_height, target_width, 4), dtype=np.uint8)
    rgba[mask] = LAND_RGBA
    rgba[coast] = COAST_RGBA

    BASEMAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(BASEMAP_PATH, "PNG", optimize=True)
    print(f"  wrote {BASEMAP_PATH} ({target_width}x{target_height})")


def render_theme(theme_key: str, records: list[dict], downsample: int, compress: bool, only_band: int | None) -> None:
    cfg = THEMES[theme_key]
    tif = cfg["tif"]
    cmap_name = cfg["cmap"]
    print(f"  rendering theme={theme_key} from {tif.name} (cmap={cmap_name}, downsample={downsample})")
    theme_records = [r for r in records if r["theme"] == theme_key]
    for rec in theme_records:
        if only_band is not None and rec["band"] != only_band:
            continue
        out_path = MAPS_DIR / theme_key / f"{rec['slug']}.png"
        print(f"    band {rec['band']:>2} -> {out_path.relative_to(PROJECT_ROOT)}")
        render_band(tif, rec["band"], out_path, cmap_name, downsample=downsample)
        if compress:
            maybe_pngquant(out_path)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--theme", choices=list(THEMES.keys()), help="Restrict to one theme")
    p.add_argument("--band", type=int, help="Restrict to one band index (1-based)")
    p.add_argument("--json-only", action="store_true", help="Only rebuild layers.json")
    p.add_argument("--maps-only", action="store_true", help="Only rebuild PNGs (bands + basemap)")
    p.add_argument("--basemap-only", action="store_true", help="Only rebuild basemap.png")
    p.add_argument("--full-res", action="store_true", help="Render at native 2541x1447 (default 2x downsample)")
    p.add_argument("--compress", action="store_true", help="Run pngquant on each band PNG (if installed)")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    do_json = not args.maps_only and not args.basemap_only
    do_basemap = not args.json_only
    do_bands = not args.json_only and not args.basemap_only

    if not CSV_PATH.exists():
        print(f"ERROR: CSV not found: {CSV_PATH}", file=sys.stderr)
        return 1

    print(f"Reading metadata: {CSV_PATH}")
    records = parse_metadata(CSV_PATH)
    print(f"  parsed {len(records)} rows ({sum(1 for r in records if r['theme']=='ecosystem')} ecosystem + {sum(1 for r in records if r['theme']=='pressure')} pressure)")

    if do_json:
        write_json(records, JSON_PATH)

    downsample = 1 if args.full_res else 2

    if do_basemap:
        print("Building land basemap...")
        try:
            build_basemap(downsample=downsample)
        except Exception as e:
            print(f"  ERROR building basemap: {e}", file=sys.stderr)
            if args.basemap_only:
                return 1

    if do_bands:
        themes_to_run = [args.theme] if args.theme else list(THEMES.keys())
        for theme_key in themes_to_run:
            if not THEMES[theme_key]["tif"].exists():
                print(f"  [skip] {theme_key}: TIFF not found at {THEMES[theme_key]['tif']}")
                continue
            render_theme(theme_key, records, downsample, args.compress, args.band)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
