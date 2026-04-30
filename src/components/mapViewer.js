import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

let map = null;
let imageOverlay = null;
let dataBounds = null;

const FIT_PADDING = [24, 24];

export function initMapViewer(boundsLatLng) {
  dataBounds = L.latLngBounds(boundsLatLng);

  map = L.map('map-container', {
    zoomControl: false,
    attributionControl: true,
    minZoom: 3,
    maxZoom: 16,
    worldCopyJump: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  map.fitBounds(dataBounds, { padding: FIT_PADDING });

  document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());
  document.getElementById('zoom-reset').addEventListener('click', () => {
    map.fitBounds(dataBounds, { padding: FIT_PADDING });
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
