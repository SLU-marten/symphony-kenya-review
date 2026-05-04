import './style.css';
import {
  loadLayerData,
  getLayer,
  getMapUrl,
  getLayersByTheme,
  setCurrentTheme,
  getBounds,
} from './services/dataService.js';
import { initSidebar, setActiveLayer, refreshLayerList } from './components/sidebar.js';
import { initMapViewer, showMap, setLegend } from './components/mapViewer.js';
import { initInfoPanel, showInfoPanel } from './components/infoPanel.js';
import { initReviewForm, loadReviewForLayer } from './components/reviewForm.js';
import {
  initSetupModal,
  openSetupModal,
  hasReviewerInfo,
} from './components/setupModal.js';
import { initMobileLayout, closeSidebarDrawer } from './components/mobileLayout.js';

async function init() {
  await loadLayerData();
  initMapViewer(getBounds());
  initReviewForm();
  initSetupModal();
  initInfoPanel();
  initSidebar(selectLayer, changeTheme);
  initMobileLayout();

  document.getElementById('edit-reviewer').addEventListener('click', () => {
    openSetupModal({ editing: true });
  });

  if (!hasReviewerInfo()) {
    openSetupModal({ editing: false });
  }
}

function selectLayer(key) {
  const layer = getLayer(key);
  if (!layer) return;
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('layer-view').classList.remove('hidden');
  showMap(getMapUrl(layer));
  setLegend(layer);
  showInfoPanel(key);
  loadReviewForLayer(key);
  setActiveLayer(key);
  closeSidebarDrawer();
}

function changeTheme(themeId) {
  setCurrentTheme(themeId);
  refreshLayerList();
  const layers = getLayersByTheme(themeId);
  if (layers.length) {
    selectLayer(`${themeId}:${layers[0].slug}`);
  } else {
    document.getElementById('layer-view').classList.add('hidden');
    document.getElementById('welcome-screen').classList.remove('hidden');
  }
}

init();
