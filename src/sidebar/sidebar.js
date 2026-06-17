const COLORS = [
  '#4A90D9', '#E74C3C', '#2ECC71', '#F39C12',
  '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'
];

/** Strip trailing slash and fragment for URL comparison. */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/+$/, '') + u.search;
  } catch {
    return url;
  }
}

let selectedColor = COLORS[0];
let currentSpaces = [];
let activeSpaceId = null;

// DOM elements
const spaceTabs = document.getElementById('space-tabs');
const pinnedList = document.getElementById('pinned-list');
const openList = document.getElementById('open-list');
const addSpaceBtn = document.getElementById('add-space-btn');
const pinCurrentBtn = document.getElementById('pin-current-btn');
const modalOverlay = document.getElementById('modal-overlay');
const modalInput = document.getElementById('modal-input');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const colorPicker = document.getElementById('color-picker');
const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const autoCloseToggle = document.getElementById('auto-close-toggle');
const autoCloseHours = document.getElementById('auto-close-hours');

// Initialize — module scripts are deferred, so DOM may already be ready
const openSidebarBtn = document.getElementById('open-sidebar');

async function init() {
  await refreshUI();
  setupEventListeners();
  renderColorPicker();
  await loadSettings();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Listen for updates from the service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SPACE_SWITCHED') {
    refreshUI();
  } else if (message.type === 'TABS_CHANGED') {
    renderOpenTabs();
  }
});

async function refreshUI() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SPACES' });
  currentSpaces = response.spaces;
  activeSpaceId = response.activeSpaceId;
  renderSpaceTabs();
  renderPinnedTabs();
  renderOpenTabs();
}

function renderSpaceTabs() {
  spaceTabs.innerHTML = '';
  currentSpaces.forEach(space => {
    const btn = document.createElement('button');
    btn.className = `space-tab ${space.id === activeSpaceId ? 'active' : ''}`;
    btn.style.background = space.color;
    btn.textContent = space.name;
    btn.addEventListener('click', () => switchSpace(space.id));

    // Delete button (don't show for last space)
    if (currentSpaces.length > 1) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-space';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSpace(space.id);
      });
      btn.appendChild(deleteBtn);
    }

    spaceTabs.appendChild(btn);
  });
}

function renderPinnedTabs() {
  const space = currentSpaces.find(s => s.id === activeSpaceId);
  pinnedList.innerHTML = '';

  if (!space || space.pinnedTabs.length === 0) {
    pinnedList.innerHTML = '<li class="empty-state">No pinned tabs. Click 📌 to pin the current tab.</li>';
    return;
  }

  space.pinnedTabs.forEach(tab => {
    const li = document.createElement('li');
    li.className = 'tab-item';

    const favicon = document.createElement('img');
    favicon.className = 'favicon';
    favicon.src = getFaviconUrl(tab.url);
    favicon.onerror = () => { favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="%23666" width="16" height="16" rx="3"/></svg>'; };

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || new URL(tab.url).hostname;
    title.addEventListener('click', async () => {
      // Focus existing tab if open, otherwise open a new one
      const openTabs = await chrome.tabs.query({ currentWindow: true });
      const match = openTabs.find(t => normalizeUrl(t.url) === normalizeUrl(tab.url));
      if (match) {
        chrome.tabs.update(match.id, { active: true });
      } else {
        chrome.tabs.create({ url: tab.url });
      }
    });

    const actions = document.createElement('div');
    actions.className = 'tab-actions';

    // Show revert button if URL has changed from original
    if (tab.url !== tab.originalUrl) {
      const revertBtn = document.createElement('button');
      revertBtn.className = 'tab-action-btn revert';
      revertBtn.textContent = '↺';
      revertBtn.title = `Revert to: ${tab.originalUrl}`;
      revertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        revertPinnedTab(tab.id, tab.url);
      });
      actions.appendChild(revertBtn);
    }

    const unpinBtn = document.createElement('button');
    unpinBtn.className = 'tab-action-btn';
    unpinBtn.textContent = '✕';
    unpinBtn.title = 'Unpin';
    unpinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      unpinTab(tab.id);
    });
    actions.appendChild(unpinBtn);

    li.appendChild(favicon);
    li.appendChild(title);
    li.appendChild(actions);
    pinnedList.appendChild(li);
  });
}

async function renderOpenTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  // Get pinned URLs so we can skip them in open tab list
  const space = currentSpaces.find(s => s.id === activeSpaceId);
  const pinnedUrls = new Set((space?.pinnedTabs || []).map(p => normalizeUrl(p.url)));

  openList.innerHTML = '';

  tabs
    .filter(t => !t.pinned && !pinnedUrls.has(normalizeUrl(t.url || '')))
    .forEach(tab => {
      const li = document.createElement('li');
      li.className = 'tab-item';
      if (tab.active) li.classList.add('active');

      const favicon = document.createElement('img');
      favicon.className = 'favicon';
      favicon.src = tab.favIconUrl || getFaviconUrl(tab.url);
      favicon.onerror = () => { favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="%23666" width="16" height="16" rx="3"/></svg>'; };

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || 'New Tab';
      title.addEventListener('click', () => {
        chrome.tabs.update(tab.id, { active: true });
      });

      const actions = document.createElement('div');
      actions.className = 'tab-actions';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-action-btn';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.tabs.remove(tab.id);
      });
      actions.appendChild(closeBtn);

      li.appendChild(favicon);
      li.appendChild(title);
      li.appendChild(actions);
      openList.appendChild(li);
    });
}

function setupEventListeners() {
  addSpaceBtn.addEventListener('click', showModal);
  pinCurrentBtn.addEventListener('click', pinCurrentTab);
  modalCancel.addEventListener('click', hideModal);
  modalConfirm.addEventListener('click', confirmCreateSpace);
  modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmCreateSpace();
    if (e.key === 'Escape') hideModal();
  });

  toggleSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  autoCloseToggle.addEventListener('change', saveCurrentSettings);
  autoCloseHours.addEventListener('change', saveCurrentSettings);
}

function renderColorPicker() {
  colorPicker.innerHTML = '';
  COLORS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch ${color === selectedColor ? 'selected' : ''}`;
    swatch.style.background = color;
    swatch.addEventListener('click', () => {
      selectedColor = color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
    colorPicker.appendChild(swatch);
  });
}

function showModal() {
  modalOverlay.classList.remove('hidden');
  modalInput.value = '';
  modalInput.focus();
}

function hideModal() {
  modalOverlay.classList.add('hidden');
}

async function confirmCreateSpace() {
  const name = modalInput.value.trim();
  if (!name) return;

  await chrome.runtime.sendMessage({
    type: 'CREATE_SPACE',
    name,
    color: selectedColor
  });

  hideModal();
  await refreshUI();
}

async function switchSpace(spaceId) {
  if (spaceId === activeSpaceId) return;
  await chrome.runtime.sendMessage({ type: 'SWITCH_SPACE', spaceId });
  await refreshUI();
}

async function deleteSpace(spaceId) {
  if (!confirm('Delete this space? Open tabs will be lost.')) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_SPACE', spaceId });
  await refreshUI();
}

async function pinCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  await chrome.runtime.sendMessage({
    type: 'PIN_TAB',
    spaceId: activeSpaceId,
    url: tab.url,
    title: tab.title
  });

  await refreshUI();
}

async function unpinTab(pinId) {
  await chrome.runtime.sendMessage({
    type: 'UNPIN_TAB',
    spaceId: activeSpaceId,
    pinId
  });
  await refreshUI();
}

async function revertPinnedTab(pinId, currentUrl) {
  await chrome.runtime.sendMessage({
    type: 'REVERT_TAB',
    spaceId: activeSpaceId,
    pinId,
    currentUrl
  });
  await refreshUI();
}

function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch {
    return '';
  }
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const settings = response.settings;
  autoCloseToggle.checked = settings.autoCloseEnabled;
  autoCloseHours.value = settings.autoCloseHours;
}

async function saveCurrentSettings() {
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
      autoCloseEnabled: autoCloseToggle.checked,
      autoCloseHours: parseInt(autoCloseHours.value, 10) || 24
    }
  });
}
