import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

let map = null;
let imageOverlay = null;
let dataBounds = null;
let activeBaseId = 'light';
let activeBaseLayers = [];

// Cell-value tooltip state. The bin is a UInt8-quantized grid at native TIFF
// resolution; cache one Uint8Array per layer key so re-visiting a layer is instant.
let rasterMeta = null; // { width, height, value_min, value_max, nodata, quant_max }
let activeValues = null; // { key, data: Uint8Array }
let activeValuesKey = null; // most recently requested key — guards against stale fetches
const valuesCache = new Map(); // key -> Uint8Array
let tooltipEl = null;
let valueFormatter = (v) => v.toFixed(1);

// Canvas-tile data overlay. Replaces the static PNG (which is kept as a
// fallback while .bin is loading) with a Leaflet GridLayer that re-renders
// per-zoom from activeValues + the theme's colormap, so the data stays sharp
// at every zoom level.
let valueGridLayer = null;
let activeColormap = null; // Uint8Array of 256 RGBA entries

// 9-stop ColorBrewer ramps matching the legend gradients in style.css and the
// matplotlib YlGn / YlOrRd colormaps used by preprocess.py. Linearly
// interpolated to 256 entries so a quantized raw byte (0..254) maps directly
// to RGBA.
const YLGN_STOPS = [
  [255, 255, 229], [247, 252, 185], [217, 240, 163], [173, 221, 142], [120, 198, 121],
  [65, 171, 93], [35, 132, 67], [0, 104, 55], [0, 69, 41],
];
const YLORRD_STOPS = [
  [255, 255, 204], [255, 237, 160], [254, 217, 118], [254, 178, 76], [253, 141, 60],
  [252, 78, 42], [227, 26, 28], [189, 0, 38], [128, 0, 38],
];

function buildColormapLUT(stops) {
  // Packed RGBA as little-endian uint32 so paintTile can write one dword per
  // pixel via a Uint32Array view of the canvas ImageData. ~3-4x faster than
  // four separate Uint8 writes on V8.
  const N = 256;
  const lut = new Uint32Array(N);
  const segments = stops.length - 1;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * segments;
    const seg = Math.min(segments - 1, Math.floor(t));
    const f = t - seg;
    const a = stops[seg];
    const b = stops[seg + 1];
    const r = (a[0] + (b[0] - a[0]) * f) | 0;
    const g = (a[1] + (b[1] - a[1]) * f) | 0;
    const bch = (a[2] + (b[2] - a[2]) * f) | 0;
    // bytes in memory: R G B A  →  uint32 LE: A<<24 | B<<16 | G<<8 | R
    lut[i] = (0xff << 24) | (bch << 16) | (g << 8) | r;
  }
  return lut;
}

const COLORMAP_LUTS = {
  ecosystem: buildColormapLUT(YLGN_STOPS),
  pressure: buildColormapLUT(YLORRD_STOPS),
};

const FIT_PADDING = [24, 24];

const BASEMAPS = {
  light: {
    label: 'Light',
    layers: [
      // Esri Light Gray Canvas — clean grey base with subtle borders
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 16,
          attribution:
            'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
        },
      },
      // Place labels overlay so cities (Mombasa, Malindi, ...) stay visible
      {
        url: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
        options: {
          subdomains: 'abcd',
          maxZoom: 19,
          attribution: 'Labels &copy; CARTO',
        },
      },
    ],
  },
  minimal: {
    label: 'Minimal',
    layers: [
      // Esri World Terrain Base — physical terrain coloring, no labels, no political borders
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 13,
          attribution:
            'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, NPS',
        },
      },
    ],
  },
  satellite: {
    label: 'Satellite',
    layers: [
      // Esri World Imagery — base
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          attribution:
            'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
      },
      // Place labels overlay so cities (Mombasa, Malindi, ...) stay visible on top of imagery
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          attribution: 'Place labels &copy; Esri',
        },
      },
    ],
  },
  ocean: {
    label: 'Ocean',
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 13,
          attribution:
            'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org and other contributors',
        },
      },
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 13,
          attribution: 'Reference &copy; Esri',
        },
      },
    ],
  },
};

export function initMapViewer(boundsLatLng, raster) {
  dataBounds = L.latLngBounds(boundsLatLng);
  rasterMeta = raster || null;

  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: true,
    minZoom: 3,
    maxZoom: 16,
    worldCopyJump: false,
  });

  applyBasemap(activeBaseId);
  buildBasemapSwitcher();
  setupValueTooltip();
  setupDataNeededOverlay();

  // Reset the render-queue idle timer on every zoom event so wheel bursts
  // don't repeatedly trigger expensive tile paints between ticks.
  map.on('zoomstart zoomend', markZoomBusy);

  // Bring the PNG underlay back at every zoomstart. Leaflet drops old canvas
  // tiles as soon as zoom ends, but our 250 ms render debounce delays new
  // ones — without the PNG showing through, the raster goes briefly blank.
  // The PNG is hidden again the moment canvas tiles fire `load`.
  map.on('zoomstart', () => {
    if (imageOverlay) imageOverlay.setOpacity(1);
  });

  map.fitBounds(dataBounds, { padding: FIT_PADDING });

  document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());
  document.getElementById('zoom-reset').addEventListener('click', () => {
    map.fitBounds(dataBounds, { padding: FIT_PADDING });
  });
}

function applyBasemap(id) {
  const cfg = BASEMAPS[id];
  if (!cfg) return;

  for (const layer of activeBaseLayers) {
    layer.remove();
  }
  activeBaseLayers = cfg.layers.map((spec) => L.tileLayer(spec.url, spec.options).addTo(map));

  // Keep the data overlays above any newly added basemap layers.
  if (imageOverlay) {
    imageOverlay.bringToFront();
  }
  if (valueGridLayer) {
    valueGridLayer.bringToFront();
  }
  activeBaseId = id;
}

function buildBasemapSwitcher() {
  const container = document.getElementById('basemap-switcher');
  if (!container) return;

  container.innerHTML = Object.entries(BASEMAPS)
    .map(
      ([id, cfg]) => `
      <button type="button" data-basemap="${id}"
              class="basemap-btn${id === activeBaseId ? ' is-active' : ''}">
        ${cfg.label}
      </button>
    `
    )
    .join('');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-basemap]');
    if (!btn) return;
    const id = btn.dataset.basemap;
    if (id === activeBaseId) return;
    applyBasemap(id);
    container.querySelectorAll('.basemap-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.basemap === id);
    });
  });
}

export function showMap(mapUrl, valuesUrl, layerKey) {
  if (!map) return;
  // Container may have been display:none on init — recompute size before we do anything else.
  map.invalidateSize();

  // Drop the previous layer's grid first so a stale colour render doesn't sit
  // on top while the new WebP/.bin.gz loads.
  if (valueGridLayer) {
    valueGridLayer.remove();
    valueGridLayer = null;
  }

  if (imageOverlay) {
    imageOverlay.remove();
    imageOverlay = null;
  }

  if (!mapUrl) {
    // Placeholder layer — no raster data exists yet. Keep the basemap and the
    // map's geographic context; the overlay div renders a "data needed" card.
    activeValues = null;
    activeValuesKey = null;
    activeColormap = null;
    hideTooltip();
    setDataNeededVisible(true);
    map.fitBounds(dataBounds, { padding: FIT_PADDING });
    return;
  }

  setDataNeededVisible(false);

  // WebP stays as the immediate-display fallback: it appears in ~100-200 ms
  // while the .bin.gz (typically 30-300 KB, decoded to 3.6 MB Uint8) is
  // fetched and stream-decompressed in parallel. Once the bin lands, the
  // ValueGridLayer is added on top and renders crisp at every zoom level.
  imageOverlay = L.imageOverlay(mapUrl, dataBounds, {
    opacity: 1,
    interactive: false,
    className: 'data-overlay',
  }).addTo(map);

  map.fitBounds(dataBounds, { padding: FIT_PADDING });

  loadValuesForLayer(valuesUrl, layerKey);
}

let dataNeededEl = null;

function setupDataNeededOverlay() {
  const host = document.getElementById('map-viewer');
  if (!host) return;
  dataNeededEl = document.createElement('div');
  dataNeededEl.className = 'data-needed-overlay hidden';
  dataNeededEl.innerHTML = `
    <div class="data-needed-card">
      <div class="data-needed-icon" aria-hidden="true">⚠</div>
      <h3>Data not yet available</h3>
      <p>This layer is on the planned list but has no data attached yet.
         If you know of relevant data sources, please leave a suggestion in
         the review form.</p>
    </div>
  `;
  host.appendChild(dataNeededEl);
}

function setDataNeededVisible(visible) {
  if (dataNeededEl) dataNeededEl.classList.toggle('hidden', !visible);
  const legend = document.getElementById('map-legend');
  if (legend) legend.classList.toggle('hidden', visible);
}

export function setLegend(layer) {
  const titleEl = document.getElementById('legend-title');
  const gradientEl = document.getElementById('legend-gradient');
  const suffix = layer.theme === 'pressure' ? 'pressure' : 'presence';
  titleEl.textContent = `${layer.title} — ${suffix}`;
  gradientEl.classList.remove('ramp-ecosystem', 'ramp-pressure');
  gradientEl.classList.add(layer.theme === 'pressure' ? 'ramp-pressure' : 'ramp-ecosystem');
}

// === Cell-value tooltip ============================================
//
// Desktop: hover triggers `mousemove` on the Leaflet map; we look up the
//   underlying raster cell and show a tooltip near the cursor.
// Mobile (no hover): tap fires `click`; same lookup, tooltip appears at the
//   tap point and stays until the next tap or layer change.
//
// Pixel lookup uses Leaflet layer-points so the projection (EPSG:3857) is
// honoured — the imageOverlay is positioned via `latLngToLayerPoint` of the
// corner lat/lngs, so the same projection of the cursor lat/lng lands on the
// correct pixel of the overlay.

function setupValueTooltip() {
  const host = document.getElementById('map-viewer');
  if (!host) return;

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'cell-value-tooltip';
  tooltipEl.setAttribute('aria-hidden', 'true');
  host.appendChild(tooltipEl);

  map.on('mousemove', handlePointerEvent);
  map.on('click', handlePointerEvent);
  map.on('mouseout', hideTooltip);
  // Pan/zoom: the cursor position no longer reflects a meaningful cell while
  // the world is moving; hide the tooltip until the next mousemove/click.
  map.on('movestart', hideTooltip);
  map.on('zoomstart', hideTooltip);
}

function handlePointerEvent(e) {
  if (!activeValues || !rasterMeta) {
    hideTooltip();
    return;
  }
  const value = lookupValue(e.latlng);
  if (value === null) {
    hideTooltip();
    return;
  }
  showTooltip(e.containerPoint, value);
}

function lookupValue(latlng) {
  const meta = rasterMeta;
  if (!meta || !activeValues) return null;
  const { width, height, nodata, quant_max, value_min, value_max } = meta;

  const tl = map.latLngToLayerPoint(dataBounds.getNorthWest());
  const br = map.latLngToLayerPoint(dataBounds.getSouthEast());
  const pt = map.latLngToLayerPoint(latlng);

  const fracX = (pt.x - tl.x) / (br.x - tl.x);
  const fracY = (pt.y - tl.y) / (br.y - tl.y);
  if (fracX < 0 || fracX >= 1 || fracY < 0 || fracY >= 1) return null;

  const px = Math.min(width - 1, Math.floor(fracX * width));
  const py = Math.min(height - 1, Math.floor(fracY * height));
  const raw = activeValues.data[py * width + px];
  if (raw === nodata) return null;

  const span = value_max - value_min;
  return value_min + (raw / quant_max) * span;
}

function showTooltip(containerPoint, value) {
  if (!tooltipEl) return;
  tooltipEl.textContent = valueFormatter(value);
  tooltipEl.style.left = `${containerPoint.x}px`;
  tooltipEl.style.top = `${containerPoint.y}px`;
  tooltipEl.classList.add('is-visible');
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove('is-visible');
}

async function loadValuesForLayer(valuesUrl, layerKey) {
  if (!valuesUrl || !layerKey || !rasterMeta) {
    activeValues = null;
    activeValuesKey = null;
    activeColormap = null;
    hideTooltip();
    return;
  }

  activeValuesKey = layerKey;
  // theme is the prefix of the key ("ecosystem:slug" or "pressure:slug").
  const theme = layerKey.split(':')[0];
  activeColormap = COLORMAP_LUTS[theme] || null;

  const cached = valuesCache.get(layerKey);
  if (cached) {
    activeValues = { key: layerKey, data: cached };
    applyValueGridLayer();
    return;
  }

  // Drop the previous active layer's values immediately so a stale tooltip
  // can't appear on top of the wrong layer during the fetch.
  activeValues = null;
  hideTooltip();

  try {
    const response = await fetch(valuesUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    let data = new Uint8Array(buffer);
    // Most static servers (Vite, GitHub Pages, NGINX) send `.gz` files with
    // `Content-Encoding: gzip`, in which case the browser already
    // transparently decompressed the body, and `data` is the full UInt8 raster.
    // If the payload size doesn't match the expected raster grid AND the
    // gzip magic bytes (1F 8B) are present, the server didn't auto-decompress
    // and we have to do it manually via DecompressionStream.
    const expected = rasterMeta ? rasterMeta.width * rasterMeta.height : 0;
    if (data.length !== expected && data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
      const decompressedStream = new Response(data).body.pipeThrough(
        new DecompressionStream('gzip')
      );
      data = new Uint8Array(await new Response(decompressedStream).arrayBuffer());
    }
    valuesCache.set(layerKey, data);
    if (activeValuesKey === layerKey) {
      activeValues = { key: layerKey, data };
      applyValueGridLayer();
    }
  } catch (err) {
    // Tooltip and grid just stay disabled for this layer; not worth surfacing in UI.
    console.warn(`Failed to load value bin for ${layerKey}:`, err);
  }
}

// === Canvas-tile data overlay ======================================
//
// Replaces the static PNG with a per-zoom canvas render. Each tile is 256×256
// canvas pixels rendered at the actual screen resolution, so zooming in stays
// crisp instead of CSS-stretching the source PNG.
//
// Tile pixel → cell index mapping is done in EPSG:3857 because the source
// TIFFs are already in Web Mercator (Leaflet's native CRS) — projecting the
// tile corners once and linearly interpolating across the tile gives exact
// cell indices with no per-pixel projection cost.
//
// Performance:
//   - `updateWhenZooming: false` skips tile renders during the zoom animation.
//     The PNG underlay handles the visual; canvas tiles snap in once zoom
//     settles.
//   - Render queue is gated on a 250 ms zoom-idle timer. Each zoomstart /
//     zoomend resets the timer, so a burst of wheel ticks won't paint tiles
//     between ticks — only after the user has stopped zooming for 250 ms.
//   - paintTile uses a Uint32Array view of the canvas ImageData so each pixel
//     is one dword write instead of four byte writes.
//   - createTile queues the actual paint via requestAnimationFrame with a
//     ~10 ms per-frame budget so a layer switch with many visible tiles
//     doesn't block the main thread for one big stutter.

const ZOOM_IDLE_MS = 250;
const renderQueue = [];
let renderScheduled = false;
let zoomIdle = true;
let zoomIdleTimer = null;

function markZoomBusy() {
  zoomIdle = false;
  if (zoomIdleTimer) clearTimeout(zoomIdleTimer);
  zoomIdleTimer = setTimeout(() => {
    zoomIdle = true;
    zoomIdleTimer = null;
    if (renderQueue.length && !renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(flushRenderQueue);
    }
  }, ZOOM_IDLE_MS);
}

function flushRenderQueue() {
  // Bail if a zoom kicked off mid-flush — markZoomBusy will re-arm us when the
  // user stops scrolling for ZOOM_IDLE_MS.
  if (!zoomIdle) {
    renderScheduled = false;
    return;
  }
  const start = performance.now();
  // Leave headroom in a 16 ms frame so the browser can repaint and process
  // wheel events. ~10 ms of paint work per frame keeps zoom feeling responsive
  // even when many tiles are queued.
  while (renderQueue.length && performance.now() - start < 10) {
    if (!zoomIdle) break;
    const job = renderQueue.shift();
    paintTile(job);
    job.done(null, job.tile);
  }
  if (renderQueue.length && zoomIdle) {
    requestAnimationFrame(flushRenderQueue);
  } else {
    renderScheduled = false;
  }
}

function enqueueRender(job) {
  renderQueue.push(job);
  if (!renderScheduled && zoomIdle) {
    renderScheduled = true;
    requestAnimationFrame(flushRenderQueue);
  }
}

const ValueGridLayer = L.GridLayer.extend({
  options: {
    // The PNG underlay shows during the zoom transition, so skipping tile
    // re-renders mid-zoom is invisible to the user — and it eliminates the
    // wheel-zoom stutter that comes from synchronous tile paints.
    updateWhenZooming: false,
  },
  createTile(coords, done) {
    const size = this.getTileSize();
    const tile = document.createElement('canvas');
    tile.width = size.x;
    tile.height = size.y;

    // Snapshot the data so the painted tile reflects whatever layer was active
    // when this tile was requested, even if the user switches layers before it
    // gets rendered. Stale tiles end up on detached canvases and are invisible.
    if (!activeValues || !rasterMeta || !activeColormap) {
      done(null, tile);
      return tile;
    }
    enqueueRender({
      coords,
      size,
      tile,
      done,
      values: activeValues.data,
      lut: activeColormap,
      meta: rasterMeta,
    });
    return tile;
  },
});

function paintTile(job) {
  const { coords, size, tile, values, lut, meta } = job;
  const { width, height, nodata } = meta;
  const crs = map.options.crs;

  const tlLatLng = crs.pointToLatLng(L.point(coords.x * size.x, coords.y * size.y), coords.z);
  const brLatLng = crs.pointToLatLng(L.point((coords.x + 1) * size.x, (coords.y + 1) * size.y), coords.z);
  const tl3857 = crs.project(tlLatLng);
  const br3857 = crs.project(brLatLng);

  const dataNW3857 = crs.project(dataBounds.getNorthWest());
  const dataSE3857 = crs.project(dataBounds.getSouthEast());
  const dataXMin = dataNW3857.x;
  const dataXMax = dataSE3857.x;
  const dataYMax = dataNW3857.y;
  const dataYMin = dataSE3857.y;
  const xSpan = dataXMax - dataXMin;
  const ySpan = dataYMax - dataYMin;

  // Precompute cellX per pixel column — depends only on px and is reused for every row.
  const cellXArr = new Int32Array(size.x);
  const tileXSpan = br3857.x - tl3857.x;
  for (let px = 0; px < size.x; px++) {
    const x3857 = tl3857.x + tileXSpan * (px / size.x);
    cellXArr[px] = Math.floor(((x3857 - dataXMin) / xSpan) * width);
  }

  const ctx = tile.getContext('2d');
  const imgData = ctx.createImageData(size.x, size.y);
  // dword view — one packed RGBA write per pixel.
  const out32 = new Uint32Array(imgData.data.buffer);
  const tileYSpan = br3857.y - tl3857.y;

  for (let py = 0; py < size.y; py++) {
    const y3857 = tl3857.y + tileYSpan * (py / size.y);
    const cellY = Math.floor(((dataYMax - y3857) / ySpan) * height);
    if (cellY < 0 || cellY >= height) continue;
    const rowOff = cellY * width;
    const outRowBase = py * size.x;

    for (let px = 0; px < size.x; px++) {
      const cellX = cellXArr[px];
      if (cellX < 0 || cellX >= width) continue;
      const raw = values[rowOff + cellX];
      // Match render_band(): zero is rendered transparent so the basemap shows
      // through, even though zero is a real value (the tooltip still reports it).
      if (raw === nodata || raw === 0) continue;
      out32[outRowBase + px] = lut[raw];
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function applyValueGridLayer() {
  if (valueGridLayer) {
    valueGridLayer.remove();
    valueGridLayer = null;
  }
  // Drop pending renders for the layer we just removed — their canvases are
  // detached and re-rendering them is wasted CPU during a layer switch.
  renderQueue.length = 0;
  if (!activeValues || !rasterMeta || !activeColormap) return;

  valueGridLayer = new ValueGridLayer({
    bounds: dataBounds,
    pane: 'overlayPane',
    opacity: 1,
    className: 'data-grid',
  });
  // Once all visible canvas tiles have rendered, hide the PNG underlay. The
  // canvas tiles have hard pixel boundaries; the PNG (CSS-scaled at high zoom)
  // has soft anti-aliased edges that bleed through the canvas's transparent
  // (zero / nodata) cells as a fuzzy halo. We only hide (opacity 0) rather
  // than remove — zoomstart re-shows it so the raster stays visible during
  // the next debounce window.
  valueGridLayer.on('load', () => {
    if (imageOverlay) imageOverlay.setOpacity(0);
  });
  valueGridLayer.addTo(map);
  valueGridLayer.bringToFront();
}
