const spaceList = document.getElementById('space-list');
const openSidebarBtn = document.getElementById('open-sidebar');

document.addEventListener('DOMContentLoaded', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SPACES' });
  renderSpaces(response.spaces, response.activeSpaceId);
});

function renderSpaces(spaces, activeSpaceId) {
  spaceList.innerHTML = '';
  spaces.forEach(space => {
    const li = document.createElement('li');
    li.className = `space-item ${space.id === activeSpaceId ? 'active' : ''}`;

    const dot = document.createElement('div');
    dot.className = 'space-dot';
    dot.style.background = space.color;

    const name = document.createElement('span');
    name.className = 'space-name';
    name.textContent = space.name;

    const count = document.createElement('span');
    count.className = 'space-count';
    const tabCount = space.pinnedTabs.length + space.openTabs.length;
    count.textContent = `${tabCount} tab${tabCount !== 1 ? 's' : ''}`;

    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(count);

    li.addEventListener('click', async () => {
      if (space.id === activeSpaceId) return;
      await chrome.runtime.sendMessage({ type: 'SWITCH_SPACE', spaceId: space.id });
      window.close();
    });

    spaceList.appendChild(li);
  });
}

openSidebarBtn.addEventListener('click', async () => {
  await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
  window.close();
});
