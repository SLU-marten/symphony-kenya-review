import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

let map = null;
let imageOverlay = null;
let dataBounds = null;
let activeBaseId = 'light';
let activeBaseLayers = [];

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

export function initMapViewer(boundsLatLng) {
  dataBounds = L.latLngBounds(boundsLatLng);

  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: true,
    minZoom: 3,
    maxZoom: 16,
    worldCopyJump: false,
  });

  applyBasemap(activeBaseId);
  buildBasemapSwitcher();

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

export function showMap(mapUrl) {
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
}

export function setLegend(layer) {
  const titleEl = document.getElementById('legend-title');
  const gradientEl = document.getElementById('legend-gradient');
  const suffix = layer.theme === 'pressure' ? 'pressure' : 'presence';
  titleEl.textContent = `${layer.title} — ${suffix}`;
  gradientEl.classList.remove('ramp-ecosystem', 'ramp-pressure');
  gradientEl.classList.add(layer.theme === 'pressure' ? 'ramp-pressure' : 'ramp-ecosystem');
}
