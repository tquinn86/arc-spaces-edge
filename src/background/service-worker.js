import {
  getSpaces,
  saveSpaces,
  getActiveSpaceId,
  setActiveSpaceId,
  getActiveSpace,
  createSpace,
  deleteSpace,
  pinTab,
  unpinTab,
  revertTab,
  normalizeUrl,
  getTabTimestamps,
  saveTabTimestamps,
  trackTab,
  untrackTab,
  getSettings,
  saveSettings
} from '../utils/storage.js';

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async () => {
  // Ensure default space exists (don't clobber existing data)
  const spaces = await getSpaces();
  const activeId = await getActiveSpaceId();
  if (!activeId) {
    await setActiveSpaceId('default');
  }

  // Set up side panel
  chrome.sidePanel.setOptions({
    enabled: true
  });

  // Set up auto-close alarm (checks every 15 minutes)
  chrome.alarms.create('auto-close-stale-tabs', { periodInMinutes: 15 });

  // Track all currently open tabs
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await trackTab(tab.id);
  }
});

// On browser startup: restore pinned tabs for the active space
chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create('auto-close-stale-tabs', { periodInMinutes: 15 });

  const activeSpace = await getActiveSpace();
  if (!activeSpace || activeSpace.pinnedTabs.length === 0) return;

  // Check what's already open (Edge may restore previous session)
  const existingTabs = await chrome.tabs.query({ currentWindow: true });
  const existingUrls = new Set(existingTabs.map(t => normalizeUrl(t.url)));

  // Open any pinned tabs that aren't already open
  for (const pin of activeSpace.pinnedTabs) {
    if (!existingUrls.has(normalizeUrl(pin.url))) {
      await chrome.tabs.create({ url: pin.url, active: false });
    }
  }
});

// Auto-close stale tabs
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'auto-close-stale-tabs') return;

  const settings = await getSettings();
  if (!settings.autoCloseEnabled) return;

  const maxAge = settings.autoCloseHours * 60 * 60 * 1000;
  const now = Date.now();
  const timestamps = await getTabTimestamps();
  const activeSpace = await getActiveSpace();
  const pinnedUrls = new Set((activeSpace?.pinnedTabs || []).map(t => t.url));

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToClose = [];

  for (const tab of tabs) {
    // Skip browser-pinned tabs and extension pages
    if (tab.pinned) continue;
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) continue;

    // Skip tabs that are pinned in the active space
    if (pinnedUrls.has(tab.url)) continue;

    const openedAt = timestamps[tab.id];
    if (openedAt && (now - openedAt) >= maxAge) {
      tabsToClose.push(tab.id);
    }
  }

  if (tabsToClose.length > 0) {
    // Ensure we don't close ALL tabs
    const remainingCount = tabs.length - tabsToClose.length;
    if (remainingCount < 1) {
      await chrome.tabs.create({ url: 'chrome://newtab' });
    }
    await chrome.tabs.remove(tabsToClose);

    // Clean up timestamps
    for (const id of tabsToClose) {
      delete timestamps[id];
    }
    await saveTabTimestamps(timestamps);
  }
});

// Track new tabs
chrome.tabs.onCreated.addListener(async (tab) => {
  await trackTab(tab.id);
  notifySidebar('TABS_CHANGED');
});

// Clean up closed tabs
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await untrackTab(tabId);
  notifySidebar('TABS_CHANGED');
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const spaces = await getSpaces();
  const activeId = await getActiveSpaceId();
  const currentIndex = spaces.findIndex(s => s.id === activeId);

  let nextIndex;
  if (command === 'switch-space-next') {
    nextIndex = (currentIndex + 1) % spaces.length;
  } else if (command === 'switch-space-prev') {
    nextIndex = (currentIndex - 1 + spaces.length) % spaces.length;
  }

  if (nextIndex !== undefined) {
    await switchToSpace(spaces[nextIndex].id);
  }
});

// Listen for messages from popup/sidebar
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_SPACES':
      return { spaces: await getSpaces(), activeSpaceId: await getActiveSpaceId() };

    case 'SWITCH_SPACE':
      await switchToSpace(message.spaceId);
      return { success: true };

    case 'CREATE_SPACE':
      const newSpace = await createSpace(message.name, message.color);
      return { space: newSpace };

    case 'DELETE_SPACE':
      await deleteSpace(message.spaceId);
      return { success: true };

    case 'PIN_TAB':
      const pinnedTab = await pinTab(message.spaceId, message.url, message.title);
      return { pinnedTab };

    case 'UNPIN_TAB':
      await unpinTab(message.spaceId, message.pinId);
      return { success: true };

    case 'REVERT_TAB':
      const revertedTab = await revertTab(message.spaceId, message.pinId);
      // Navigate the actual browser tab back to original URL
      const tabs = await chrome.tabs.query({ url: message.currentUrl });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url: revertedTab.originalUrl });
      }
      return { tab: revertedTab };

    case 'UPDATE_PINNED_TAB_URL':
      await updatePinnedTabCurrentUrl(message.spaceId, message.pinId, message.url);
      return { success: true };

    case 'GET_SETTINGS':
      return { settings: await getSettings() };

    case 'SAVE_SETTINGS':
      await saveSettings(message.settings);
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * Switch to a different space:
 * 1. Save current open tabs to current space
 * 2. Close current non-pinned tabs
 * 3. Restore target space's tabs
 */
async function switchToSpace(targetSpaceId) {
  const spaces = await getSpaces();
  const activeId = await getActiveSpaceId();

  if (activeId === targetSpaceId) return;

  const currentSpace = spaces.find(s => s.id === activeId);
  const targetSpace = spaces.find(s => s.id === targetSpaceId);

  if (!targetSpace) throw new Error(`Space ${targetSpaceId} not found`);

  // Save current open tabs (exclude tabs that match pinned URLs)
  const currentTabs = await chrome.tabs.query({ currentWindow: true });
  if (currentSpace) {
    const pinnedNormalized = new Set(currentSpace.pinnedTabs.map(t => normalizeUrl(t.url)));
    currentSpace.openTabs = currentTabs
      .filter(t => !t.pinned && !pinnedNormalized.has(normalizeUrl(t.url)))
      .map(t => ({ url: t.url, title: t.title }));
    await saveSpaces(spaces);
  }

  // Close all non-pinned tabs in current window
  const tabsToClose = currentTabs.filter(t => !t.pinned).map(t => t.id);

  // Open target space's pinned tabs + previously open tabs (deduplicated)
  const targetPinnedUrls = targetSpace.pinnedTabs.map(t => t.url);
  const openUrls = targetSpace.openTabs.map(t => t.url);
  const pinnedNormSet = new Set(targetPinnedUrls.map(u => normalizeUrl(u)));
  const dedupedOpenUrls = openUrls.filter(u => !pinnedNormSet.has(normalizeUrl(u)));
  const allUrls = [...targetPinnedUrls, ...dedupedOpenUrls];

  // Clear restored open tabs (they're ephemeral, not permanent like pinned)
  targetSpace.openTabs = [];
  await saveSpaces(spaces);

  // Ensure at least one tab exists before closing others
  if (allUrls.length > 0) {
    // Create new tabs first
    for (const url of allUrls) {
      await chrome.tabs.create({ url, active: false });
    }
    // Then close old tabs
    if (tabsToClose.length > 0) {
      await chrome.tabs.remove(tabsToClose);
    }
  } else {
    // Create a new tab if space is empty
    await chrome.tabs.create({ url: 'chrome://newtab' });
    if (tabsToClose.length > 0) {
      await chrome.tabs.remove(tabsToClose);
    }
  }

  // Activate first tab
  const newTabs = await chrome.tabs.query({ currentWindow: true });
  if (newTabs.length > 0) {
    await chrome.tabs.update(newTabs[0].id, { active: true });
  }

  // Update active space
  await setActiveSpaceId(targetSpaceId);

  // Notify UI to refresh
  chrome.runtime.sendMessage({ type: 'SPACE_SWITCHED', spaceId: targetSpaceId }).catch(() => {});
}

async function updatePinnedTabCurrentUrl(spaceId, pinId, url) {
  const spaces = await getSpaces();
  const space = spaces.find(s => s.id === spaceId);
  if (!space) return;
  const tab = space.pinnedTabs.find(t => t.id === pinId);
  if (!tab) return;
  tab.url = url;
  await saveSpaces(spaces);
}

// Track tab URL changes for pinned tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.title) {
    notifySidebar('TABS_CHANGED');
  }
});

/** Send a message to the sidebar (best-effort, no error if sidebar is closed). */
function notifySidebar(type, data = {}) {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
}
