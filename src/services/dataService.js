let layers = [];
let layersByKey = new Map();
let layersByTheme = { ecosystem: [], pressure: [] };
let currentTheme = 'ecosystem';

const THEME_LABELS = {
  ecosystem: 'Ecosystem Components',
  pressure: 'Pressures',
};

export async function loadLayerData() {
  const response = await fetch('./data/layers.json');
  layers = await response.json();
  layersByKey.clear();
  layersByTheme.ecosystem = [];
  layersByTheme.pressure = [];

  for (const layer of layers) {
    const key = `${layer.theme}:${layer.slug}`;
    layersByKey.set(key, layer);
    if (layersByTheme[layer.theme]) {
      layersByTheme[layer.theme].push(layer);
    }
  }
  return layers;
}

export function getThemes() {
  return Object.keys(THEME_LABELS).map((id) => ({
    id,
    label: THEME_LABELS[id],
    count: layersByTheme[id]?.length || 0,
  }));
}

export function getLayer(key) {
  return layersByKey.get(key);
}

export function getLayersByTheme(themeId) {
  return layersByTheme[themeId] || [];
}

export function getMapUrl(layer) {
  return `./${layer.map_file}`;
}

export function getCurrentTheme() {
  return currentTheme;
}

export function setCurrentTheme(themeId) {
  if (THEME_LABELS[themeId]) currentTheme = themeId;
}
