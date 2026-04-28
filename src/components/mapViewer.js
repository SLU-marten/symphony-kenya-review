import panzoom from 'panzoom';

let panzoomInstance = null;

export function initMapViewer() {
  const container = document.getElementById('map-container');
  const img = document.getElementById('map-image');

  panzoomInstance = panzoom(img, {
    maxZoom: 8,
    minZoom: 0.3,
    smoothScroll: false,
    bounds: true,
    boundsPadding: 0.1,
    zoomDoubleClickSpeed: 1,
  });

  document.getElementById('zoom-in').addEventListener('click', () => {
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    panzoomInstance.smoothZoom(cx, cy, 1.5);
  });

  document.getElementById('zoom-out').addEventListener('click', () => {
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    panzoomInstance.smoothZoom(cx, cy, 0.67);
  });

  document.getElementById('zoom-reset').addEventListener('click', resetView);
}

export function showMap(mapUrl) {
  const img = document.getElementById('map-image');
  img.style.backgroundImage = "url('./data/basemap.png')";
  img.src = mapUrl;
  img.onload = () => resetView();
}

export function setLegend(layer) {
  const titleEl = document.getElementById('legend-title');
  const gradientEl = document.getElementById('legend-gradient');
  const suffix = layer.theme === 'pressure' ? 'pressure' : 'presence';
  titleEl.textContent = `${layer.title} — ${suffix}`;
  gradientEl.classList.remove('ramp-ecosystem', 'ramp-pressure');
  gradientEl.classList.add(layer.theme === 'pressure' ? 'ramp-pressure' : 'ramp-ecosystem');
}

function resetView() {
  if (!panzoomInstance) return;
  const container = document.getElementById('map-container');
  const img = document.getElementById('map-image');
  if (!img.naturalWidth) return;

  const scaleX = container.clientWidth / img.naturalWidth;
  const scaleY = container.clientHeight / img.naturalHeight;
  const scale = Math.min(scaleX, scaleY, 1);

  const offsetX = (container.clientWidth - img.naturalWidth * scale) / 2;
  const offsetY = (container.clientHeight - img.naturalHeight * scale) / 2;

  panzoomInstance.zoomAbs(0, 0, scale);
  panzoomInstance.moveTo(offsetX, offsetY);
}
