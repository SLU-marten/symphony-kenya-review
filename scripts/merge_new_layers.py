"""
Merge new single-/multi-band TIFFs into the existing ecosystem and pressure
stacks at the destination grid (the existing stacks' transform/dims).

New TIFFs may be at a coarser resolution or slightly different bounds — they
get reprojected onto the destination grid via bilinear resampling. Existing
bands are copied verbatim. Band descriptions are preserved and extended.

Reads paths from constants below — edit them per merge.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

# PROJ_LIB workaround — same as preprocess.py
_spec = importlib.util.find_spec("rasterio")
if _spec and _spec.submodule_search_locations:
    for _loc in _spec.submodule_search_locations:
        _cand = os.path.join(_loc, "proj_data")
        if os.path.isdir(_cand):
            os.environ["PROJ_LIB"] = _cand
            os.environ["PROJ_DATA"] = _cand
            break

import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "Layers_260427_250m"
NEW_DIR = DATA_DIR / "New layers"

MERGES = [
    {
        "dest": DATA_DIR / "ecosystem_Layers_260427_250m.tif",
        "new":  NEW_DIR / "ecosystem_Marten_Layers.tif",
    },
    {
        "dest": DATA_DIR / "pressure_Layers_260427_250m.tif",
        "new":  NEW_DIR / "pressure_Marten_Layers.tif",
    },
]


def merge_one(dest_path: Path, new_path: Path) -> None:
    print(f"\nMerging {new_path.name} -> {dest_path.name}")
    with rasterio.open(dest_path) as dst_src:
        dst_profile = dst_src.profile.copy()
        dst_transform = dst_src.transform
        dst_crs = dst_src.crs
        dst_width = dst_src.width
        dst_height = dst_src.height
        dst_nodata = dst_src.nodata
        existing_bands = [dst_src.read(i) for i in range(1, dst_src.count + 1)]
        existing_descs = list(dst_src.descriptions)
        print(f"  existing: {dst_src.count} bands at {dst_width}x{dst_height}, nodata={dst_nodata}")

    with rasterio.open(new_path) as new_src:
        new_count = new_src.count
        new_descs = list(new_src.descriptions)
        new_nodata = new_src.nodata
        print(f"  new:      {new_count} bands at {new_src.width}x{new_src.height}, nodata={new_nodata}")

        reprojected = []
        for b in range(1, new_count + 1):
            src_arr = new_src.read(b)
            dst_arr = np.full((dst_height, dst_width), dst_nodata if dst_nodata is not None else np.nan, dtype=src_arr.dtype)
            reproject(
                source=src_arr,
                destination=dst_arr,
                src_transform=new_src.transform,
                src_crs=new_src.crs,
                src_nodata=new_nodata,
                dst_transform=dst_transform,
                dst_crs=dst_crs,
                dst_nodata=dst_nodata,
                resampling=Resampling.bilinear,
            )
            valid_mask = (dst_arr != dst_nodata) & ~np.isnan(dst_arr)
            n_valid = int(valid_mask.sum())
            vmin = float(dst_arr[valid_mask].min()) if n_valid else float("nan")
            vmax = float(dst_arr[valid_mask].max()) if n_valid else float("nan")
            print(f"    band {b} ({new_descs[b-1]}): resampled, n_valid={n_valid}, range=({vmin:.4f}, {vmax:.4f})")
            reprojected.append(dst_arr)

    all_bands = existing_bands + reprojected
    all_descs = existing_descs + new_descs
    new_total = len(all_bands)
    dst_profile.update(count=new_total)

    print(f"  writing {dest_path} with {new_total} bands")
    with rasterio.open(dest_path, "w", **dst_profile) as out:
        for i, arr in enumerate(all_bands, start=1):
            out.write(arr, i)
        out.descriptions = tuple(all_descs)
    print(f"  done. descriptions: {all_descs}")


def main() -> int:
    for m in MERGES:
        if not m["dest"].exists():
            print(f"ERROR: dest missing: {m['dest']}", file=sys.stderr)
            return 1
        if not m["new"].exists():
            print(f"ERROR: new missing: {m['new']}", file=sys.stderr)
            return 1
        merge_one(m["dest"], m["new"])
    print("\nAll merges done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
