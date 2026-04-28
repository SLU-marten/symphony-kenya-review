const STORAGE_KEY = 'symphonyKenya_reviews';
const REVIEWER_KEY = 'symphonyKenya_reviewerInfo';
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzLy6JD67qd6nmf6VlKoWAGWZu8nlrPEVKwPLpv0NlxpSUcld9e8_KuwlcX0H9b0gwB/exec';

// Google Sheets sync (optional). Set via either:
//   - .env.local:  VITE_SHEETS_URL=https://script.google.com/macros/s/.../exec
//   - or paste the URL directly into the fallback string below
// See GOOGLE_SHEETS_SETUP.md for the Apps Script and deploy instructions.
// const SHEETS_URL = import.meta.env.VITE_SHEETS_URL || '';

function getReviews() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getReview(key) {
  return getReviews()[key] || null;
}

export function getAllReviews() {
  return getReviews();
}

export function saveReview(key, review) {
  const reviews = getReviews();
  reviews[key] = {
    ...review,
    timestamp: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));

  if (SHEETS_URL) {
    submitToSheets(key, reviews[key]);
  }
  return reviews[key];
}

export function getReviewerInfo() {
  try {
    const raw = localStorage.getItem(REVIEWER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setReviewerInfo(info) {
  const record = {
    name: info.name?.trim() || '',
    email: info.email?.trim() || '',
    expertise: info.expertise?.trim() || '',
    consent: !!info.consent,
    updated: new Date().toISOString(),
  };
  localStorage.setItem(REVIEWER_KEY, JSON.stringify(record));
  return record;
}

export function hasReviewerInfo() {
  const info = getReviewerInfo();
  return !!(info && info.name && info.email && info.expertise);
}

export function exportReviewsAsJson() {
  const reviewer = getReviewerInfo();
  const reviews = getAllReviews();
  const payload = {
    project: 'Symphony Kenya',
    reviewer,
    reviews,
    exported_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (reviewer?.name || 'anonymous')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = `symphony-kenya-reviews-${safeName}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function submitToSheets(key, review) {
  const reviewer = getReviewerInfo() || {};
  try {
    await fetch(SHEETS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layer_key: key,
        reviewer_name: reviewer.name,
        reviewer_email: reviewer.email,
        reviewer_expertise: reviewer.expertise,
        reviewer_consent: !!reviewer.consent,
        flag: review.flag,
        comment: review.comment,
        focus_areas: review.focus_areas,
        other_focus: review.other_focus,
        has_better_data: review.has_better_data,
        better_data_source: review.better_data_source,
        timestamp: review.timestamp,
      }),
    });
  } catch (err) {
    console.warn('Failed to submit to Google Sheets:', err);
  }
}
