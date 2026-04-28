import {
  getReviewerInfo,
  setReviewerInfo,
  hasReviewerInfo as hasInfo,
} from '../services/reviewService.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export { hasInfo as hasReviewerInfo };

export function initSetupModal() {
  const form = document.getElementById('setup-form');
  const cancelBtn = document.getElementById('setup-cancel');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit();
  });

  cancelBtn.addEventListener('click', () => {
    closeSetupModal();
  });
}

export function openSetupModal({ editing = false } = {}) {
  const modal = document.getElementById('setup-modal');
  const cancelBtn = document.getElementById('setup-cancel');
  const errorEl = document.getElementById('setup-error');

  errorEl.textContent = '';

  const info = getReviewerInfo();
  document.getElementById('setup-name').value = info?.name || '';
  document.getElementById('setup-email').value = info?.email || '';
  document.getElementById('setup-expertise').value = info?.expertise || '';
  document.getElementById('setup-consent').checked = !!info?.consent;

  cancelBtn.classList.toggle('hidden', !editing);

  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('setup-name').focus(), 50);
}

export function closeSetupModal() {
  document.getElementById('setup-modal').classList.add('hidden');
}

function handleSubmit() {
  const name = document.getElementById('setup-name').value.trim();
  const email = document.getElementById('setup-email').value.trim();
  const expertise = document.getElementById('setup-expertise').value.trim();
  const consent = document.getElementById('setup-consent').checked;
  const errorEl = document.getElementById('setup-error');

  if (!name) {
    errorEl.textContent = 'Please enter your name.';
    document.getElementById('setup-name').focus();
    return;
  }
  if (!EMAIL_RE.test(email)) {
    errorEl.textContent = 'Please enter a valid email address.';
    document.getElementById('setup-email').focus();
    return;
  }
  if (!expertise) {
    errorEl.textContent = 'Please describe your area of expertise.';
    document.getElementById('setup-expertise').focus();
    return;
  }

  setReviewerInfo({ name, email, expertise, consent });
  errorEl.textContent = '';
  closeSetupModal();
  window.dispatchEvent(new CustomEvent('reviewerUpdated'));
}
