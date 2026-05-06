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

  // Keep the data overlay above any newly added basemap layers.
  if (imageOverlay) {
    imageOverlay.bringToFront();
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

  if (imageOverlay) {
    imageOverlay.remove();
    imageOverlay = null;
  }
  imageOverlay = L.imageOverlay(mapUrl, dataBounds, {
    opacity: 1,
    interactive: false,
    className: 'data-overlay',
  }).addTo(map);

  map.fitBounds(dataBounds, { padding: FIT_PADDING });

  loadValuesForLayer(valuesUrl, layerKey);
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
    hideTooltip();
    return;
  }

  activeValuesKey = layerKey;

  const cached = valuesCache.get(layerKey);
  if (cached) {
    activeValues = { key: layerKey, data: cached };
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
    const data = new Uint8Array(buffer);
    valuesCache.set(layerKey, data);
    if (activeValuesKey === layerKey) {
      activeValues = { key: layerKey, data };
    }
  } catch (err) {
    // Tooltip just stays disabled for this layer; not worth surfacing in UI.
    console.warn(`Failed to load value bin for ${layerKey}:`, err);
  }
}
