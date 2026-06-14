# Arc Spaces for Edge

A Microsoft Edge extension that brings Arc browser-style **Spaces** with persistent, revertable tabs.

## Features

- **Spaces** — Create multiple workspaces, each with their own set of tabs
- **Pinned Tabs** — Pin tabs to a space so they persist across sessions
- **Revertable Tabs** — Pinned tabs remember their original URL; revert anytime with one click
- **Keyboard Shortcuts** — `Ctrl+Shift+→` / `Ctrl+Shift+←` to switch spaces
- **Sidebar Panel** — Full space management in Edge's sidebar
- **Visual Organization** — Color-coded spaces for quick identification

## Installation (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/tquinn86/arc-spaces-edge.git
   ```

2. Open Edge and navigate to `edge://extensions/`

3. Enable **Developer mode** (toggle in the bottom-left)

4. Click **Load unpacked** and select the `arc-spaces-edge` folder

5. The extension icon will appear in your toolbar

## Usage

### Creating Spaces
- Click the extension icon → Open Sidebar Panel
- Click the **+** button to create a new space
- Give it a name and color

### Switching Spaces
- Click a space tab in the sidebar, or
- Use `Ctrl+Shift+→` / `Ctrl+Shift+←`, or
- Click the extension popup and select a space

### Pinning Tabs
- Navigate to any page
- In the sidebar, click the 📌 button to pin the current tab
- Pinned tabs persist when you switch spaces and come back

### Reverting Tabs
- If a pinned tab has navigated away from its original URL, a ↺ button appears
- Click it to navigate back to the original saved URL

## Architecture

```
src/
├── background/
│   └── service-worker.js    # Extension lifecycle, tab management, message handling
├── sidebar/
│   ├── sidebar.html         # Sidebar panel UI
│   ├── sidebar.css          # Sidebar styles
│   └── sidebar.js           # Sidebar logic
├── popup/
│   ├── popup.html           # Quick-switch popup
│   └── popup.js             # Popup logic
├── utils/
│   └── storage.js           # Chrome storage abstraction
└── icons/                   # Extension icons
```

## How It Works

When you switch spaces:
1. Current open tabs are saved to the active space's state
2. All non-pinned browser tabs are closed
3. The target space's pinned + open tabs are restored
4. The active space marker is updated

Pinned tabs store both their current URL and their **original URL** (when first pinned). This enables the "revert" feature — you can always go back to the page you originally saved.

## Development

This is a Manifest V3 extension using vanilla JavaScript (no build step required).

To reload after changes:
1. Go to `edge://extensions/`
2. Click the refresh icon on the extension card

## License

MIT
