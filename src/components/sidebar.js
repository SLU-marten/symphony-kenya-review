import {
  getThemes,
  getLayersByTheme,
  getCurrentTheme,
  setCurrentTheme,
} from '../services/dataService.js';
import { getAllReviews } from '../services/reviewService.js';

let onLayerSelectCallback = null;
let onThemeChangeCallback = null;
let activeKey = null;

export function initSidebar(onLayerSelect, onThemeChange) {
  onLayerSelectCallback = onLayerSelect;
  onThemeChangeCallback = onThemeChange;

  renderThemeTabs();
  renderLayerList();
  setupSearch();

  window.addEventListener('reviewUpdated', (e) => {
    updateLayerDot(e.detail.key);
  });
}

export function setActiveLayer(key) {
  activeKey = key;
  document.querySelectorAll('.layer-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });
  const activeEl = document.querySelector('.layer-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

export function refreshLayerList() {
  renderLayerList();
  if (activeKey) setActiveLayer(activeKey);
}

function renderThemeTabs() {
  const container = document.getElementById('group-selector');
  const themes = getThemes();
  const current = getCurrentTheme();

  container.innerHTML = themes
    .map(
      (t) => `
      <button class="group-tab ${t.id === current ? 'active' : ''}" data-theme="${t.id}">
        ${t.label} <span class="theme-count">${t.count}</span>
      </button>`
    )
    .join('');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.group-tab');
    if (!btn) return;
    const themeId = btn.dataset.theme;
    container.querySelectorAll('.group-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    setCurrentTheme(themeId);
    onThemeChangeCallback(themeId);
  });
}

function renderLayerList() {
  const list = document.getElementById('layer-list');
  const layers = getLayersByTheme(getCurrentTheme());
  const reviews = getAllReviews();

  list.innerHTML = '';
  layers.forEach((layer) => {
    const key = `${layer.theme}:${layer.slug}`;
    const li = document.createElement('li');
    li.className = 'layer-item';
    if (!layer.data_available) li.classList.add('no-data');
    li.dataset.key = key;
    li.dataset.search = `${layer.title} ${layer.subtheme || ''}`.toLowerCase();

    const review = reviews[key];
    const dot = document.createElement('span');
    dot.className = `flag-dot flag-${review ? review.flag : 'none'}`;
    dot.title = review ? `Reviewer: ${review.flag}` : 'Not reviewed';

    const nameWrap = document.createElement('span');
    nameWrap.className = 'layer-name';
    const nameText = document.createElement('span');
    nameText.className = 'layer-name-text';
    nameText.textContent = layer.title;
    nameWrap.appendChild(nameText);
    if (!layer.data_available) {
      const badge = document.createElement('span');
      badge.className = 'layer-needs-data';
      badge.textContent = 'Data needed';
      badge.title = 'Data not yet available — suggest sources via the review form';
      nameWrap.appendChild(badge);
    }

    const subSpan = document.createElement('span');
    subSpan.className = 'layer-sub';
    subSpan.textContent = layer.subtheme || '';

    li.append(dot, nameWrap, subSpan);
    li.addEventListener('click', () => onLayerSelectCallback(key));
    list.appendChild(li);
  });

  applySearchFilter();
}

function setupSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', applySearchFilter);
}

function applySearchFilter() {
  const input = document.getElementById('search-input');
  const query = (input?.value || '').toLowerCase().trim();
  document.querySelectorAll('.layer-item').forEach((li) => {
    const match = !query || li.dataset.search.includes(query);
    li.style.display = match ? '' : 'none';
  });
}

function updateLayerDot(key) {
  const li = document.querySelector(`.layer-item[data-key="${key}"]`);
  if (!li) return;
  const reviews = getAllReviews();
  const review = reviews[key];
  const dot = li.querySelector('.flag-dot');
  if (dot) {
    dot.className = `flag-dot flag-${review ? review.flag : 'none'}`;
    dot.title = review ? `Reviewer: ${review.flag}` : 'Not reviewed';
  }
}
