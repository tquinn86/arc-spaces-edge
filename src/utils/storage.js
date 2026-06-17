/**
 * Storage utility for managing spaces data.
 *
 * Data schema:
 * {
 *   spaces: [
 *     {
 *       id: string,
 *       name: string,
 *       color: string,
 *       pinnedTabs: [{ id: string, url: string, originalUrl: string, title: string }],
 *       openTabs: [{ url: string, title: string }],
 *       isActive: boolean
 *     }
 *   ],
 *   activeSpaceId: string
 * }
 */

const DEFAULT_SPACE = {
  id: 'default',
  name: 'Personal',
  color: '#4A90D9',
  pinnedTabs: [],
  openTabs: [],
  isActive: true
};

export async function getSpaces() {
  const data = await chrome.storage.local.get('spaces');
  return data.spaces || [{ ...DEFAULT_SPACE, pinnedTabs: [], openTabs: [] }];
}

export async function saveSpaces(spaces) {
  await chrome.storage.local.set({ spaces });
}

export async function getActiveSpaceId() {
  const data = await chrome.storage.local.get('activeSpaceId');
  return data.activeSpaceId || 'default';
}

export async function setActiveSpaceId(id) {
  await chrome.storage.local.set({ activeSpaceId: id });
}

export async function getActiveSpace() {
  const spaces = await getSpaces();
  const activeId = await getActiveSpaceId();
  return spaces.find(s => s.id === activeId) || spaces[0];
}

export async function createSpace(name, color) {
  const spaces = await getSpaces();
  const newSpace = {
    id: uniqueId('space'),
    name,
    color: color || getNextColor(spaces.length),
    pinnedTabs: [],
    openTabs: [],
    isActive: false
  };
  spaces.push(newSpace);
  await saveSpaces(spaces);
  return newSpace;
}

export async function deleteSpace(spaceId) {
  let spaces = await getSpaces();
  if (spaces.length <= 1) throw new Error('Cannot delete the last space');
  spaces = spaces.filter(s => s.id !== spaceId);
  await saveSpaces(spaces);

  const activeId = await getActiveSpaceId();
  if (activeId === spaceId) {
    await setActiveSpaceId(spaces[0].id);
  }
  return spaces;
}

export async function updateSpace(spaceId, updates) {
  const spaces = await getSpaces();
  const index = spaces.findIndex(s => s.id === spaceId);
  if (index === -1) throw new Error(`Space ${spaceId} not found`);
  spaces[index] = { ...spaces[index], ...updates };
  await saveSpaces(spaces);
  return spaces[index];
}

let _idCounter = 0;
function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${_idCounter++}`;
}

/** Reset internal counter (for tests only) */
export function _resetForTest() {
  _idCounter = 0;
}

export async function pinTab(spaceId, url, title) {
  const spaces = await getSpaces();
  const space = spaces.find(s => s.id === spaceId);
  if (!space) throw new Error(`Space ${spaceId} not found`);

  const pinnedTab = {
    id: uniqueId('pin'),
    url,
    originalUrl: url,
    title
  };
  space.pinnedTabs.push(pinnedTab);
  await saveSpaces(spaces);
  return pinnedTab;
}

export async function unpinTab(spaceId, pinId) {
  const spaces = await getSpaces();
  const space = spaces.find(s => s.id === spaceId);
  if (!space) throw new Error(`Space ${spaceId} not found`);
  space.pinnedTabs = space.pinnedTabs.filter(t => t.id !== pinId);
  await saveSpaces(spaces);
}

export async function revertTab(spaceId, pinId) {
  const spaces = await getSpaces();
  const space = spaces.find(s => s.id === spaceId);
  if (!space) throw new Error(`Space ${spaceId} not found`);
  const tab = space.pinnedTabs.find(t => t.id === pinId);
  if (!tab) throw new Error(`Pinned tab ${pinId} not found`);
  tab.url = tab.originalUrl;
  await saveSpaces(spaces);
  return tab;
}

// --- Tab age tracking ---

export async function getTabTimestamps() {
  const data = await chrome.storage.local.get('tabTimestamps');
  return data.tabTimestamps || {};
}

export async function saveTabTimestamps(timestamps) {
  await chrome.storage.local.set({ tabTimestamps: timestamps });
}

export async function trackTab(tabId) {
  const timestamps = await getTabTimestamps();
  if (!timestamps[tabId]) {
    timestamps[tabId] = Date.now();
    await saveTabTimestamps(timestamps);
  }
}

export async function untrackTab(tabId) {
  const timestamps = await getTabTimestamps();
  delete timestamps[tabId];
  await saveTabTimestamps(timestamps);
}

export async function refreshTabTimestamp(tabId) {
  const timestamps = await getTabTimestamps();
  timestamps[tabId] = Date.now();
  await saveTabTimestamps(timestamps);
}

// --- Settings ---

const DEFAULT_SETTINGS = {
  autoCloseEnabled: true,
  autoCloseHours: 24
};

export async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...data.settings };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...settings } });
}

const SPACE_COLORS = [
  '#4A90D9', '#E74C3C', '#2ECC71', '#F39C12',
  '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'
];

function getNextColor(index) {
  return SPACE_COLORS[index % SPACE_COLORS.length];
}

/**
 * Normalize a URL for comparison purposes.
 * Strips trailing slashes, fragments, and normalizes the origin.
 */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '') + u.search;
  } catch {
    return url;
  }
}
