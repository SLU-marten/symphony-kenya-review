import { getReview, saveReview, hasReviewerInfo } from '../services/reviewService.js';
import { openSetupModal } from './setupModal.js';

let currentKey = null;

const REVIEW_INSTRUCTIONS = `Mark each layer based on your expert judgement: <strong>OK</strong> if the layer is sufficiently accurate to publish, <strong>Minor revision</strong> if it should be refined before publication, <strong>Major revision</strong> if substantial issues remain. Add a brief comment to justify Minor or Major revision.`;

const FOCUS_OPTIONS = [
  { value: 'data_accuracy', label: 'Data accuracy' },
  { value: 'data_completeness', label: 'Data completeness' },
  { value: 'visualization', label: 'Visualization' },
];

export function initReviewForm() {
  const section = document.getElementById('review-section');

  section.innerHTML = `
    <h3 class="panel-heading">Expert Review Form</h3>
    <p class="review-instructions">${REVIEW_INSTRUCTIONS}</p>

    <div class="form-group">
      <label>Assessment <span class="req">*</span></label>
      <div class="flag-radio-group">
        <label class="flag-radio flag-radio-green" title="OK to publish as-is">
          <input type="radio" name="review-flag" value="green">
          <span class="flag-radio-label">
            <span class="flag-radio-dot flag-green"></span>
            <span>OK</span>
          </span>
        </label>
        <label class="flag-radio flag-radio-yellow" title="Keep, but should be refined before publication">
          <input type="radio" name="review-flag" value="yellow">
          <span class="flag-radio-label">
            <span class="flag-radio-dot flag-yellow"></span>
            <span>Minor revision</span>
          </span>
        </label>
        <label class="flag-radio flag-radio-red" title="Substantial issues; should not be published as-is">
          <input type="radio" name="review-flag" value="red">
          <span class="flag-radio-label">
            <span class="flag-radio-dot flag-red"></span>
            <span>Major revision</span>
          </span>
        </label>
      </div>
    </div>

    <div class="form-group">
      <label for="review-comment">Comment</label>
      <textarea id="review-comment" rows="4"
                placeholder="Justify your decision, especially for Yellow and Red flags..."></textarea>
    </div>

    <div class="form-group">
      <label>Review focus <span class="hint">(select all that apply)</span></label>
      <div class="checkbox-group" id="focus-group">
        ${FOCUS_OPTIONS.map(
          (o) => `
          <label class="checkbox-row">
            <input type="checkbox" name="focus" value="${o.value}">
            <span>${o.label}</span>
          </label>`
        ).join('')}
        <label class="checkbox-row checkbox-row-other">
          <input type="checkbox" name="focus" value="other" id="focus-other-cb">
          <span>Other:</span>
          <input type="text" id="focus-other-text" class="conditional-field inline-input"
                 placeholder="please specify" disabled>
        </label>
      </div>
    </div>

    <div class="form-group">
      <label>Do you have better or additional data?</label>
      <div class="radio-row">
        <label><input type="radio" name="better-data" value="no" checked> No</label>
        <label><input type="radio" name="better-data" value="yes"> Yes</label>
      </div>
      <div id="better-data-source" class="form-group conditional-field">
        <label for="better-data-link">Add link or source</label>
        <input type="text" id="better-data-link" placeholder="https:// or DOI / citation">
      </div>
    </div>

    <button id="submit-review" class="btn-submit" type="button">Submit review</button>
    <div id="review-status"></div>
  `;

  document.querySelectorAll('input[name="review-flag"]').forEach((r) => {
    r.addEventListener('change', () => {
      document.querySelectorAll('.flag-radio').forEach((l) => l.classList.remove('selected'));
      if (r.checked) r.closest('.flag-radio').classList.add('selected');
    });
  });

  const otherCb = document.getElementById('focus-other-cb');
  const otherText = document.getElementById('focus-other-text');
  otherCb.addEventListener('change', () => {
    otherText.disabled = !otherCb.checked;
    otherText.classList.toggle('show', otherCb.checked);
    if (otherCb.checked) otherText.focus();
    else otherText.value = '';
  });

  document.querySelectorAll('input[name="better-data"]').forEach((r) => {
    r.addEventListener('change', () => {
      const showSource = r.value === 'yes' && r.checked;
      const sourceWrap = document.getElementById('better-data-source');
      sourceWrap.classList.toggle('show', showSource);
      if (!showSource) document.getElementById('better-data-link').value = '';
    });
  });

  document.getElementById('submit-review').addEventListener('click', handleSubmit);
}

export function loadReviewForLayer(key) {
  currentKey = key;
  const review = getReview(key);

  document.querySelectorAll('input[name="review-flag"]').forEach((r) => {
    r.checked = false;
    r.closest('.flag-radio').classList.remove('selected');
  });
  document.getElementById('review-comment').value = '';

  document.querySelectorAll('input[name="focus"]').forEach((cb) => (cb.checked = false));
  const otherText = document.getElementById('focus-other-text');
  otherText.value = '';
  otherText.disabled = true;
  otherText.classList.remove('show');

  document.querySelector('input[name="better-data"][value="no"]').checked = true;
  document.querySelector('input[name="better-data"][value="yes"]').checked = false;
  const sourceWrap = document.getElementById('better-data-source');
  sourceWrap.classList.remove('show');
  document.getElementById('better-data-link').value = '';

  const status = document.getElementById('review-status');
  status.textContent = '';
  status.className = '';

  if (!review) return;

  if (review.flag) {
    const radio = document.querySelector(`input[name="review-flag"][value="${review.flag}"]`);
    if (radio) {
      radio.checked = true;
      radio.closest('.flag-radio').classList.add('selected');
    }
  }
  document.getElementById('review-comment').value = review.comment || '';

  const focusAreas = review.focus_areas || [];
  focusAreas.forEach((v) => {
    const cb = document.querySelector(`input[name="focus"][value="${v}"]`);
    if (cb) cb.checked = true;
  });
  if (focusAreas.includes('other')) {
    otherText.disabled = false;
    otherText.classList.add('show');
    otherText.value = review.other_focus || '';
  }

  const betterYes = review.has_better_data === 'yes';
  document.querySelector('input[name="better-data"][value="yes"]').checked = betterYes;
  document.querySelector('input[name="better-data"][value="no"]').checked = !betterYes;
  if (betterYes) {
    sourceWrap.classList.add('show');
    document.getElementById('better-data-link').value = review.better_data_source || '';
  }

  status.textContent = `Reviewed on ${new Date(review.timestamp).toLocaleDateString()}`;
  status.className = 'review-status-existing';
}

function handleSubmit() {
  if (!hasReviewerInfo()) {
    showStatus('Please complete the reviewer info first.', 'error');
    openSetupModal({ editing: false });
    return;
  }

  const flagEl = document.querySelector('input[name="review-flag"]:checked');
  if (!flagEl) {
    showStatus('Please select a flag (Green, Yellow, or Red).', 'error');
    return;
  }

  const comment = document.getElementById('review-comment').value.trim();
  const focusAreas = Array.from(
    document.querySelectorAll('input[name="focus"]:checked')
  ).map((cb) => cb.value);
  const otherFocus = focusAreas.includes('other')
    ? document.getElementById('focus-other-text').value.trim() || null
    : null;
  const betterDataEl = document.querySelector('input[name="better-data"]:checked');
  const hasBetterData = betterDataEl ? betterDataEl.value : 'no';
  const betterDataSource =
    hasBetterData === 'yes'
      ? document.getElementById('better-data-link').value.trim() || null
      : null;

  saveReview(currentKey, {
    flag: flagEl.value,
    comment,
    focus_areas: focusAreas,
    other_focus: otherFocus,
    has_better_data: hasBetterData,
    better_data_source: betterDataSource,
  });

  showStatus('Review saved.', 'success');
  window.dispatchEvent(
    new CustomEvent('reviewUpdated', { detail: { key: currentKey } })
  );
}

function showStatus(message, type) {
  const status = document.getElementById('review-status');
  status.textContent = message;
  status.className = `review-status-${type}`;
}
