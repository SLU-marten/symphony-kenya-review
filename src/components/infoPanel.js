import { getLayer } from '../services/dataService.js';

let currentKey = null;

export function initInfoPanel() {
  const modal = document.getElementById('metadata-modal');
  document
    .getElementById('metadata-close')
    .addEventListener('click', closeMetadataModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeMetadataModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeMetadataModal();
    }
  });
}

export function showInfoPanel(key) {
  currentKey = key;
  const layer = getLayer(key);
  if (!layer) return;

  const panel = document.getElementById('info-panel');
  const isEmpty = !layer.description && !layer.method_summary;
  const noData = layer.data_available === false;

  const themeLabel =
    layer.theme === 'pressure' ? 'Pressure' : 'Ecosystem Component';
  const themeBadgeClass =
    layer.theme === 'pressure' ? 'theme-badge-pressure' : 'theme-badge-ecosystem';

  panel.innerHTML = `
    <h3 class="panel-heading">Metadata</h3>
    <h2>
      ${escapeHtml(layer.title)}
      ${noData ? '<span class="layer-needs-data info-needs-data">Data needed</span>' : ''}
    </h2>
    <p class="theme-line">
      <span class="theme-badge ${themeBadgeClass}">${themeLabel}</span>
      ${layer.subtheme ? `<span class="theme-sub">${escapeHtml(layer.subtheme)}</span>` : ''}
    </p>

    ${noData ? `
      <div class="info-callout">
        No data is attached to this layer yet — it is on the planned list.
        If you can point us to a suitable dataset, please add a note in the
        review form below.
      </div>
      ${layer.description ? `<p class="compact-description">${escapeHtml(layer.description)}</p>` : ''}
    ` : isEmpty ? `
      <div class="info-callout">
        Metadata for this layer is not yet available.
      </div>
    ` : `
      <p class="compact-description">${escapeHtml(layer.description || '')}</p>
      <div class="compact-grid">
        <div class="info-item">
          <label>Latest update</label>
          ${fmt(layer.latest_update)}
        </div>
        <div class="info-item">
          <label>Data providers</label>
          ${fmt(layer.providers)}
        </div>
      </div>
    `}

    <button id="show-full-metadata" class="btn-secondary btn-secondary-light" type="button">
      Show full metadata
    </button>
  `;

  document
    .getElementById('show-full-metadata')
    .addEventListener('click', () => showMetadataModal(currentKey));
}

export function showMetadataModal(key) {
  const layer = getLayer(key);
  if (!layer) return;

  const themeLabel =
    layer.theme === 'pressure' ? 'Pressure' : 'Ecosystem Component';

  document.getElementById('metadata-title').textContent = layer.title;

  document.getElementById('metadata-modal-body').innerHTML = `
    <p class="theme-line">
      <span class="theme-badge ${
        layer.theme === 'pressure' ? 'theme-badge-pressure' : 'theme-badge-ecosystem'
      }">${themeLabel}</span>
      ${layer.subtheme ? `<span class="theme-sub">${escapeHtml(layer.subtheme)}</span>` : ''}
    </p>
    <div class="info-grid">
      ${row('Description', fmtMultiline(layer.description), { full: true })}
      ${row('Data providers', fmt(layer.providers))}
      ${row('Latest update', fmt(layer.latest_update))}
      ${row('Temporal coverage', fmtRange(layer.temporal_start, layer.temporal_end))}
      ${row('Data collected', fmt(layer.data_collected))}
      ${row('Method summary', fmtMultiline(layer.method_summary), { full: true })}
      ${row('Known limitations', fmtMultiline(layer.known_limitations), { full: true })}
      ${row('Source citation', fmtMultiline(layer.source_citation), { full: true })}
      ${row('Lineage', fmt(layer.lineage), { full: true })}
      ${row('Links', fmtLinks(layer.links), { full: true })}
      ${row('Contact', fmtContact(layer.contact), { full: true })}
    </div>
  `;

  document.getElementById('metadata-modal').classList.remove('hidden');
}

export function closeMetadataModal() {
  document.getElementById('metadata-modal').classList.add('hidden');
}

function row(label, valueHtml, opts = {}) {
  const cls = opts.full ? 'info-item full-width' : 'info-item';
  return `
    <div class="${cls}">
      <label>${label}</label>
      ${valueHtml}
    </div>
  `;
}

function fmt(value) {
  if (value == null || value === '') return `<span class="info-empty">&mdash;</span>`;
  return `<span>${escapeHtml(value)}</span>`;
}

function fmtMultiline(value) {
  if (value == null || value === '') return `<span class="info-empty">&mdash;</span>`;
  return `<p class="multiline">${escapeHtml(value)}</p>`;
}

function fmtRange(start, end) {
  if (!start && !end) return `<span class="info-empty">&mdash;</span>`;
  if (start && end && start !== end) {
    return `<span>${escapeHtml(start)} &rarr; ${escapeHtml(end)}</span>`;
  }
  return `<span>${escapeHtml(start || end)}</span>`;
}

function fmtLinks(links) {
  if (!links || links.length === 0) return `<span class="info-empty">&mdash;</span>`;
  return `
    <ul class="info-links">
      ${links
        .map(
          (l) => `<li><a href="${escapeAttr(l)}" target="_blank" rel="noopener">${escapeHtml(l)}</a></li>`
        )
        .join('')}
    </ul>
  `;
}

function fmtContact(c) {
  if (!c) return `<span class="info-empty">&mdash;</span>`;
  const parts = [];
  if (c.name) parts.push(escapeHtml(c.name));
  if (c.email) {
    parts.push(`<a href="mailto:${escapeAttr(c.email)}">${escapeHtml(c.email)}</a>`);
  }
  if (c.org) parts.push(escapeHtml(c.org));
  if (c.phone) parts.push(escapeHtml(c.phone));
  if (parts.length === 0) return `<span class="info-empty">&mdash;</span>`;
  return `<p class="contact">${parts.join(' &middot; ')}</p>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}
