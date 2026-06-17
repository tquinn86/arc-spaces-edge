/**
 * Mock for chrome.* APIs used by the extension.
 * Uses a state object so reset can reliably clear state via mutation.
 */
import { jest } from '@jest/globals';

const state = {
  storage: {},
  tabs: [],
  nextTabId: 1,
  alarms: {}
};

const chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        if (typeof keys === 'string') {
          return { [keys]: state.storage[keys] };
        }
        const result = {};
        for (const key of keys) {
          result[key] = state.storage[key];
        }
        return result;
      }),
      set: jest.fn(async (data) => {
        Object.assign(state.storage, data);
      })
    }
  },
  tabs: {
    query: jest.fn(async () => [...state.tabs]),
    create: jest.fn(async (opts) => {
      const tab = {
        id: state.nextTabId++,
        url: opts.url || 'chrome://newtab',
        title: opts.title || opts.url || 'New Tab',
        pinned: opts.pinned || false,
        active: opts.active !== false
      };
      state.tabs.push(tab);
      return tab;
    }),
    remove: jest.fn(async (tabIds) => {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      state.tabs = state.tabs.filter(t => !ids.includes(t.id));
    }),
    update: jest.fn(async (tabId, props) => {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) Object.assign(tab, props);
      return tab;
    }),
    onCreated: { addListener: jest.fn() },
    onRemoved: { addListener: jest.fn() },
    onUpdated: { addListener: jest.fn() }
  },
  alarms: {
    create: jest.fn((name, opts) => { state.alarms[name] = opts; }),
    onAlarm: { addListener: jest.fn() }
  },
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(async () => {})
  },
  sidePanel: {
    setOptions: jest.fn(),
    open: jest.fn()
  },
  commands: {
    onCommand: { addListener: jest.fn() }
  },
  windows: {
    getCurrent: jest.fn(async () => ({ id: 1 }))
  }
};

// Helpers for tests
chrome._test = {
  reset() {
    // Mutate in place rather than reassign — ESM closures may cache references
    for (const key of Object.keys(state.storage)) delete state.storage[key];
    state.tabs.length = 0;
    state.nextTabId = 1;
    for (const key of Object.keys(state.alarms)) delete state.alarms[key];

    // Also re-bind get/set implementations to guarantee fresh closure
    chrome.storage.local.get.mockImplementation(async (keys) => {
      if (typeof keys === 'string') {
        return { [keys]: state.storage[keys] };
      }
      const result = {};
      for (const key of keys) {
        result[key] = state.storage[key];
      }
      return result;
    });
    chrome.storage.local.set.mockImplementation(async (data) => {
      Object.assign(state.storage, data);
    });
    chrome.tabs.query.mockImplementation(async () => [...state.tabs]);
    chrome.tabs.create.mockImplementation(async (opts) => {
      const tab = {
        id: state.nextTabId++,
        url: opts.url || 'chrome://newtab',
        title: opts.title || opts.url || 'New Tab',
        pinned: opts.pinned || false,
        active: opts.active !== false
      };
      state.tabs.push(tab);
      return tab;
    });
    chrome.tabs.remove.mockImplementation(async (tabIds) => {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      state.tabs = state.tabs.filter(t => !ids.includes(t.id));
    });

    chrome.tabs.create.mockClear();
    chrome.tabs.remove.mockClear();
    chrome.tabs.query.mockClear();
    chrome.tabs.update.mockClear();
    chrome.storage.local.get.mockClear();
    chrome.storage.local.set.mockClear();
    chrome.runtime.sendMessage.mockClear();
  },
  getStorage() { return state.storage; },
  setStorage(data) { state.storage = data; },
  getTabs() { return state.tabs; },
  setTabs(t) { state.tabs = t; state.nextTabId = Math.max(...t.map(x => x.id), 0) + 1; },
  getAlarms() { return state.alarms; }
};

globalThis.chrome = chrome;

export default chrome;
