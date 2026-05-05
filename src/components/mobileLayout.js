// Mobile layout: hamburger drawer + bottom sheet.
// Active only via CSS at < 768px, but JS toggles classes that the desktop layout
// also tolerates (no-ops at desktop sizes).

const MOBILE_QUERY = window.matchMedia('(max-width: 768px)');

let sheetState = 'peek'; // 'peek' | 'full' — only meaningful on mobile

export function initMobileLayout({ onSidebarOpen } = {}) {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('backdrop');
  const sheetHandle = document.getElementById('sheet-handle');
  const rightPanel = document.getElementById('right-panel');

  toggle.addEventListener('click', () => {
    const open = !sidebar.classList.contains('is-open');
    setSidebarOpen(open);
    if (open && onSidebarOpen) onSidebarOpen();
  });

  backdrop.addEventListener('click', () => setSidebarOpen(false));

  sheetHandle.addEventListener('click', () => {
    setSheetState(sheetState === 'peek' ? 'full' : 'peek');
  });

  // Reset state when crossing the breakpoint so we don't leave a half-open
  // drawer or full sheet stuck on a desktop viewport.
  MOBILE_QUERY.addEventListener('change', () => {
    setSidebarOpen(false);
    setSheetState('peek');
  });

  function setSidebarOpen(open) {
    sidebar.classList.toggle('is-open', open);
    backdrop.hidden = !open;
    backdrop.classList.toggle('is-visible', open);
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('drawer-open', open);
  }

  function setSheetState(state) {
    sheetState = state;
    rightPanel.classList.toggle('sheet-full', state === 'full');
    document.body.classList.toggle('sheet-full', state === 'full');
    sheetHandle.setAttribute(
      'aria-label',
      state === 'full' ? 'Collapse panel' : 'Expand panel'
    );
    const textEl = sheetHandle.querySelector('.sheet-handle-text');
    if (textEl) {
      textEl.textContent =
        state === 'full' ? 'Tap to close' : 'Tap to open metadata & review';
    }
  }
}

export function closeSidebarDrawer() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar.classList.contains('is-open')) return;
  sidebar.classList.remove('is-open');
  document.getElementById('backdrop').hidden = true;
  document.getElementById('backdrop').classList.remove('is-visible');
  document.getElementById('sidebar-toggle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('drawer-open');
}
