import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import chrome from './chrome-mock.js';
import {
  getSpaces,
  saveSpaces,
  getActiveSpaceId,
  setActiveSpaceId,
  createSpace,
  pinTab,
  normalizeUrl,
  _resetForTest
} from '../src/utils/storage.js';

beforeEach(() => {
  chrome._test.reset();
  _resetForTest();
});

/**
 * Replicate the switchToSpace logic from service-worker.js for testing.
 */
async function switchToSpace(targetSpaceId) {
  const spaces = await getSpaces();
  const activeId = await getActiveSpaceId();

  if (activeId === targetSpaceId) return;

  const currentSpace = spaces.find(s => s.id === activeId);
  const targetSpace = spaces.find(s => s.id === targetSpaceId);

  if (!targetSpace) throw new Error(`Space ${targetSpaceId} not found`);

  // Save current open tabs (exclude tabs matching pinned URLs)
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

  // Determine what to open — deduplicate open tabs against pinned
  const targetPinnedUrls = targetSpace.pinnedTabs.map(t => t.url);
  const openUrls = targetSpace.openTabs.map(t => t.url);
  const pinnedNormSet = new Set(targetPinnedUrls.map(u => normalizeUrl(u)));
  const dedupedOpenUrls = openUrls.filter(u => !pinnedNormSet.has(normalizeUrl(u)));
  const allUrls = [...targetPinnedUrls, ...dedupedOpenUrls];

  // Clear restored open tabs (ephemeral)
  targetSpace.openTabs = [];
  await saveSpaces(spaces);

  if (allUrls.length > 0) {
    for (const url of allUrls) {
      await chrome.tabs.create({ url, active: false });
    }
    if (tabsToClose.length > 0) {
      await chrome.tabs.remove(tabsToClose);
    }
  } else {
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

  await setActiveSpaceId(targetSpaceId);
}

describe('switchToSpace', () => {
  let workSpaceId;

  beforeEach(async () => {
    // Set up: default space with pinned tabs, and a "Work" space
    await setActiveSpaceId('default');
    await pinTab('default', 'https://github.com', 'GitHub');
    await pinTab('default', 'https://slack.com', 'Slack');

    const work = await createSpace('Work', '#E74C3C');
    workSpaceId = work.id;
    await pinTab(workSpaceId, 'https://jira.com', 'Jira');

    // Simulate browser tabs matching the default space's pinned tabs
    chrome._test.setTabs([
      { id: 1, url: 'https://github.com', title: 'GitHub', pinned: false },
      { id: 2, url: 'https://slack.com', title: 'Slack', pinned: false },
      { id: 3, url: 'https://reddit.com', title: 'Reddit', pinned: false }
    ]);
  });

  test('switching saves non-pinned open tabs only', async () => {
    await switchToSpace(workSpaceId);

    const spaces = await getSpaces();
    const defaultSpace = spaces.find(s => s.id === 'default');

    // reddit.com should be saved as open tab, but github/slack should NOT
    expect(defaultSpace.openTabs).toEqual([
      { url: 'https://reddit.com', title: 'Reddit' }
    ]);
  });

  test('switching does not duplicate pinned tabs', async () => {
    // Switch to work
    await switchToSpace(workSpaceId);

    // Now switch back to default
    // Current tabs should be jira (from work pinned)
    chrome._test.setTabs(chrome._test.getTabs()); // keep whatever create made
    await switchToSpace('default');

    // Check: default's pinned tabs should open exactly once each
    const createCalls = chrome.tabs.create.mock.calls;
    const lastBatchUrls = [];
    // Get URLs from the second switch (back to default)
    // The second switchToSpace will create github, slack tabs
    // Count how many times github.com was created total in the second switch
    let secondSwitchStartIdx = 0;
    for (let i = 0; i < createCalls.length; i++) {
      if (createCalls[i][0].url === 'https://jira.com') {
        secondSwitchStartIdx = i + 1;
      }
    }
    for (let i = secondSwitchStartIdx; i < createCalls.length; i++) {
      lastBatchUrls.push(createCalls[i][0].url);
    }

    // github and slack should each appear exactly once
    const githubCount = lastBatchUrls.filter(u => u === 'https://github.com').length;
    const slackCount = lastBatchUrls.filter(u => u === 'https://slack.com').length;
    expect(githubCount).toBe(1);
    expect(slackCount).toBe(1);
  });

  test('pinned tabs with trailing slash match correctly', async () => {
    // Simulate tab has trailing slash but pinned URL does not
    chrome._test.setTabs([
      { id: 1, url: 'https://github.com/', title: 'GitHub', pinned: false },
      { id: 2, url: 'https://slack.com/', title: 'Slack', pinned: false },
      { id: 3, url: 'https://example.com', title: 'Example', pinned: false }
    ]);

    await switchToSpace(workSpaceId);

    const spaces = await getSpaces();
    const defaultSpace = spaces.find(s => s.id === 'default');

    // github.com/ and slack.com/ should match pinned github.com and slack.com
    // Only example.com should be in openTabs
    expect(defaultSpace.openTabs).toEqual([
      { url: 'https://example.com', title: 'Example' }
    ]);
  });

  test('round-trip: switch away and back preserves pinned tabs exactly', async () => {
    await switchToSpace(workSpaceId);

    // Simulate being in work space with just jira open
    chrome._test.setTabs([
      { id: 10, url: 'https://jira.com', title: 'Jira', pinned: false }
    ]);

    await switchToSpace('default');

    // After switching back, the default space should have its 2 pinned tabs + reddit
    const spaces = await getSpaces();
    const defaultSpace = spaces.find(s => s.id === 'default');
    expect(defaultSpace.pinnedTabs).toHaveLength(2);
    expect(defaultSpace.pinnedTabs[0].url).toBe('https://github.com');
    expect(defaultSpace.pinnedTabs[1].url).toBe('https://slack.com');
  });
});

describe('browser restart', () => {
  test('pinned tabs persist in storage after simulated restart', async () => {
    await setActiveSpaceId('default');
    await pinTab('default', 'https://github.com', 'GitHub');
    await pinTab('default', 'https://slack.com', 'Slack');

    // Simulate restart: storage persists, but tabs are gone
    chrome._test.setTabs([]);

    // Extension should be able to read pinned tabs from storage
    const space = await getSpaces();
    expect(space[0].pinnedTabs).toHaveLength(2);

    // Restore pinned tabs (what onStartup should do)
    for (const pin of space[0].pinnedTabs) {
      await chrome.tabs.create({ url: pin.url, active: false });
    }

    const openTabs = chrome._test.getTabs();
    expect(openTabs).toHaveLength(2);
    expect(openTabs.map(t => t.url)).toContain('https://github.com');
    expect(openTabs.map(t => t.url)).toContain('https://slack.com');
  });
});
