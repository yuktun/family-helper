import {
  MTR_LINES,
  MTR_ORDER,
  addPreference,
  changePreference,
  createCatalogCache,
  fetchCtbStops,
  fetchCtbRouteStops,
  fetchCtbRoutes,
  fetchCtbStopEtas,
  fetchGmbRouteStopCatalog,
  fetchGmbStopEtas,
  fetchKmbRouteEtas,
  fetchKmbRouteStops,
  fetchKmbRoutes,
  fetchKmbStopEtas,
  fetchKmbStops,
  fetchMtrSchedule,
  groupArrivals,
  gmbRouteCatalog as createGmbRouteCatalog,
  mtrStationName,
  nearbyStops,
  normalizePreference,
  parseCompactCatalogText,
  removePreference,
  reorderPreference,
  searchMtr,
  searchRoutes,
  searchStops,
  validFutureArrivals,
} from './transport/index.js';

const MAX_ITEMS = 12;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const attr = esc;
const operatorLabel = (operator) => ({ KMB: '九巴', LWB: '龍運', CTB: '城巴', GMB: '專線小巴', MTR: '港鐵' })[operator] || operator;
const emptyPreferences = () => ({ schemaVersion: 1, revision: 0, interval: 30, showOnHome: true, routes: [], stops: [], mtr: [] });
const allItems = (prefs) => [...prefs.routes, ...prefs.stops, ...prefs.mtr].sort((a, b) => a.order - b.order);
const itemKind = (item) => item.kind || (item.operator === 'MTR' ? 'mtr' : item.route ? 'route' : 'stop');
const debounce = (fn, wait = 260) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; };

function normalizeCloud(data) {
  if (!data) return emptyPreferences();
  const routes = (Array.isArray(data.routes) ? data.routes : []).map((item, order) => ({ ...normalizePreference({ ...item, kind: 'route' }), order: Number.isInteger(item.order) ? item.order : order }));
  const stops = (Array.isArray(data.stops) ? data.stops : []).map((item, order) => ({ ...normalizePreference({ ...item, name: item.stopName, kind: 'stop' }), stopName: item.stopName || item.name || '', routes: Array.isArray(item.routes) ? item.routes.filter((x) => typeof x === 'string').slice(0, 30) : [], order: Number.isInteger(item.order) ? item.order : routes.length + order }));
  const mtr = (Array.isArray(data.mtr) ? data.mtr : []).map((item, order) => ({ ...normalizePreference({ ...item, kind: 'mtr' }), order: Number.isInteger(item.order) ? item.order : routes.length + stops.length + order }));
  return {
    schemaVersion: 1,
    revision: Number.isInteger(data.revision) ? data.revision : 0,
    interval: [0, 15, 30, 60].includes(data.interval) ? data.interval : 30,
    showOnHome: data.showOnHome !== false,
    routes,
    stops,
    mtr,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function prepareCloud(prefs) {
  const order = new Map(allItems(prefs).map((item, index) => [item.id, index]));
  return {
    schemaVersion: 1,
    revision: prefs.revision,
    interval: prefs.interval,
    showOnHome: prefs.showOnHome,
    routes: prefs.routes.map((item) => ({ id: item.id, operator: item.operator, route: item.route, direction: item.direction, serviceType: item.serviceType || '1', stopId: item.stopId, stopName: item.stopName || '', destination: item.destination || '', order: order.get(item.id) ?? 0, ...(item.routeId ? { routeId: String(item.routeId) } : {}) })),
    stops: prefs.stops.map((item) => ({ id: item.id, operator: item.operator, stopId: item.stopId, stopName: item.stopName || item.name || '', routes: item.routes || [], order: order.get(item.id) ?? 0 })),
    mtr: prefs.mtr.map((item) => ({ id: item.id, line: item.line, station: item.station, direction: item.direction, destination: item.destination || '', order: order.get(item.id) ?? 0 })),
  };
}

export function createTransportController({ subscribe, mutate, legacyRoutes, privateAllowed, showToast, switchPage }) {
  let uid = null;
  let approved = false;
  let prefs = emptyPreferences();
  let unsubscribe = null;
  let authGeneration = 0;
  let savePending = false;
  let activeTab = 'mine';
  let refreshTimer = null;
  let refreshGeneration = 0;
  let results = new Map();
  let lastSuccess = null;
  let kmbStops = [];
  let ctbStops = [];
  let gmbStops = [];
  let routeCatalogs = { KMB: [], CTB: [], GMB: [] };
  let gmbRouteCatalog = new Map();
  let staticCatalogLoaded = false;
  let stopFilterId = null;
  let editingPreferenceId = null;
  const cache = createCatalogCache(localStorage);

  const byId = (id) => document.getElementById(id);
  const settingDialog = () => byId('transport-settings-dialog');
  const addDialog = () => byId('transport-add-dialog');

  function bind() {
    byId('open-transport').addEventListener('click', () => openTransport());
    byId('refresh-bus').addEventListener('click', () => refresh({ force: true }));
    byId('refresh-transport').addEventListener('click', () => refresh({ force: true }));
    byId('transport-back-home').addEventListener('click', () => switchPage('home'));
    byId('transport-open-settings').addEventListener('click', openSettings);
    byId('manage-transport').addEventListener('click', openSettings);
    byId('add-transport-favourite').addEventListener('click', openAddDialog);
    byId('transport-interval').addEventListener('change', (event) => updateConfig((next) => ({ ...next, interval: Number(event.target.value) })));
    byId('transport-show-home').addEventListener('change', (event) => updateConfig((next) => ({ ...next, showOnHome: event.target.checked })));
    byId('import-legacy-routes').addEventListener('click', importLegacyRoutes);
    byId('export-transport').addEventListener('click', exportPersonalSettings);
    byId('import-transport').addEventListener('change', importPersonalSettings);
    document.querySelectorAll('[data-transport-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.transportTab)));
    document.querySelectorAll('[data-add-mode]').forEach((button) => button.addEventListener('click', () => setAddMode(button.dataset.addMode)));
    byId('transport-route-query').addEventListener('input', debounce(searchRouteInput));
    byId('transport-route-operator').addEventListener('change', () => searchRouteInput());
    byId('transport-stop-query').addEventListener('input', debounce(searchStopInput));
    byId('transport-stop-operator').addEventListener('change', () => searchStopInput());
    byId('transport-add-stop-id').addEventListener('click', addDirectStop);
    byId('transport-mtr-query').addEventListener('input', renderMtrSearch);
    byId('transport-mtr-line').addEventListener('change', renderMtrStations);
    byId('transport-add-mtr').addEventListener('click', addMtr);
    byId('locate-nearby').addEventListener('click', locateNearby);
    byId('manual-nearby').addEventListener('click', () => { byId('nearby-search-label').hidden = false; byId('nearby-search').focus(); });
    byId('nearby-search').addEventListener('input', debounce(searchNearbyReference));
    byId('clear-stop-filter').addEventListener('click', () => saveStopFilter([]));
    byId('save-stop-filter').addEventListener('click', () => saveStopFilter([...document.querySelectorAll('#transport-stop-filter-list input:checked')].map((x) => x.value)));
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('online', () => refresh({ force: true }));
    renderMtrLines();
    render();
  }

  function setIdentity(user, isApproved) {
    authGeneration += 1;
    uid = user?.uid || null;
    approved = Boolean(uid && isApproved);
    unsubscribe?.();
    unsubscribe = null;
    prefs = emptyPreferences();
    results = new Map();
    lastSuccess = null;
    clearTimeout(refreshTimer);
    render();
    if (!approved) return;
    const generation = authGeneration;
    unsubscribe = subscribe(uid, (data) => {
      if (generation !== authGeneration || uid !== user.uid) return;
      prefs = normalizeCloud(data);
      render();
      refresh({ force: true });
    }, () => {
      if (generation !== authGeneration) return;
      showToast('未能同步個人交通設定');
      render();
    });
  }

  function setShowOnHome(value) { return updateConfig((next) => ({ ...next, showOnHome: Boolean(value) })); }
  function getShowOnHome() { return approved ? prefs.showOnHome : true; }

  async function updateConfig(change) {
    if (!approved || savePending) return showToast('請先登入已批准的家庭帳戶');
    const before = prefs;
    savePending = true;
    setSaving(true);
    try {
      const saved = await mutate(uid, (remote) => prepareCloud(change(normalizeCloud(remote))));
      if (uid) prefs = normalizeCloud(saved);
      render();
    } catch (error) {
      prefs = before;
      console.warn('Transport preference save failed', error?.code || error?.message);
      showToast('交通設定未能儲存，已保留原有設定');
      render();
    } finally {
      savePending = false;
      setSaving(false);
    }
  }

  function setSaving(value) { settingDialog()?.classList.toggle('transport-saving', value); }
  function openTransport() { switchPage('transport'); setTab('mine'); refresh({ force: true }); }
  function openSettings() { renderSettings(); settingDialog().showModal(); }
  function setPage(page) { if (page === 'transport') refresh(); else schedule(); }
  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('[data-transport-tab]').forEach((button) => { const active = button.dataset.transportTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('[data-transport-panel]').forEach((panel) => { panel.hidden = panel.dataset.transportPanel !== tab; });
    if (tab === 'nearby') ensureCatalog('KMB');
    schedule();
  }

  function render() {
    renderHome();
    renderFull();
    renderSettings();
    schedule();
  }

  function renderHome() {
    const card = document.querySelector('[data-home-module="transport"]');
    if (!card) return;
    card.hidden = approved && (!prefs.showOnHome || document.querySelector('[data-module-toggle="transport"]')?.checked === false);
    const holder = byId('bus-list');
    const subtitle = byId('transport-home-subtitle');
    if (!approved) {
      subtitle.textContent = uid ? '等待家庭管理員批准' : '登入後顯示你的交通收藏';
      holder.innerHTML = transportEmpty('🔒', uid ? '等待批准後顯示' : '登入後顯示個人交通', '交通收藏不會與其他家庭成員共用');
      setStatus('等待登入', 'loading');
      return;
    }
    const items = allItems(prefs).slice(0, 3);
    subtitle.textContent = items.length ? `顯示 ${items.length} 個常用收藏` : '未有個人交通收藏';
    holder.innerHTML = items.length ? items.map(renderResultCard).join('') : transportEmpty('🚌', '尚未加入常用交通', '<button type="button" data-add-from-home>新增交通收藏</button>');
    holder.querySelector('[data-add-from-home]')?.addEventListener('click', openSettings);
    const status = lastSuccess ? `最後更新：${timeLabel(lastSuccess)}` : '尚未更新';
    setStatus(status, results.size ? '' : 'loading');
  }

  function renderFull() {
    const holder = byId('transport-full-list');
    if (!approved) {
      holder.innerHTML = transportEmpty('🔒', uid ? '帳戶尚未獲批准' : '請先登入家庭帳戶', '個人交通收藏只供本人使用');
      return;
    }
    const items = allItems(prefs);
    holder.innerHTML = items.length ? items.map((item) => `<article class="card transport-group">${renderDetailedResult(item)}</article>`).join('') : transportEmpty('🚌', '尚未加入常用交通', '<button class="primary-button" type="button" data-empty-settings>新增交通收藏</button>');
    holder.querySelector('[data-empty-settings]')?.addEventListener('click', openSettings);
    byId('transport-status').textContent = lastSuccess ? `最後成功更新：${timeLabel(lastSuccess)}` : '按「更新」取得即時資料';
  }

  function renderResultCard(item) {
    const result = results.get(item.id);
    const badge = item.kind === 'mtr' ? item.line : item.kind === 'route' ? item.route : '車站';
    const detail = item.kind === 'mtr' ? `${mtrStationName(item.station)} · ${item.direction}` : item.kind === 'route' ? `${item.destination || item.direction} · ${item.stopName || item.stopId}` : `${item.stopName || item.name || item.stopId}`;
    const arrivals = arrivalPills(result);
    return `<div class="bus-row"><span class="route-badge ${item.operator?.toLowerCase() || ''}">${esc(badge)}</span><div class="route-destination"><strong>${esc(detail)}</strong><small>${esc(operatorLabel(item.operator))}</small></div>${arrivals}</div>`;
  }

  function renderDetailedResult(item) {
    const result = results.get(item.id);
    const badge = item.kind === 'mtr' ? item.line : item.kind === 'route' ? item.route : '站';
    const title = item.kind === 'mtr' ? `${mtrStationName(item.station)} · ${item.direction === 'UP' ? '上行' : '下行'}` : item.kind === 'route' ? `${item.route} 往 ${item.destination || '目的地'}` : item.stopName || item.name || item.stopId;
    const sub = item.kind === 'route' ? `${operatorLabel(item.operator)} · ${item.stopName || item.stopId}` : item.kind === 'stop' ? `${operatorLabel(item.operator)} · Stop ID ${item.stopId}` : `${MTR_LINES[item.line]?.zh || item.line} · ${item.direction}`;
    if (item.kind === 'stop' && result?.groups) {
      const groups = result.groups.filter((group) => !(item.routes || []).length || item.routes.includes(group.key));
      return `<div class="transport-group-head"><span class="transport-badge ${item.operator.toLowerCase()}">${esc(badge)}</span><span class="transport-group-title"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span></div>${groups.length ? groups.map((group) => `<div class="transport-route-subgroup"><div class="transport-route-subgroup-head"><strong>${esc(group.route)}</strong><span>${esc(group.destination || '')}</span></div>${arrivalPills({ arrivals: group.arrivals })}</div>`).join('') : '<div class="transport-error">暫無符合篩選的班次</div>'}`;
    }
    return `<div class="transport-group-head"><span class="transport-badge ${item.operator?.toLowerCase() || 'mtr'}">${esc(badge)}</span><span class="transport-group-title"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span></div>${arrivalPills(result)}${result?.error ? `<div class="transport-error">${esc(result.error)}</div>` : ''}`;
  }

  function arrivalPills(result) {
    if (!result) return '<span class="eta-none">等待更新</span>';
    const arrivals = (result.arrivals || []).slice(0, 3);
    if (!arrivals.length) return `<span class="eta-none">${result.error ? '未能更新' : '暫無班次'}</span>`;
    return `<div class="transport-arrivals">${arrivals.map((item) => `<span class="transport-arrival">${etaText(item)}</span>`).join('')}</div>`;
  }

  function renderSettings() {
    const gate = byId('transport-auth-gate');
    const content = byId('transport-settings-content');
    if (!approved) {
      gate.hidden = false;
      gate.innerHTML = `<span class="emoji">🔒</span><strong>${uid ? '等待家庭管理員批准' : '請先登入家庭帳戶'}</strong><span>交通收藏按帳戶獨立儲存。</span>`;
      content.hidden = true;
      byId('transport-settings-summary').textContent = uid ? '帳戶批准後可使用。' : '登入並獲批准後即可設定。';
      return;
    }
    gate.hidden = true;
    content.hidden = false;
    byId('transport-interval').value = String(prefs.interval);
    byId('transport-show-home').checked = prefs.showOnHome;
    const items = allItems(prefs);
    byId('transport-settings-summary').textContent = items.length ? `${prefs.routes.length} 條路線 · ${prefs.stops.length} 個車站 · ${prefs.mtr.length} 個港鐵收藏` : '尚未加入交通收藏。';
    byId('transport-legacy-import').hidden = !legacyRoutes?.().length || items.length > 0;
    const holder = byId('transport-favourite-settings');
    holder.innerHTML = items.length ? items.map((item, index) => settingRow(item, index, items.length)).join('') : '<div class="empty-state"><span class="emoji">🚌</span><strong>尚未加入交通收藏</strong><span>路線、車站和港鐵收藏會同步到你的裝置。</span></div>';
    holder.querySelectorAll('[data-pref-remove]').forEach((button) => button.addEventListener('click', () => removeItem(button.dataset.prefRemove)));
    holder.querySelectorAll('[data-pref-up]').forEach((button) => button.addEventListener('click', () => moveItem(button.dataset.prefUp, -1)));
    holder.querySelectorAll('[data-pref-down]').forEach((button) => button.addEventListener('click', () => moveItem(button.dataset.prefDown, 1)));
    holder.querySelectorAll('[data-pref-edit]').forEach((button) => button.addEventListener('click', () => editItem(button.dataset.prefEdit)));
  }

  function settingRow(item, index, count) {
    const title = item.kind === 'mtr' ? `${MTR_LINES[item.line]?.zh || item.line} · ${mtrStationName(item.station)}` : item.kind === 'route' ? `${operatorLabel(item.operator)} ${item.route}` : `${operatorLabel(item.operator)} · ${item.stopName || item.name || item.stopId}`;
    const note = item.kind === 'mtr' ? `${item.direction === 'UP' ? '上行' : '下行'}${item.destination ? ` · ${item.destination}` : ''}` : item.kind === 'route' ? `往 ${item.destination || '目的地'} · ${item.stopName || item.stopId}` : (item.routes || []).length ? `只顯示 ${(item.routes || []).length} 條路線` : '顯示所有支援路線';
    const editLabel = item.kind === 'stop' ? '篩選' : item.kind === 'route' ? '轉站' : '轉向';
    return `<article class="transport-setting-row"><span class="drag-buttons"><button type="button" data-pref-up="${attr(item.id)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-pref-down="${attr(item.id)}" ${index === count - 1 ? 'disabled' : ''}>↓</button></span><span class="transport-setting-copy"><strong>${esc(title)}</strong><small>${esc(note)}</small></span><span class="transport-setting-actions"><button type="button" data-pref-edit="${attr(item.id)}">${editLabel}</button><button type="button" data-pref-remove="${attr(item.id)}" aria-label="移除">×</button></span></article>`;
  }

  async function removeItem(id) { await updateConfig((remote) => fromUnified(removePreference(toUnified(remote), id), remote)); }
  async function moveItem(id, delta) {
    const unified = toUnified(prefs); const index = unified.items.findIndex((item) => item.id === id);
    await updateConfig((remote) => fromUnified(reorderPreference(toUnified(remote), id, index + delta), remote));
  }
  function editItem(id) {
    const item = allItems(prefs).find((x) => x.id === id); if (!item) return;
    if (item.kind === 'mtr') {
      updateConfig((remote) => fromUnified(changePreference(toUnified(remote), item.id, { ...item, direction: item.direction === 'UP' ? 'DOWN' : 'UP' }), remote));
      return;
    }
    if (item.kind === 'route') {
      editingPreferenceId = item.id;
      setAddMode('route');
      byId('transport-route-operator').value = item.operator === 'LWB' ? 'KMB' : item.operator;
      byId('transport-route-query').value = item.route;
      byId('transport-add-status').textContent = '請重新選擇這條路線的上車站。';
      addDialog().showModal();
      searchRouteInput();
      return;
    }
    stopFilterId = id;
    const groups = results.get(id)?.groups || [];
    const options = [...new Map(groups.map((group) => [group.key, group])).values()];
    byId('transport-stop-filter-list').innerHTML = options.length ? options.map((group) => `<label><span><strong>${esc(group.route)}</strong><small>${esc(group.destination || operatorLabel(group.operator))}</small></span><input type="checkbox" value="${attr(group.key)}" ${(item.routes || []).includes(group.key) ? 'checked' : ''}></label>`).join('') : '<p class="dialog-note">請先更新此車站的到站資料。</p>';
    byId('transport-stop-filter-dialog').showModal();
  }
  async function saveStopFilter(routes) {
    const item = prefs.stops.find((x) => x.id === stopFilterId); if (!item) return;
    await updateConfig((remote) => fromUnified(changePreference(toUnified(remote), item.id, { ...item, routes }), remote, { stopRoutes: new Map([[item.id, routes]]) }));
    byId('transport-stop-filter-dialog').close();
  }

  function openAddDialog() { editingPreferenceId = null; setAddMode('route'); byId('transport-add-status').textContent = ''; addDialog().showModal(); ensureCatalog('KMB'); }
  function setAddMode(mode) {
    document.querySelectorAll('[data-add-mode]').forEach((button) => button.classList.toggle('active', button.dataset.addMode === mode));
    document.querySelectorAll('[data-add-panel]').forEach((panel) => { panel.hidden = panel.dataset.addPanel !== mode; });
    if (mode === 'mtr') renderMtrLines();
  }

  async function ensureCatalog(operator) {
    if (operator === 'KMB' || operator === 'LWB') {
      if (!kmbStops.length) {
        const cached = cache.read('kmb-stops', { allowStale: !navigator.onLine });
        kmbStops = cached?.items || await fetchKmbStops().then((items) => { cache.write('kmb-stops', items); return items; });
      }
      if (!routeCatalogs.KMB.length) {
        const cached = cache.read('kmb-routes', { allowStale: !navigator.onLine });
        routeCatalogs.KMB = cached?.items || await fetchKmbRoutes().then((items) => { cache.write('kmb-routes', items); return items; });
      }
    } else if (operator === 'CTB' && !routeCatalogs.CTB.length) {
      await ensureStaticCatalog();
      const cached = cache.read('ctb-routes', { allowStale: !navigator.onLine });
      routeCatalogs.CTB = cached?.items || await fetchCtbRoutes().then((items) => { cache.write('ctb-routes', items); return items; });
      if (!ctbStops.length && navigator.onLine) fetchCtbStops().then((items) => { if (items.length) { ctbStops = items; cache.write('ctb-stops', items); } }).catch(() => {});
    } else if (operator === 'GMB') {
      await ensureStaticCatalog();
    }
  }

  async function ensureStaticCatalog() {
    if (staticCatalogLoaded) return;
    const cached = cache.read('compact-operators', { allowStale: true });
    let catalog = cached?.items?.[0];
    if (!catalog) {
      const response = await fetch('./assets/transport-catalog.json', { cache: 'force-cache' });
      if (!response.ok) throw new Error('transport_catalog_unavailable');
      catalog = parseCompactCatalogText(await response.text());
      cache.write('compact-operators', [catalog]);
    }
    ctbStops = catalog.ctbStops || [];
    gmbStops = catalog.gmbStops || [];
    routeCatalogs.GMB = (catalog.gmbRoutes || []).map((item) => ({ ...item, direction: String(item.routeSequence), serviceType: '1', origin: '', destination: item.destination || '' }));
    gmbRouteCatalog = createGmbRouteCatalog(catalog.gmbRoutes || []);
    staticCatalogLoaded = true;
  }

  async function searchRouteInput() {
    const operator = byId('transport-route-operator').value;
    const query = byId('transport-route-query').value.trim();
    const holder = byId('transport-route-results'); byId('transport-route-stops').innerHTML = '';
    if (!query) return holder.innerHTML = '';
    holder.innerHTML = '<div class="transport-status">搜尋路線中…</div>';
    try {
      await ensureCatalog(operator);
      const source = routeCatalogs[operator] || [];
      const matches = searchRoutes(source, query);
      holder.innerHTML = matches.length ? matches.map((route, index) => `<button type="button" class="transport-search-result" data-route-index="${index}"><strong>${esc(operatorLabel(route.operator || operator))} ${esc(route.route)}</strong><small>${esc(route.origin)} → ${esc(route.destination)} · ${esc(route.direction)}</small></button>`).join('') : '<div class="transport-status">找不到相符路線</div>';
      holder.querySelectorAll('[data-route-index]').forEach((button) => button.addEventListener('click', () => chooseRoute(matches[Number(button.dataset.routeIndex)])));
    } catch { holder.innerHTML = '<div class="transport-error">未能下載路線資料，請稍後重試。</div>'; }
  }

  async function chooseRoute(route) {
    const holder = byId('transport-route-stops'); holder.innerHTML = '<div class="transport-status">載入沿途車站…</div>';
    try {
      let rows = [];
      if (route.operator === 'CTB') rows = await fetchCtbRouteStops(route.route, route.direction);
      else if (route.operator === 'GMB') rows = await fetchGmbRouteStopCatalog({ ...route, routeSequence: route.routeSequence || route.direction });
      else rows = await fetchKmbRouteStops(route.route, route.direction, route.serviceType);
      const stops = rows.map((row) => ({ stopId: String(row.stopId || row.stop || row.stop_id || row.id), sequence: Number(row.stopSequence || row.seq || row.stop_seq || 0), stopName: row.nameTc || stopName(row.stopId || row.stop || row.stop_id || row.id, route.operator) })).sort((a, b) => a.sequence - b.sequence);
      holder.innerHTML = stops.length ? `<h3>選擇上車站</h3>${stops.map((stop, index) => `<button type="button" class="transport-search-result" data-stop-index="${index}"><strong>${esc(stop.stopName || stop.stopId)}</strong><small>Stop ID ${esc(stop.stopId)}</small></button>`).join('')}` : '<div class="transport-status">此路線暫未提供車站資料。</div>';
      holder.querySelectorAll('[data-stop-index]').forEach((button) => button.addEventListener('click', () => selectRouteStop({ ...route, kind: 'route', stopId: stops[Number(button.dataset.stopIndex)].stopId, stopName: stops[Number(button.dataset.stopIndex)].stopName })));
    } catch { holder.innerHTML = '<div class="transport-error">未能載入沿途車站。</div>'; }
  }

  async function selectRouteStop(raw) {
    if (!editingPreferenceId) return addItem(raw);
    const originalId = editingPreferenceId;
    editingPreferenceId = null;
    try {
      await updateConfig((remote) => fromUnified(changePreference(toUnified(remote), originalId, raw), remote));
      addDialog().close();
      showToast('已更新上車站');
      refresh({ force: true });
    } catch (error) {
      showToast(error.message === 'duplicate_preference' ? '這項交通已經收藏' : '未能更新上車站');
    }
  }

  async function searchStopInput() {
    const operator = byId('transport-stop-operator').value; const query = byId('transport-stop-query').value.trim(); const holder = byId('transport-stop-results');
    if (!query) return holder.innerHTML = '';
    try {
      await ensureCatalog(operator);
      const source = operator === 'KMB' || operator === 'LWB' ? kmbStops : operator === 'CTB' ? ctbStops : gmbStops;
      const matches = searchStops(source, query);
      holder.innerHTML = matches.length ? matches.map((stop, index) => `<button class="transport-search-result" type="button" data-stop-search-index="${index}"><strong>${esc(stop.nameTc || stop.name || stop.stopId)}</strong><small>${esc(operatorLabel(operator))} · ${esc(stop.stopId)}</small></button>`).join('') : '<div class="transport-status">找不到相符車站；可直接輸入 Stop ID。</div>';
      holder.querySelectorAll('[data-stop-search-index]').forEach((button) => button.addEventListener('click', () => addItem({ ...matches[Number(button.dataset.stopSearchIndex)], operator, kind: 'stop', name: matches[Number(button.dataset.stopSearchIndex)].nameTc || matches[Number(button.dataset.stopSearchIndex)].name })));
    } catch { holder.innerHTML = '<div class="transport-error">未能搜尋車站。</div>'; }
  }
  function addDirectStop() {
    const stopId = byId('transport-stop-id').value.trim(); if (!stopId) return showToast('請輸入 Stop ID');
    addItem({ kind: 'stop', operator: byId('transport-stop-operator').value, stopId, name: stopName(stopId, byId('transport-stop-operator').value) });
  }
  function stopName(id, operator) { const source = operator === 'KMB' || operator === 'LWB' ? kmbStops : operator === 'CTB' ? ctbStops : gmbStops; return source.find((x) => x.stopId === String(id))?.nameTc || ''; }

  function renderMtrLines() {
    const line = byId('transport-mtr-line'); if (!line) return;
    const selected = line.value; line.innerHTML = MTR_ORDER.map((code) => `<option value="${code}">${esc(MTR_LINES[code].zh)}</option>`).join(''); if (selected) line.value = selected; renderMtrStations();
  }
  function renderMtrStations() {
    const line = byId('transport-mtr-line').value; byId('transport-mtr-station').innerHTML = (MTR_LINES[line]?.stations || []).map(([code, name]) => `<option value="${code}">${esc(name)} (${code})</option>`).join('');
  }
  function renderMtrSearch() {
    const matches = searchMtr(byId('transport-mtr-query').value).slice(0, 12); if (!matches.length) return;
    const first = matches[0]; byId('transport-mtr-line').value = first.line; renderMtrStations(); byId('transport-mtr-station').value = first.station;
  }
  function addMtr() { addItem({ kind: 'mtr', line: byId('transport-mtr-line').value, station: byId('transport-mtr-station').value, direction: byId('transport-mtr-direction').value }); }

  async function addItem(raw) {
    try {
      const item = normalizePreference(raw);
      if (allItems(prefs).length >= MAX_ITEMS * 3) return showToast('交通收藏已達上限');
      if (allItems(prefs).some((existing) => existing.id === item.id)) return showToast('這項交通已經收藏');
      await updateConfig((remote) => fromUnified(addPreference(toUnified(remote), item), remote));
      addDialog().close();
      showToast('已加入交通收藏');
      refresh({ force: true });
    } catch (error) { showToast(error.message === 'duplicate_preference' ? '這項交通已經收藏' : '交通資料不完整，未能加入'); }
  }

  async function importLegacyRoutes() {
    const routes = legacyRoutes?.() || [];
    await updateConfig((remote) => routes.reduce((current, route) => fromUnified(addPreference(toUnified(current), { ...route, kind: 'route', operator: route.operator || 'KMB', direction: route.direction || route.bound }), current), remote));
    showToast('已匯入舊版首頁路線');
  }

  function exportPersonalSettings() {
    const blob = new Blob([JSON.stringify({ format: 'family-helper-personal-transport', version: 1, preferences: prepareCloud(prefs) }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'family-helper-personal-transport.json'; link.click(); URL.revokeObjectURL(link.href);
  }
  async function importPersonalSettings(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 256_000) throw new Error('too_large');
      const parsed = JSON.parse(await file.text()); if (parsed.format !== 'family-helper-personal-transport' || parsed.version !== 1) throw new Error('invalid_format');
      const imported = normalizeCloud({ ...parsed.preferences, revision: prefs.revision });
      if (imported.routes.length > MAX_ITEMS || imported.stops.length > MAX_ITEMS || imported.mtr.length > MAX_ITEMS) throw new Error('too_many');
      await updateConfig(() => imported); showToast('個人交通設定已匯入');
    } catch { showToast('個人交通設定檔案無效'); }
  }

  async function refresh({ force = false } = {}) {
    if (!approved || document.hidden || (!force && !isTransportVisible())) return schedule();
    const generation = ++refreshGeneration;
    const items = allItems(prefs);
    if (!items.length) { results = new Map(); render(); return; }
    byId('transport-status').textContent = '正在更新交通資料…';
    const settled = await Promise.all(items.map(async (item) => {
      try { return [item.id, await fetchItem(item)]; }
      catch (error) { console.warn('Transport ETA unavailable', item.operator, error?.message); return [item.id, { error: '部分資料未能更新', arrivals: [] }]; }
    }));
    if (generation !== refreshGeneration || !approved) return;
    results = new Map(settled);
    if (settled.some(([, value]) => !value.error)) lastSuccess = new Date();
    renderHome(); renderFull(); schedule();
  }

  async function fetchItem(item) {
    if (item.kind === 'mtr') {
      const schedule = await fetchMtrSchedule(item.line, item.station); const arrivals = (item.direction === 'DOWN' ? schedule.down : schedule.up).slice(0, 3);
      return { arrivals, error: schedule.delayed ? '港鐵報告服務受阻' : '' };
    }
    if (item.kind === 'route') {
      let rows;
      if (item.operator === 'CTB') rows = await fetchCtbStopEtas(item.stopId);
      else if (item.operator === 'GMB') rows = await fetchGmbStopEtas(item.stopId, gmbRouteCatalog);
      else rows = await fetchKmbRouteEtas(item.stopId, item.route, item.serviceType);
      const arrivals = validFutureArrivals(rows).filter((row) => routeMatches(row, item)).slice(0, 3);
      return { arrivals };
    }
    let rows;
    if (item.operator === 'CTB') rows = await fetchCtbStopEtas(item.stopId);
    else if (item.operator === 'GMB') rows = await fetchGmbStopEtas(item.stopId, gmbRouteCatalog);
    else rows = await fetchKmbStopEtas(item.stopId);
    return { groups: groupArrivals(validFutureArrivals(rows)), arrivals: [] };
  }
  function routeMatches(row, item) {
    if (item.operator === 'GMB') return String(row.routeId) === String(item.routeId) && String(row.routeSequence) === String(item.direction);
    return row.route === item.route && (!row.direction || row.direction === item.direction) && (!row.serviceType || String(row.serviceType) === String(item.serviceType));
  }

  async function locateNearby() {
    const status = byId('nearby-status');
    if (!navigator.geolocation) { status.textContent = '此裝置不支援定位，請搜尋參考車站。'; byId('nearby-search-label').hidden = false; return; }
    status.textContent = '正在取得目前位置…';
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        await Promise.all([ensureCatalog('KMB'), ensureStaticCatalog()]);
        renderNearby(nearbyStops([...kmbStops, ...ctbStops, ...gmbStops], { latitude: position.coords.latitude, longitude: position.coords.longitude }, 800).slice(0, 35));
      } catch { status.textContent = '未能載入附近車站，請改用搜尋。'; }
    }, () => { status.textContent = '未能使用定位；可搜尋參考車站。'; byId('nearby-search-label').hidden = false; }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 });
  }
  async function searchNearbyReference() {
    const query = byId('nearby-search').value.trim(); if (!query) return byId('nearby-results').innerHTML = '';
    try { await Promise.all([ensureCatalog('KMB'), ensureStaticCatalog()]); renderNearby(searchStops([...kmbStops, ...ctbStops, ...gmbStops], query)); } catch { byId('nearby-status').textContent = '未能搜尋車站。'; }
  }
  function renderNearby(stops) {
    byId('nearby-status').textContent = stops.length ? `找到 ${stops.length} 個車站` : '附近未有支援的車站。';
    byId('nearby-results').innerHTML = stops.map((stop, index) => `<button class="transport-search-result" type="button" data-nearby-index="${index}"><strong>${esc(stop.nameTc || stop.name || stop.stopId)}</strong><small>${Number.isFinite(stop.distanceMeters) ? `${Math.round(stop.distanceMeters)} 米 · ` : ''}${esc(stop.stopId)} · 查看路線</small></button>`).join('');
    byId('nearby-results').querySelectorAll('[data-nearby-index]').forEach((button) => button.addEventListener('click', async () => {
      const stop = stops[Number(button.dataset.nearbyIndex)];
      try {
        const rows = stop.operator === 'CTB' ? await fetchCtbStopEtas(stop.stopId) : stop.operator === 'GMB' ? await fetchGmbStopEtas(stop.stopId, gmbRouteCatalog) : await fetchKmbStopEtas(stop.stopId);
        const groups = groupArrivals(validFutureArrivals(rows));
        byId('nearby-results').innerHTML = groups.length ? groups.map((group) => `<button class="transport-search-result" type="button" data-nearby-route="${attr(group.key)}"><strong>${esc(group.route)} → ${esc(group.destination)}</strong><small>${esc(stop.nameTc || stop.stopId)} · 加入路線收藏</small></button>`).join('') : '<div class="transport-status">此站暫無班次。</div>';
        byId('nearby-results').querySelectorAll('[data-nearby-route]').forEach((routeButton) => routeButton.addEventListener('click', () => {
          const group = groups.find((x) => x.key === routeButton.dataset.nearbyRoute);
          addItem({ kind: 'route', operator: group.operator, route: group.route, direction: group.direction, serviceType: group.serviceType, stopId: stop.stopId, stopName: stop.nameTc || '', destination: group.destination });
        }));
      } catch { byId('nearby-status').textContent = '未能取得此站路線。'; }
    }));
  }

  function schedule() {
    clearTimeout(refreshTimer);
    if (!approved || !prefs.interval || document.hidden || !isTransportVisible()) return;
    refreshTimer = setTimeout(() => refresh({ force: true }), prefs.interval * 1000);
  }
  function isTransportVisible() { return document.querySelector('#page-home.active') || document.querySelector('#page-transport.active'); }
  function setStatus(text, state) { byId('bus-updated').textContent = text; byId('bus-status-dot').className = `status-dot ${state}`.trim(); }
  function timeLabel(date) { return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
  function etaText(item) {
    if (Number.isFinite(item.minutes)) return item.minutes <= 1 ? '即將到站' : `${item.minutes} 分鐘`;
    const at = item.etaAt instanceof Date ? item.etaAt : new Date(item.etaAt); if (Number.isNaN(at.getTime())) return item.remark || '未有時間';
    const minutes = Math.max(0, Math.round((at.getTime() - Date.now()) / 60000)); return minutes <= 1 ? '即將到站' : `${minutes} 分鐘`;
  }
  function transportEmpty(icon, title, body) { return `<div class="transport-empty"><span class="emoji">${icon}</span><strong>${title}</strong><span>${body}</span></div>`; }
  function toUnified(cloud) { return { version: 2, interval: cloud.interval, showOnHome: cloud.showOnHome, items: allItems(cloud) }; }
  function fromUnified(unified, base, options = {}) {
    const stopRoutes = options.stopRoutes || new Map((base.stops || []).map((item) => [item.id, item.routes || []]));
    const ordered = unified.items.map((item, order) => ({ ...item, order }));
    return { ...base, interval: unified.interval ?? base.interval, showOnHome: unified.showOnHome ?? base.showOnHome, routes: ordered.filter((x) => itemKind(x) === 'route'), stops: ordered.filter((x) => itemKind(x) === 'stop').map((x) => ({ ...x, stopName: x.stopName || x.name || '', routes: stopRoutes.get(x.id) || x.routes || [] })), mtr: ordered.filter((x) => itemKind(x) === 'mtr') };
  }

  return { bind, setIdentity, setPage, refresh, openSettings, setShowOnHome, getShowOnHome };
}
