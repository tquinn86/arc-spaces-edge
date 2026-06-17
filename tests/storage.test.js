import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import './chrome-mock.js';
import {
  getSpaces,
  saveSpaces,
  getActiveSpaceId,
  setActiveSpaceId,
  createSpace,
  pinTab,
  unpinTab,
  getActiveSpace,
  _resetForTest
} from '../src/utils/storage.js';

beforeEach(() => {
  chrome._test.reset();
  _resetForTest();
});

describe('storage', () => {
  test('getSpaces returns default space when empty', async () => {
    const spaces = await getSpaces();
    expect(spaces).toHaveLength(1);
    expect(spaces[0].id).toBe('default');
    expect(spaces[0].name).toBe('Personal');
    expect(spaces[0].pinnedTabs).toEqual([]);
  });

  test('createSpace adds a new space', async () => {
    await getSpaces(); // init default
    const space = await createSpace('Work', '#E74C3C');
    expect(space.name).toBe('Work');
    expect(space.color).toBe('#E74C3C');
    expect(space.pinnedTabs).toEqual([]);

    const spaces = await getSpaces();
    expect(spaces).toHaveLength(2);
  });

  test('pinTab adds a pinned tab with originalUrl', async () => {
    const pin = await pinTab('default', 'https://github.com', 'GitHub');
    expect(pin.url).toBe('https://github.com');
    expect(pin.originalUrl).toBe('https://github.com');

    const spaces = await getSpaces();
    expect(spaces[0].pinnedTabs).toHaveLength(1);
  });

  test('pinTab survives storage round-trip', async () => {
    await pinTab('default', 'https://github.com', 'GitHub');
    await pinTab('default', 'https://google.com', 'Google');

    // Simulate fresh read (like after browser restart)
    const spaces = await getSpaces();
    expect(spaces[0].pinnedTabs).toHaveLength(2);
    expect(spaces[0].pinnedTabs[0].url).toBe('https://github.com');
    expect(spaces[0].pinnedTabs[1].url).toBe('https://google.com');
  });

  test('unpinTab removes only the specified pin', async () => {
    const pin1 = await pinTab('default', 'https://github.com', 'GitHub');
    const pin2 = await pinTab('default', 'https://google.com', 'Google');

    await unpinTab('default', pin1.id);

    const spaces = await getSpaces();
    expect(spaces[0].pinnedTabs).toHaveLength(1);
    expect(spaces[0].pinnedTabs[0].id).toBe(pin2.id);
  });
});
