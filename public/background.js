// Toolbar button: open the calendar in a tab (or focus it if already open).
const api = typeof browser !== 'undefined' ? browser : chrome;
api.action.onClicked.addListener(async () => {
  const url = api.runtime.getURL('calendar.html');
  const tabs = await api.tabs.query({ url });
  if (tabs.length) { await api.tabs.update(tabs[0].id, { active: true }); await api.windows.update(tabs[0].windowId, { focused: true }); }
  else await api.tabs.create({ url });
});

