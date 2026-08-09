(() => {
  'use strict';

  const STORAGE_KEY = 'family-helper-v1';
  const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb';
  const CTB_BASE = 'https://rt.data.gov.hk/v1/transport/citybus-nwfb';
  const HKO_CURRENT = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc';

  const ROUTES = [
    { route: '681', dest: '中環（香港站）', destMatch: '中環', preferredSeq: 1, jointCitybus: true },
    { route: '680', dest: '金鐘', destMatch: '金鐘', preferredSeq: 4, jointCitybus: true },
    { route: '89D', dest: '藍田站', destMatch: '藍田', preferredSeq: 6 },
    { route: '87D', dest: '紅磡站', destMatch: '紅磡', preferredSeq: 4 },
  ];

  const CATEGORY_META = {
    estate: { label: '屋苑', icon: 'building', cls: 'estate' },
    medical: { label: '醫療', icon: 'heart', cls: 'medical' },
    school: { label: '學校', icon: 'school', cls: 'school' },
    emergency: { label: '緊急', icon: 'alert', cls: 'emergency' },
    other: { label: '其他', icon: 'info', cls: 'other' },
  };

  const EVENT_META = {
    family: { label: '家庭', emoji: '🍴' },
    school: { label: '學校', emoji: '📚' },
    medical: { label: '醫療', emoji: '🩺' },
    car: { label: '汽車', emoji: '🚗' },
    bill: { label: '繳費', emoji: '💳' },
    birthday: { label: '生日', emoji: '🎂' },
    other: { label: '其他', emoji: '📌' },
  };

  const defaultState = {
    todos: [],
    events: [],
    contacts: [
      { id: uid(), category: 'estate', name: '管理處', phone: '', address: '' },
      { id: uid(), category: 'estate', name: '保安室', phone: '', address: '' },
      { id: uid(), category: 'medical', name: '家庭醫生', phone: '', address: '' },
      { id: uid(), category: 'school', name: '學校', phone: '', address: '' },
      { id: 'emergency-999', category: 'emergency', name: '999', phone: '999', address: '' },
    ],
  };

  let state = loadState();
  let currentPage = 'home';
  let todoFilter = 'all';
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  let selectedDate = toISODate(now);
  let busTimer = null;
  let toastTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindNavigation();
    bindTodoUI();
    bindCalendarUI();
    bindContactUI();
    bindBackupUI();
    bindHomeUI();
    updateDateAndGreeting();
    renderAllLocal();
    loadWeather();
    loadBusETA();
    busTimer = window.setInterval(() => {
      if (!document.hidden) loadBusETA({ quiet: true });
    }, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && currentPage === 'home') loadBusETA({ quiet: true });
    });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function bindNavigation() {
    document.querySelectorAll('[data-nav]').forEach((button) => {
      button.addEventListener('click', () => switchPage(button.dataset.nav));
    });
    document.querySelectorAll('[data-go]').forEach((button) => {
      button.addEventListener('click', () => switchPage(button.dataset.go));
    });
  }

  function switchPage(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === page));
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === page));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'calendar') renderCalendar();
    if (page === 'info') renderContacts();
    if (page === 'todos') renderTodos();
  }

  function bindHomeUI() {
    document.getElementById('refresh-bus').addEventListener('click', () => loadBusETA());
  }

  function bindTodoUI() {
    document.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        todoFilter = chip.dataset.filter;
        document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderTodos();
      });
    });
    document.getElementById('add-todo-top').addEventListener('click', () => openTodoDialog());
    document.getElementById('add-todo-fab').addEventListener('click', () => openTodoDialog());
    document.getElementById('save-todo').addEventListener('click', saveTodoFromDialog);
  }

  function openTodoDialog(item = null) {
    const dialog = document.getElementById('todo-dialog');
    document.getElementById('todo-dialog-title').textContent = item ? '修改清單項目' : '新增清單項目';
    document.getElementById('todo-id').value = item?.id || '';
    document.getElementById('todo-text').value = item?.text || '';
    document.getElementById('todo-category').value = item?.category || (todoFilter === 'shopping' ? 'shopping' : 'todo');
    dialog.showModal();
    setTimeout(() => document.getElementById('todo-text').focus(), 50);
  }

  function saveTodoFromDialog() {
    const id = document.getElementById('todo-id').value;
    const text = document.getElementById('todo-text').value.trim();
    const category = document.getElementById('todo-category').value;
    if (!text) return showToast('請輸入清單內容');
    if (id) {
      const item = state.todos.find((x) => x.id === id);
      if (item) Object.assign(item, { text, category });
    } else {
      state.todos.unshift({ id: uid(), text, category, done: false, createdAt: Date.now() });
    }
    persist();
    document.getElementById('todo-dialog').close();
    renderTodos();
    renderHomeSummary();
    showToast(id ? '已更新項目' : '已新增項目');
  }

  function renderTodos() {
    const holder = document.getElementById('todo-list');
    const filtered = state.todos.filter((item) => todoFilter === 'all' || item.category === todoFilter);
    if (!filtered.length) {
      holder.innerHTML = `<div class="empty-state"><span class="emoji">${todoFilter === 'shopping' ? '🛒' : '✅'}</span><strong>暫時未有項目</strong><span>按「新增」加入家庭清單。</span></div>`;
      return;
    }
    holder.innerHTML = filtered.map((item) => `
      <article class="todo-item ${item.done ? 'done' : ''}" data-id="${escapeAttr(item.id)}">
        <input class="todo-check" type="checkbox" ${item.done ? 'checked' : ''} aria-label="完成 ${escapeAttr(item.text)}" />
        <div class="todo-main">
          <strong>${escapeHTML(item.text)}</strong>
          <span class="category-tag ${item.category}">${item.category === 'shopping' ? '🛒 購物' : '✓ 待辦'}</span>
        </div>
        <div class="row-actions">
          <button class="mini-icon-button edit-todo" type="button" aria-label="修改"><svg><use href="#i-edit"></use></svg></button>
          <button class="mini-icon-button danger delete-todo" type="button" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button>
        </div>
      </article>`).join('');

    holder.querySelectorAll('.todo-item').forEach((row) => {
      const item = state.todos.find((x) => x.id === row.dataset.id);
      row.querySelector('.todo-check').addEventListener('change', (e) => {
        item.done = e.target.checked;
        persist();
        renderTodos();
        renderHomeSummary();
      });
      row.querySelector('.edit-todo').addEventListener('click', () => openTodoDialog(item));
      row.querySelector('.delete-todo').addEventListener('click', () => {
        state.todos = state.todos.filter((x) => x.id !== item.id);
        persist();
        renderTodos();
        renderHomeSummary();
        showToast('已刪除項目');
      });
    });
  }

  function bindCalendarUI() {
    document.getElementById('prev-month').addEventListener('click', () => moveMonth(-1));
    document.getElementById('next-month').addEventListener('click', () => moveMonth(1));
    document.getElementById('add-event-top').addEventListener('click', () => openEventDialog());
    document.getElementById('add-event-inline').addEventListener('click', () => openEventDialog());
    document.getElementById('save-event').addEventListener('click', saveEventFromDialog);
  }

  function moveMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
  }

  function renderCalendar() {
    document.getElementById('month-title').textContent = `${viewYear}年${viewMonth + 1}月`;
    const grid = document.getElementById('calendar-grid');
    const first = new Date(viewYear, viewMonth, 1);
    const start = new Date(viewYear, viewMonth, 1 - first.getDay());
    const todayISO = toISODate(new Date());
    let html = '';
    for (let i = 0; i < 42; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const iso = toISODate(date);
      const outside = date.getMonth() !== viewMonth;
      const hasEvents = state.events.some((event) => event.date === iso);
      html += `<button class="calendar-day ${outside ? 'outside' : ''} ${iso === todayISO ? 'today' : ''} ${iso === selectedDate ? 'selected' : ''}" type="button" data-date="${iso}">${date.getDate()}${hasEvents ? '<span class="event-dot"></span>' : ''}</button>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.calendar-day').forEach((day) => {
      day.addEventListener('click', () => {
        selectedDate = day.dataset.date;
        const d = fromISODate(selectedDate);
        viewYear = d.getFullYear();
        viewMonth = d.getMonth();
        renderCalendar();
      });
    });
    renderSelectedDayEvents();
  }

  function renderSelectedDayEvents() {
    const date = fromISODate(selectedDate);
    const weekday = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()];
    document.getElementById('selected-date-title').textContent = `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
    const holder = document.getElementById('event-list');
    const events = state.events
      .filter((event) => event.date === selectedDate)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    if (!events.length) {
      holder.innerHTML = '<div class="empty-state"><span class="emoji">📅</span><strong>這日未有行程</strong><span>按「新增」加入家庭活動。</span></div>';
      return;
    }
    holder.innerHTML = events.map((event) => {
      const meta = EVENT_META[event.category] || EVENT_META.other;
      return `<div class="event-item" data-id="${escapeAttr(event.id)}">
        <div class="event-icon">${meta.emoji}</div>
        <div class="event-main"><strong>${event.time ? escapeHTML(event.time) + '　' : ''}${escapeHTML(event.title)}</strong><small>${meta.label}</small></div>
        <div class="row-actions"><button class="mini-icon-button edit-event" type="button" aria-label="修改"><svg><use href="#i-edit"></use></svg></button><button class="mini-icon-button danger delete-event" type="button" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button></div>
      </div>`;
    }).join('');
    holder.querySelectorAll('.event-item').forEach((row) => {
      const event = state.events.find((x) => x.id === row.dataset.id);
      row.querySelector('.edit-event').addEventListener('click', () => openEventDialog(event));
      row.querySelector('.delete-event').addEventListener('click', () => {
        state.events = state.events.filter((x) => x.id !== event.id);
        persist();
        renderCalendar();
        renderHomeSummary();
        showToast('已刪除行程');
      });
    });
  }

  function openEventDialog(event = null) {
    const dialog = document.getElementById('event-dialog');
    document.getElementById('event-dialog-title').textContent = event ? '修改家庭行程' : '新增家庭行程';
    document.getElementById('event-id').value = event?.id || '';
    document.getElementById('event-title').value = event?.title || '';
    document.getElementById('event-date').value = event?.date || selectedDate;
    document.getElementById('event-time').value = event?.time || '';
    document.getElementById('event-category').value = event?.category || 'family';
    dialog.showModal();
  }

  function saveEventFromDialog() {
    const id = document.getElementById('event-id').value;
    const title = document.getElementById('event-title').value.trim();
    const date = document.getElementById('event-date').value;
    const time = document.getElementById('event-time').value;
    const category = document.getElementById('event-category').value;
    if (!title || !date) return showToast('請輸入事項及日期');
    if (id) {
      const event = state.events.find((x) => x.id === id);
      if (event) Object.assign(event, { title, date, time, category });
    } else {
      state.events.push({ id: uid(), title, date, time, category });
    }
    selectedDate = date;
    const selected = fromISODate(date);
    viewYear = selected.getFullYear();
    viewMonth = selected.getMonth();
    persist();
    document.getElementById('event-dialog').close();
    renderCalendar();
    renderHomeSummary();
    showToast(id ? '已更新行程' : '已新增行程');
  }

  function bindContactUI() {
    document.getElementById('add-contact-top').addEventListener('click', () => openContactDialog());
    document.getElementById('save-contact').addEventListener('click', saveContactFromDialog);
  }

  function renderContacts() {
    const holder = document.getElementById('contact-groups');
    const order = ['estate','medical','school','emergency','other'];
    const sections = order.map((category) => {
      const items = state.contacts.filter((c) => c.category === category);
      if (!items.length) return '';
      const meta = CATEGORY_META[category] || CATEGORY_META.other;
      return `<article class="card contact-card">
        <div class="contact-title ${meta.cls}"><svg><use href="#i-${meta.icon}"></use></svg>${meta.label}</div>
        ${items.map((item) => contactRowHTML(item)).join('')}
      </article>`;
    }).join('');
    holder.innerHTML = sections || '<div class="empty-state"><span class="emoji">☎️</span><strong>未有實用資料</strong><span>按「新增」加入常用電話。</span></div>';

    holder.querySelectorAll('.contact-row').forEach((row) => {
      const item = state.contacts.find((x) => x.id === row.dataset.id);
      row.querySelector('.edit-contact')?.addEventListener('click', () => openContactDialog(item));
      row.querySelector('.delete-contact')?.addEventListener('click', () => {
        if (item.id === 'emergency-999') return;
        state.contacts = state.contacts.filter((x) => x.id !== item.id);
        persist();
        renderContacts();
        showToast('已刪除資料');
      });
    });
  }

  function contactRowHTML(item) {
    const safePhone = item.phone.replace(/[^+\d]/g, '');
    const phoneLine = item.phone ? escapeHTML(item.phone) : '未設定電話';
    const addressLine = item.address ? `<small>${escapeHTML(item.address)}</small>` : '';
    const call = item.phone ? `<a class="call-button" href="tel:${escapeAttr(safePhone)}"><svg><use href="#i-phone"></use></svg>撥打</a>` : '';
    const map = item.address ? `<a class="map-button" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}" target="_blank" rel="noopener" aria-label="開啟地圖"><svg><use href="#i-map"></use></svg></a>` : '';
    const deletable = item.id !== 'emergency-999';
    return `<div class="contact-row" data-id="${escapeAttr(item.id)}">
      <div><strong>${escapeHTML(item.name)}</strong><small>${phoneLine}</small>${addressLine}</div>
      <div class="contact-actions">${map}${call}<button class="mini-icon-button edit-contact" type="button" aria-label="修改"><svg><use href="#i-edit"></use></svg></button>${deletable ? '<button class="mini-icon-button danger delete-contact" type="button" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button>' : ''}</div>
    </div>`;
  }

  function openContactDialog(item = null) {
    document.getElementById('contact-dialog-title').textContent = item ? '修改實用資料' : '新增實用資料';
    document.getElementById('contact-id').value = item?.id || '';
    document.getElementById('contact-category').value = item?.category || 'estate';
    document.getElementById('contact-name').value = item?.name || '';
    document.getElementById('contact-phone').value = item?.phone || '';
    document.getElementById('contact-address').value = item?.address || '';
    document.getElementById('contact-dialog').showModal();
  }

  function saveContactFromDialog() {
    const id = document.getElementById('contact-id').value;
    const category = document.getElementById('contact-category').value;
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const address = document.getElementById('contact-address').value.trim();
    if (!name) return showToast('請輸入名稱');
    if (id) {
      const contact = state.contacts.find((x) => x.id === id);
      if (contact) Object.assign(contact, { category, name, phone, address });
    } else {
      state.contacts.push({ id: uid(), category, name, phone, address });
    }
    persist();
    document.getElementById('contact-dialog').close();
    renderContacts();
    showToast(id ? '已更新資料' : '已新增資料');
  }

  function bindBackupUI() {
    document.getElementById('export-data').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `family-helper-backup-${toISODate(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      showToast('已匯出備份');
    });
    document.getElementById('import-data').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const imported = parsed.data || parsed;
        if (!Array.isArray(imported.todos) || !Array.isArray(imported.events) || !Array.isArray(imported.contacts)) throw new Error('Invalid backup');
        state = imported;
        persist();
        renderAllLocal();
        showToast('已匯入備份');
      } catch {
        showToast('備份檔案格式不正確');
      } finally {
        event.target.value = '';
      }
    });
  }

  function renderAllLocal() {
    renderTodos();
    renderCalendar();
    renderContacts();
    renderHomeSummary();
  }

  function renderHomeSummary() {
    const pending = state.todos.filter((t) => !t.done).length;
    const completed = state.todos.filter((t) => t.done).length;
    document.getElementById('home-todo-count').textContent = pending;
    document.getElementById('home-todo-note').textContent = pending ? `${completed} 項已完成` : '全部完成';

    const today = toISODate(new Date());
    const todaysEvents = state.events.filter((e) => e.date === today).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    document.getElementById('home-event-count').textContent = todaysEvents.length;
    const next = todaysEvents.find((e) => !e.time || `${today}T${e.time}` >= localDateTimeKey(new Date())) || todaysEvents[0];
    document.getElementById('home-next-event').textContent = next ? `${next.time ? next.time + ' ' : ''}${next.title}` : '今日未有活動';
  }

  function updateDateAndGreeting() {
    const date = new Date();
    const weekday = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()];
    document.getElementById('home-date').textContent = `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
    const hour = date.getHours();
    let title = '你好！', icon = '👋';
    if (hour < 12) { title = '早晨！'; icon = '☀️'; }
    else if (hour < 18) { title = '午安！'; icon = '🌤️'; }
    else { title = '晚上好！'; icon = '🌙'; }
    document.getElementById('greeting-title').textContent = title;
    document.getElementById('greeting-icon').textContent = icon;
  }

  async function loadWeather() {
    const tempEl = document.getElementById('weather-temp');
    const noteEl = document.getElementById('weather-note');
    try {
      const response = await fetchWithTimeout(HKO_CURRENT, 9_000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const temps = data.temperature?.data || [];
      const preferred = temps.find((x) => String(x.place).includes('沙田')) || temps.find((x) => String(x.place).includes('香港天文台')) || temps[0];
      if (preferred?.value != null) tempEl.textContent = `${Math.round(preferred.value)}°C`;
      const humidity = data.humidity?.data?.[0]?.value;
      noteEl.textContent = humidity != null ? `濕度 ${humidity}% · 天文台` : '香港天文台';
      const iconNo = data.icon?.[0];
      document.getElementById('weather-icon').textContent = weatherEmoji(iconNo);
    } catch {
      tempEl.textContent = '--°C';
      noteEl.textContent = '暫時未能取得天氣';
    }
  }

  async function loadBusETA({ quiet = false } = {}) {
    const list = document.getElementById('bus-list');
    const updated = document.getElementById('bus-updated');
    const dot = document.getElementById('bus-status-dot');
    if (!quiet) {
      dot.className = 'status-dot loading';
      updated.textContent = '正在更新九巴資料…';
      renderBusSkeleton();
    }
    try {
      const routeResponse = await fetchWithTimeout(`${KMB_BASE}/route/`, 10_000);
      if (!routeResponse.ok) throw new Error(`Route HTTP ${routeResponse.status}`);
      const routeData = (await routeResponse.json()).data || [];

      const results = await Promise.all(ROUTES.map(async (config) => {
        try {
          const candidates = routeData.filter((x) => String(x.route).toUpperCase() === config.route);
          const chosen = chooseOutboundCandidate(candidates, config);
          if (!chosen) throw new Error(`No route candidate for ${config.route}`);
          const direction = chosen.bound === 'O' ? 'outbound' : 'inbound';
          const serviceType = String(chosen.service_type || '1');
          const rsResp = await fetchWithTimeout(`${KMB_BASE}/route-stop/${encodeURIComponent(config.route)}/${direction}/${encodeURIComponent(serviceType)}`, 9_000);
          if (!rsResp.ok) throw new Error(`Route-stop HTTP ${rsResp.status}`);
          const routeStops = (await rsResp.json()).data || [];
          const stopEntry = routeStops.find((x) => Number(x.seq) === config.preferredSeq) || routeStops[0];
          if (!stopEntry?.stop) throw new Error(`No stop for ${config.route}`);
          const etaResp = await fetchWithTimeout(`${KMB_BASE}/eta/${encodeURIComponent(stopEntry.stop)}/${encodeURIComponent(config.route)}/${encodeURIComponent(serviceType)}`, 9_000);
          if (!etaResp.ok) throw new Error(`ETA HTTP ${etaResp.status}`);
          const etaData = (await etaResp.json()).data || [];
          const kmbEtas = etaData
            .filter((x) => x.eta && (!x.dir || x.dir === chosen.bound))
            .map((x) => ({ ...x, source: 'KMB', etaDate: new Date(x.eta) }))
            .filter((x) => !Number.isNaN(x.etaDate.getTime()) && x.etaDate.getTime() > Date.now() - 90_000);
          const citybusEtas = config.jointCitybus ? await loadCitybusEtas(config) : [];
          const future = dedupeEtas([...kmbEtas, ...citybusEtas]).sort((a, b) => a.etaDate - b.etaDate).slice(0, 3);
          return { ...config, etas: future, unavailable: false };
        } catch (error) {
          console.warn(`${config.route} ETA error:`, error);
          return { ...config, etas: [], unavailable: true };
        }
      }));

      renderBusResults(results);
      const dt = new Date();
      const failedCount = results.filter((result) => result.unavailable).length;
      updated.textContent = failedCount
        ? `資料更新：${pad(dt.getHours())}:${pad(dt.getMinutes())} · ${failedCount} 條路線暫時未能更新`
        : `資料更新：${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      dot.className = failedCount ? 'status-dot error' : 'status-dot';
    } catch (error) {
      console.warn('KMB ETA error:', error);
      dot.className = 'status-dot error';
      updated.textContent = '暫時未能取得實時資料，請稍後再試';
      if (!quiet) renderBusErrorRows();
    }
  }


  async function loadCitybusEtas(config) {
    try {
      const rsResp = await fetchWithTimeout(`${CTB_BASE}/route-stop/CTB/${encodeURIComponent(config.route)}/outbound`, 8_000);
      if (!rsResp.ok) return [];
      const routeStops = (await rsResp.json()).data || [];
      const stopEntry = routeStops.find((x) => Number(x.seq) === config.preferredSeq) || routeStops[0];
      if (!stopEntry?.stop) return [];
      const etaResp = await fetchWithTimeout(`${CTB_BASE}/eta/CTB/${encodeURIComponent(stopEntry.stop)}/${encodeURIComponent(config.route)}`, 8_000);
      if (!etaResp.ok) return [];
      const etaData = (await etaResp.json()).data || [];
      return etaData
        .filter((x) => x.eta && (!x.dir || x.dir === 'O'))
        .map((x) => ({ ...x, source: 'CTB', etaDate: new Date(x.eta) }))
        .filter((x) => !Number.isNaN(x.etaDate.getTime()) && x.etaDate.getTime() > Date.now() - 90_000);
    } catch {
      return [];
    }
  }

  function dedupeEtas(items) {
    const sorted = items.sort((a, b) => a.etaDate - b.etaDate);
    const result = [];
    for (const item of sorted) {
      const duplicate = result.some((existing) => Math.abs(existing.etaDate - item.etaDate) < 45_000);
      if (!duplicate) result.push(item);
    }
    return result;
  }

  function chooseOutboundCandidate(candidates, config) {
    if (!candidates.length) return null;
    const byDestination = candidates.find((x) => String(x.dest_tc || '').includes(config.destMatch));
    if (byDestination) return byDestination;
    const fromMaOnShan = candidates.find((x) => /(馬鞍山|烏溪沙|利安|錦英苑)/.test(String(x.orig_tc || '')));
    return fromMaOnShan || candidates[0];
  }

  function renderBusSkeleton() {
    document.getElementById('bus-list').innerHTML = ROUTES.map((r) => `
      <div class="bus-row"><span class="route-badge">${r.route}</span><div class="route-destination"><strong>${r.dest}</strong><small>馬鞍山市中心</small></div><span class="eta-none">載入中…</span></div>`).join('');
  }

  function renderBusErrorRows() {
    document.getElementById('bus-list').innerHTML = ROUTES.map((r) => `
      <div class="bus-row"><span class="route-badge">${r.route}</span><div class="route-destination"><strong>${r.dest}</strong><small>馬鞍山市中心</small></div><span class="eta-none">未能更新</span></div>`).join('');
  }

  function renderBusResults(results) {
    document.getElementById('bus-list').innerHTML = results.map((result) => {
      const eta = result.unavailable
        ? '<span class="eta-none">未能更新</span>'
        : result.etas.length
        ? `<div class="eta-list">${result.etas.map((x) => `<span class="eta-pill">${formatETA(x.etaDate)}</span>`).join('')}</div>`
        : '<span class="eta-none">暫無班次</span>';
      return `<div class="bus-row"><span class="route-badge">${result.route}</span><div class="route-destination"><strong>${result.dest}</strong><small>${result.jointCitybus ? '九巴＋城巴聯營 · ' : '九巴 · '}馬鞍山市中心</small></div>${eta}</div>`;
    }).join('');
  }

  function formatETA(date) {
    const mins = Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000));
    if (mins <= 1) return '即將到站';
    return `${mins} 分鐘`;
  }

  function weatherEmoji(iconNo) {
    const n = Number(iconNo);
    if ([50,51].includes(n)) return '☀️';
    if ([52,53].includes(n)) return '🌤️';
    if ([54,55,56,57,58,59,60,61,62,63,64].includes(n)) return '☁️';
    if ([65,66,67,68,69,70,71,72,73,74,75,76,77].includes(n)) return '🌧️';
    if ([80,81,82].includes(n)) return '🌫️';
    if ([90,91,92,93].includes(n)) return '🌙';
    return '🌤️';
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      return {
        todos: Array.isArray(parsed.todos) ? parsed.todos : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        contacts: Array.isArray(parsed.contacts) && parsed.contacts.length ? parsed.contacts : structuredClone(defaultState.contacts),
      };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function toISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function fromISODate(value) {
    const [y,m,d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function localDateTimeKey(date) {
    return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function pad(value) { return String(value).padStart(2, '0'); }

  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function escapeAttr(value) { return escapeHTML(value); }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }
})();
