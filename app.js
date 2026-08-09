import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB7oF8M9bPBCsdO6FGjIUezIfvjKmd0bOU',
  authDomain: 'family-helpers.firebaseapp.com',
  projectId: 'family-helpers',
  storageBucket: 'family-helpers.firebasestorage.app',
  messagingSenderId: '409775533994',
  appId: '1:409775533994:web:fd35cb4f1ca19e554105d3',
  measurementId: 'G-8XRMGQ6ZL0',
};

const ADMIN_EMAIL = 'jatoy0a11@gmail.com';
const FAMILY_ID = 'home';
const LEGACY_STORAGE_KEY = 'family-helper-v1';
const MIGRATION_KEY = 'family-helper-v2-migrated';
const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb';
const CTB_BASE = 'https://rt.data.gov.hk/v1/transport/citybus-nwfb';
const HKO_CURRENT = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc';

// Human-readable stop code -> KMB Open Data 16-character stop ID.
// These are deliberately fixed so the app does not guess a direction or platform.
const ROUTES = [
  { route: '681', dest: '中環（香港站）', stopCode: 'MA954', stopId: 'BA6D9F93E62B8075', bound: 'O', serviceType: '1', jointCitybus: true, citybusStopId: '001950', citybusBound: 'I', citybusDestTc: '中環', citybusDestEn: 'CENTRAL' },
  { route: '680', dest: '金鐘', stopCode: 'MA952', stopId: '15FF958BE6921BAA', bound: 'O', serviceType: '1', jointCitybus: true, citybusStopId: '001950', citybusBound: 'I', citybusDestTc: '金鐘', citybusDestEn: 'ADMIRALTY' },
  { route: '87D', dest: '紅磡站', stopCode: 'MA303', stopId: '013F884CBCB1CBE4', bound: 'O', serviceType: '1' },
  { route: '89D', dest: '藍田站', stopCode: 'MA310', stopId: '76E8D8C73E0B8096', bound: 'O', serviceType: '1' },
  { route: '89P', dest: '藍田站', stopCode: 'MA310', stopId: '76E8D8C73E0B8096', bound: 'O', serviceType: '1' },
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
enableIndexedDbPersistence(db).catch(() => {});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const familyRef = doc(db, 'families', FAMILY_ID);
const todosRef = collection(familyRef, 'todos');
const eventsRef = collection(familyRef, 'calendarEvents');
const infoRef = collection(familyRef, 'usefulInfo');
const membersRef = collection(familyRef, 'members');
const requestsRef = collection(familyRef, 'membershipRequests');
const announcementsRef = collection(familyRef, 'announcements');

let state = { todos: [], events: [], contacts: [] };
let announcements = [];
let authUser = null;
let member = null;
let pendingRequest = null;
let sharedUnsubs = [];
let memberUnsubs = [];
let currentPage = 'home';
let todoFilter = 'all';
const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();
let selectedDate = toISODate(now);
let busTimer = null;
let toastTimer = null;
let networkOnline = navigator.onLine;

const privateAllowed = () => Boolean(authUser && member?.status === 'approved');
const isAdmin = () => privateAllowed() && member?.role === 'admin';

window.addEventListener('DOMContentLoaded', init);

function init() {
  bindNavigation();
  bindTodoUI();
  bindCalendarUI();
  bindContactUI();
  bindBackupUI();
  bindHomeUI();
  bindAuthUI();
  bindMemberUI();
  bindAnnouncementUI();
  updateDateAndGreeting();
  renderAll();
  loadWeather();
  loadBusETA();
  startAnnouncementListener();
  busTimer = window.setInterval(() => {
    if (!document.hidden) loadBusETA({ quiet: true });
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentPage === 'home') loadBusETA({ quiet: true });
  });
  window.addEventListener('online', () => { networkOnline = true; renderConnectionState(); });
  window.addEventListener('offline', () => { networkOnline = false; renderConnectionState(); });
  onAuthStateChanged(auth, handleAuthState, (error) => { console.error('Auth state:', error); showToast('登入狀態讀取失敗'); });
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
  if (page === 'info') { renderContacts(); renderMemberPanel(); }
  if (page === 'todos') renderTodos();
}

function bindHomeUI() {
  document.getElementById('refresh-bus').addEventListener('click', () => loadBusETA());
}

function bindAnnouncementUI() {
  document.getElementById('add-announcement').addEventListener('click', () => {
    if (!isAdmin()) return showToast('只有家庭管理員可以發佈公告');
    document.getElementById('announcement-message').value = '';
    document.getElementById('announcement-dialog').showModal();
    setTimeout(() => document.getElementById('announcement-message').focus(), 50);
  });
  document.getElementById('save-announcement').addEventListener('click', publishAnnouncement);
}

function startAnnouncementListener() {
  onSnapshot(announcementsRef, (snap) => {
    announcements = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAtMs || b.createdAt?.seconds || 0) - (a.createdAtMs || a.createdAt?.seconds || 0));
    renderAnnouncements();
  }, (error) => {
    console.warn('Public announcement listener:', error);
    announcements = [];
    renderAnnouncements();
  });
}

async function publishAnnouncement() {
  if (!isAdmin()) return showToast('只有家庭管理員可以發佈公告');
  const message = document.getElementById('announcement-message').value.trim();
  if (!message) return showToast('請輸入公告內容');
  try {
    await addDoc(announcementsRef, {
      message,
      createdBy: authUser.uid,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
    });
    document.getElementById('announcement-dialog').close();
    showToast('公告已發佈');
  } catch (error) {
    console.error('Publish announcement:', error);
    showToast('未能發佈公告');
  }
}

async function deleteAnnouncement(id) {
  if (!isAdmin() || !window.confirm('刪除這則公告？')) return;
  try {
    await deleteDoc(doc(announcementsRef, id));
    showToast('公告已刪除');
  } catch (error) {
    console.error('Delete announcement:', error);
    showToast('未能刪除公告');
  }
}

function renderAnnouncements() {
  const latest = announcements[0];
  document.querySelectorAll('[data-announcement-slot]').forEach((slot) => {
    slot.hidden = !latest;
    slot.innerHTML = latest ? `<aside class="announcement-banner" role="status"><span class="announcement-icon">📣</span><div><strong>全家公告</strong><p>${escapeHTML(latest.message)}</p></div>${isAdmin() ? `<button class="delete-announcement" type="button" data-id="${escapeAttr(latest.id)}" aria-label="刪除公告">×</button>` : ''}</aside>` : '';
    slot.querySelector('.delete-announcement')?.addEventListener('click', () => deleteAnnouncement(latest.id));
  });
  document.getElementById('announcement-admin-card').hidden = !isAdmin();
}

function bindAuthUI() {
  document.getElementById('google-login').addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.warn('Popup login failed, trying redirect', error);
      try { await signInWithRedirect(auth, provider); } catch { showToast('Google 登入失敗，請稍後再試'); }
    }
  });
  document.getElementById('logout-button').addEventListener('click', () => signOut(auth));
}

async function handleAuthState(user) {
  stopSharedListeners();
  stopMemberListeners();
  stopAdminPanelListeners();
  authUser = user;
  member = null;
  pendingRequest = null;
  state = { todos: [], events: [], contacts: [] };

  if (!user) {
    renderAll();
    renderAuthState();
    renderMemberPanel();
    return;
  }

  try {
    if ((user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      await ensureInitialAdmin(user);
    }
    await observeMembership(user);
  } catch (error) {
    console.error('Membership setup failed:', error);
    showToast('家庭帳戶狀態讀取失敗');
  }
}

async function ensureInitialAdmin(user) {
  const ref = doc(membersRef, user.uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || ADMIN_EMAIL,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      role: 'admin',
      status: 'approved',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

async function observeMembership(user) {
  const memberRef = doc(membersRef, user.uid);
  const requestRef = doc(requestsRef, user.uid);

  memberUnsubs.push(onSnapshot(memberRef, async (snap) => {
    member = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (member?.status === 'approved') {
      await startSharedListeners();
    } else {
      stopSharedListeners();
      state = { todos: [], events: [], contacts: [] };
      if ((user.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()) await ensurePendingRequest(user);
    }
    renderAll();
    renderAuthState();
    renderMemberPanel();
  }, (error) => {
    console.error('Member listener:', error);
    showToast('未能讀取家庭成員狀態');
  }));

  memberUnsubs.push(onSnapshot(requestRef, (snap) => {
    pendingRequest = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    renderAuthState();
    renderMemberPanel();
  }));
}

async function ensurePendingRequest(user) {
  const ref = doc(requestsRef, user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function startSharedListeners() {
  if (sharedUnsubs.length) return;
  sharedUnsubs.push(onSnapshot(todosRef, (snap) => {
    state.todos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortByCreatedDesc);
    renderTodos(); renderHomeSummary();
  }, cloudListenerError));
  sharedUnsubs.push(onSnapshot(eventsRef, (snap) => {
    state.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCalendar(); renderHomeSummary();
  }, cloudListenerError));
  sharedUnsubs.push(onSnapshot(infoRef, (snap) => {
    state.contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => (a.sortOrder || 999) - (b.sortOrder || 999));
    renderContacts();
  }, cloudListenerError));

  if (isAdmin()) {
    await ensureDefaultInfo();
    await offerLegacyMigration();
  }
}

function stopSharedListeners() {
  sharedUnsubs.forEach((unsub) => unsub());
  sharedUnsubs = [];
}

function stopMemberListeners() {
  memberUnsubs.forEach((unsub) => unsub());
  memberUnsubs = [];
}

function cloudListenerError(error) {
  console.error('Firestore listener:', error);
  showToast('雲端同步暫時有問題');
}

async function ensureDefaultInfo() {
  const snapshot = await getDocs(infoRef);
  if (!snapshot.empty) return;
  const batch = writeBatch(db);
  const defaults = [
    ['management-office', { category: 'estate', name: '管理處', phone: '', address: '', note: '', sortOrder: 10 }],
    ['security-office', { category: 'estate', name: '保安室', phone: '', address: '', note: '', sortOrder: 20 }],
    ['family-doctor', { category: 'medical', name: '家庭醫生', phone: '', address: '', note: '', sortOrder: 30 }],
    ['school', { category: 'school', name: '學校', phone: '', address: '', note: '', sortOrder: 40 }],
    ['emergency-999', { category: 'emergency', name: '999', phone: '999', address: '', note: '緊急熱線', sortOrder: 50 }],
  ];
  defaults.forEach(([id, data]) => batch.set(doc(infoRef, id), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await batch.commit();
}

async function offerLegacyMigration() {
  if (localStorage.getItem(MIGRATION_KEY) === 'done') return;
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null'); } catch { legacy = null; }
  if (!legacy || !legacyHasMeaningfulData(legacy)) {
    localStorage.setItem(MIGRATION_KEY, 'done');
    return;
  }
  const accepted = window.confirm('發現舊有本機資料，是否匯入家庭雲端？');
  if (!accepted) return;
  await importLegacy(legacy);
  localStorage.setItem(MIGRATION_KEY, 'done');
  showToast('舊有資料已匯入家庭雲端');
}

function legacyHasMeaningfulData(data) {
  const todos = Array.isArray(data.todos) ? data.todos.length : 0;
  const events = Array.isArray(data.events) ? data.events.length : 0;
  const contacts = Array.isArray(data.contacts) ? data.contacts.filter((c) => c.phone || c.address || (c.name && !['管理處','保安室','家庭醫生','學校','999'].includes(c.name))).length : 0;
  return todos + events + contacts > 0;
}

async function importLegacy(data) {
  const batch = writeBatch(db);
  (data.todos || []).forEach((item) => {
    const ref = doc(todosRef);
    batch.set(ref, { title: item.text || item.title || '', category: item.category || 'todo', completed: Boolean(item.done ?? item.completed), createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  (data.events || []).forEach((item) => {
    const ref = doc(eventsRef);
    batch.set(ref, { title: item.title || '', date: item.date || toISODate(new Date()), time: item.time || '', category: item.category || 'other', createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  (data.contacts || []).filter((c) => c.name).forEach((item) => {
    const ref = item.id === 'emergency-999' ? doc(infoRef, 'emergency-999') : doc(infoRef);
    batch.set(ref, { category: item.category || 'other', name: item.name, phone: item.phone || '', address: item.address || '', note: item.note || '', sortOrder: item.sortOrder || 999, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  });
  await batch.commit();
}

function renderAuthState() {
  const card = document.getElementById('auth-card');
  const login = document.getElementById('google-login');
  const logout = document.getElementById('logout-button');
  const title = document.getElementById('auth-title');
  const note = document.getElementById('auth-note');
  const avatar = document.getElementById('auth-avatar');
  card.classList.remove('pending', 'approved', 'admin');
  if (!authUser) {
    title.textContent = '登入家庭雲端';
    note.textContent = '登入後可與家人同步清單、日曆及實用資料。';
    avatar.textContent = '☁️';
    login.hidden = false;
    logout.hidden = true;
    return;
  }
  login.hidden = true;
  logout.hidden = false;
  avatar.textContent = authUser.photoURL ? '' : '👤';
  avatar.style.backgroundImage = authUser.photoURL ? `url("${authUser.photoURL}")` : '';
  if (member?.status === 'approved') {
    card.classList.add(member.role === 'admin' ? 'admin' : 'approved');
    title.textContent = member.role === 'admin' ? '家庭管理員' : '家庭成員';
    note.textContent = `${authUser.displayName || authUser.email || ''} · 雲端同步已啟用`;
  } else {
    card.classList.add('pending');
    title.textContent = '等待管理員批准';
    note.textContent = pendingRequest ? '加入家庭的申請已送出。批准後即可使用共享資料。' : '正在建立加入家庭的申請…';
  }
}

function renderConnectionState() {
  const badge = document.getElementById('connection-badge');
  if (!badge) return;
  badge.hidden = networkOnline;
  badge.textContent = networkOnline ? '' : '離線模式 · 會在重新連線後同步';
}

function guardPrivateAction() {
  if (privateAllowed()) return true;
  showToast(authUser ? '等待管理員批准後即可使用' : '請先使用 Google 登入');
  return false;
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
  if (!guardPrivateAction()) return;
  const dialog = document.getElementById('todo-dialog');
  document.getElementById('todo-dialog-title').textContent = item ? '修改清單項目' : '新增清單項目';
  document.getElementById('todo-id').value = item?.id || '';
  document.getElementById('todo-text').value = item?.title || item?.text || '';
  document.getElementById('todo-category').value = item?.category || (todoFilter === 'shopping' ? 'shopping' : 'todo');
  dialog.showModal();
  setTimeout(() => document.getElementById('todo-text').focus(), 50);
}

async function saveTodoFromDialog() {
  if (!guardPrivateAction()) return;
  const id = document.getElementById('todo-id').value;
  const title = document.getElementById('todo-text').value.trim();
  const category = document.getElementById('todo-category').value;
  if (!title) return showToast('請輸入清單內容');
  try {
    if (id) {
      await updateDoc(doc(todosRef, id), { title, category, updatedAt: serverTimestamp() });
    } else {
      await addDoc(todosRef, { title, category, completed: false, createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    document.getElementById('todo-dialog').close();
    showToast(id ? '已更新項目' : '已新增項目');
  } catch { showToast('未能儲存項目'); }
}

function renderTodos() {
  const holder = document.getElementById('todo-list');
  setPrivateButtonsEnabled(privateAllowed());
  if (!privateAllowed()) {
    holder.innerHTML = lockedHTML(authUser ? '等待管理員批准' : '登入後與家人共享清單');
    return;
  }
  const filtered = state.todos.filter((item) => todoFilter === 'all' || item.category === todoFilter);
  if (!filtered.length) {
    holder.innerHTML = `<div class="empty-state"><span class="emoji">${todoFilter === 'shopping' ? '🛒' : '✅'}</span><strong>暫時未有項目</strong><span>按「新增」加入家庭清單。</span></div>`;
    return;
  }
  holder.innerHTML = filtered.map((item) => `
    <article class="todo-item ${item.completed ? 'done' : ''}" data-id="${escapeAttr(item.id)}">
      <input class="todo-check" type="checkbox" ${item.completed ? 'checked' : ''} aria-label="完成 ${escapeAttr(item.title)}" />
      <div class="todo-main"><strong>${escapeHTML(item.title)}</strong><span class="category-tag ${item.category}">${item.category === 'shopping' ? '🛒 購物' : '✓ 待辦'}</span></div>
      <div class="row-actions"><button class="mini-icon-button edit-todo" type="button" aria-label="修改"><svg><use href="#i-edit"></use></svg></button><button class="mini-icon-button danger delete-todo" type="button" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button></div>
    </article>`).join('');
  holder.querySelectorAll('.todo-item').forEach((row) => {
    const item = state.todos.find((x) => x.id === row.dataset.id);
    row.querySelector('.todo-check').addEventListener('change', async (e) => {
      try { await updateDoc(doc(todosRef, item.id), { completed: e.target.checked, updatedAt: serverTimestamp() }); } catch { showToast('未能更新項目'); }
    });
    row.querySelector('.edit-todo').addEventListener('click', () => openTodoDialog(item));
    row.querySelector('.delete-todo').addEventListener('click', async () => {
      if (!window.confirm(`刪除「${item.title}」？`)) return;
      try { await deleteDoc(doc(todosRef, item.id)); showToast('已刪除項目'); } catch { showToast('未能刪除項目'); }
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
  if (!privateAllowed()) {
    grid.innerHTML = '<div class="calendar-locked">🔒 登入及獲批後顯示家庭日曆</div>';
    document.getElementById('event-list').innerHTML = lockedHTML(authUser ? '等待管理員批准' : '登入後與家人共享日曆');
    document.getElementById('selected-date-title').textContent = '家庭日曆';
    return;
  }
  const first = new Date(viewYear, viewMonth, 1);
  const start = new Date(viewYear, viewMonth, 1 - first.getDay());
  const todayISO = toISODate(new Date());
  let html = '';
  for (let i = 0; i < 42; i++) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const iso = toISODate(date);
    const outside = date.getMonth() !== viewMonth;
    const hasEvents = state.events.some((event) => event.date === iso);
    html += `<button class="calendar-day ${outside ? 'outside' : ''} ${iso === todayISO ? 'today' : ''} ${iso === selectedDate ? 'selected' : ''}" type="button" data-date="${iso}">${date.getDate()}${hasEvents ? '<span class="event-dot"></span>' : ''}</button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.calendar-day').forEach((day) => day.addEventListener('click', () => {
    selectedDate = day.dataset.date;
    const d = fromISODate(selectedDate); viewYear = d.getFullYear(); viewMonth = d.getMonth(); renderCalendar();
  }));
  renderSelectedDayEvents();
}

function renderSelectedDayEvents() {
  if (!privateAllowed()) return;
  const date = fromISODate(selectedDate);
  const weekday = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()];
  document.getElementById('selected-date-title').textContent = `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
  const holder = document.getElementById('event-list');
  const events = state.events.filter((event) => event.date === selectedDate).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  if (!events.length) {
    holder.innerHTML = '<div class="empty-state"><span class="emoji">📅</span><strong>這日未有行程</strong><span>按「新增」加入家庭活動。</span></div>';
    return;
  }
  holder.innerHTML = events.map((event) => {
    const meta = EVENT_META[event.category] || EVENT_META.other;
    return `<div class="event-item" data-id="${escapeAttr(event.id)}"><div class="event-icon">${meta.emoji}</div><div class="event-main"><strong>${event.time ? escapeHTML(event.time) + '　' : ''}${escapeHTML(event.title)}</strong><small>${meta.label}</small></div><div class="row-actions"><button class="mini-icon-button edit-event" type="button" aria-label="修改"><svg><use href="#i-edit"></use></svg></button><button class="mini-icon-button danger delete-event" type="button" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button></div></div>`;
  }).join('');
  holder.querySelectorAll('.event-item').forEach((row) => {
    const event = state.events.find((x) => x.id === row.dataset.id);
    row.querySelector('.edit-event').addEventListener('click', () => openEventDialog(event));
    row.querySelector('.delete-event').addEventListener('click', async () => {
      if (!window.confirm(`刪除「${event.title}」？`)) return;
      try { await deleteDoc(doc(eventsRef, event.id)); showToast('已刪除行程'); } catch { showToast('未能刪除行程'); }
    });
  });
}

function openEventDialog(event = null) {
  if (!guardPrivateAction()) return;
  const dialog = document.getElementById('event-dialog');
  document.getElementById('event-dialog-title').textContent = event ? '修改家庭行程' : '新增家庭行程';
  document.getElementById('event-id').value = event?.id || '';
  document.getElementById('event-title').value = event?.title || '';
  document.getElementById('event-date').value = event?.date || selectedDate;
  document.getElementById('event-time').value = event?.time || '';
  document.getElementById('event-category').value = event?.category || 'family';
  dialog.showModal();
}

async function saveEventFromDialog() {
  if (!guardPrivateAction()) return;
  const id = document.getElementById('event-id').value;
  const title = document.getElementById('event-title').value.trim();
  const date = document.getElementById('event-date').value;
  const time = document.getElementById('event-time').value;
  const category = document.getElementById('event-category').value;
  if (!title || !date) return showToast('請輸入事項及日期');
  try {
    if (id) await updateDoc(doc(eventsRef, id), { title, date, time, category, updatedAt: serverTimestamp() });
    else await addDoc(eventsRef, { title, date, time, category, createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    selectedDate = date; const selected = fromISODate(date); viewYear = selected.getFullYear(); viewMonth = selected.getMonth();
    document.getElementById('event-dialog').close(); showToast(id ? '已更新行程' : '已新增行程');
  } catch { showToast('未能儲存行程'); }
}

function bindContactUI() {
  document.getElementById('add-contact-top').addEventListener('click', () => openContactDialog());
  document.getElementById('save-contact').addEventListener('click', saveContactFromDialog);
}

function renderContacts() {
  const holder = document.getElementById('contact-groups');
  if (!privateAllowed()) {
    holder.innerHTML = lockedHTML(authUser ? '等待管理員批准' : '登入後與家人共享實用資料');
    return;
  }
  const order = ['estate','medical','school','emergency','other'];
  const sections = order.map((category) => {
    const items = state.contacts.filter((c) => c.category === category);
    if (!items.length) return '';
    const meta = CATEGORY_META[category] || CATEGORY_META.other;
    return `<article class="card contact-card"><div class="contact-title ${meta.cls}"><svg><use href="#i-${meta.icon}"></use></svg>${meta.label}</div>${items.map(contactRowHTML).join('')}</article>`;
  }).join('');
  holder.innerHTML = sections || '<div class="empty-state"><span class="emoji">☎️</span><strong>未有實用資料</strong><span>按「新增」加入常用電話。</span></div>';
  holder.querySelectorAll('.contact-row').forEach((row) => {
    const item = state.contacts.find((x) => x.id === row.dataset.id);
    row.querySelector('.edit-contact')?.addEventListener('click', () => openContactDialog(item));
    row.querySelector('.delete-contact')?.addEventListener('click', async () => {
      if (item.id === 'emergency-999') return;
      if (!window.confirm(`刪除「${item.name}」？`)) return;
      try { await deleteDoc(doc(infoRef, item.id)); showToast('已刪除資料'); } catch { showToast('未能刪除資料'); }
    });
  });
}

function contactRowHTML(item) {
  const safePhone = String(item.phone || '').replace(/[^+\d]/g, '');
  const phoneLine = item.phone ? escapeHTML(item.phone) : '未設定電話';
  const addressLine = item.address ? `<small>${escapeHTML(item.address)}</small>` : '';
  const noteLine = item.note ? `<small>${escapeHTML(item.note)}</small>` : '';
  const call = item.phone ? `<a class="call-button" href="tel:${escapeAttr(safePhone)}"><svg><use href="#i-phone"></use></svg>撥打</a>` : '';
  const map = item.address ? `<a class="map-button" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}" target="_blank" rel="noopener" aria-label="開啟地圖"><svg><use href="#i-map"></use></svg></a>` : '';
  const deletable = item.id !== 'emergency-999';
  return `<div class="contact-row" data-id="${escapeAttr(item.id)}"><div><strong>${escapeHTML(item.name)}</strong><small>${phoneLine}</small>${addressLine}${noteLine}</div><div class="contact-actions">${map}${call}<button class="mini-icon-button edit-contact" type="button" aria-label="修改"><svg><use href="#i-edit"></use></svg></button>${deletable ? '<button class="mini-icon-button danger delete-contact" type="button" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button>' : ''}</div></div>`;
}

function openContactDialog(item = null) {
  if (!guardPrivateAction()) return;
  document.getElementById('contact-dialog-title').textContent = item ? '修改實用資料' : '新增實用資料';
  document.getElementById('contact-id').value = item?.id || '';
  document.getElementById('contact-category').value = item?.category || 'estate';
  document.getElementById('contact-name').value = item?.name || '';
  document.getElementById('contact-phone').value = item?.phone || '';
  document.getElementById('contact-address').value = item?.address || '';
  document.getElementById('contact-dialog').showModal();
}

async function saveContactFromDialog() {
  if (!guardPrivateAction()) return;
  const id = document.getElementById('contact-id').value;
  const category = document.getElementById('contact-category').value;
  const name = document.getElementById('contact-name').value.trim();
  const phone = document.getElementById('contact-phone').value.trim();
  const address = document.getElementById('contact-address').value.trim();
  if (!name) return showToast('請輸入名稱');
  try {
    if (id) await updateDoc(doc(infoRef, id), { category, name, phone, address, updatedAt: serverTimestamp() });
    else await addDoc(infoRef, { category, name, phone, address, note: '', sortOrder: 999, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    document.getElementById('contact-dialog').close(); showToast(id ? '已更新資料' : '已新增資料');
  } catch { showToast('未能儲存資料'); }
}

function bindMemberUI() {
  document.getElementById('member-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-member-action]');
    if (!button || !isAdmin()) return;
    const uid = button.dataset.uid;
    const action = button.dataset.memberAction;
    if (action === 'approve') await approveMember(uid);
    if (action === 'reject') await rejectRequest(uid);
    if (action === 'remove') await removeMember(uid);
  });
}

function renderMemberPanel() {
  const panel = document.getElementById('family-members-card');
  const list = document.getElementById('member-list');
  if (!panel || !list) return;
  panel.hidden = !authUser;
  if (!authUser) return;
  if (!privateAllowed()) {
    list.innerHTML = `<div class="member-status"><strong>${pendingRequest ? '等待管理員批准' : '正在檢查家庭成員資格…'}</strong><span>${escapeHTML(authUser.email || '')}</span></div>`;
    return;
  }
  if (!isAdmin()) {
    list.innerHTML = `<div class="member-status approved"><strong>已加入家庭</strong><span>${escapeHTML(authUser.email || '')}</span></div>`;
    return;
  }
  listenAdminMembers();
}

let adminPanelUnsubs = [];
function stopAdminPanelListeners() { adminPanelUnsubs.forEach((unsub) => unsub()); adminPanelUnsubs = []; }
function listenAdminMembers() {
  if (adminPanelUnsubs.length) return;
  let approved = [];
  let pending = [];
  const render = () => {
    const list = document.getElementById('member-list');
    if (!list) return;
    const pendingHTML = pending.map((u) => `<div class="member-row"><div><strong>${escapeHTML(u.displayName || u.email || '新成員')}</strong><small>${escapeHTML(u.email || '')} · 等待批准</small></div><div class="member-actions"><button data-member-action="approve" data-uid="${escapeAttr(u.uid)}" class="small-button">批准</button><button data-member-action="reject" data-uid="${escapeAttr(u.uid)}" class="small-button danger-outline">拒絕</button></div></div>`).join('');
    const approvedHTML = approved.map((u) => `<div class="member-row"><div><strong>${escapeHTML(u.displayName || u.email || '家庭成員')}</strong><small>${escapeHTML(u.email || '')} · ${u.role === 'admin' ? '管理員' : '成員'}</small></div>${u.uid !== authUser.uid ? `<button data-member-action="remove" data-uid="${escapeAttr(u.uid)}" class="small-button danger-outline">移除</button>` : ''}</div>`).join('');
    list.innerHTML = `${pendingHTML ? `<h3>等待批准</h3>${pendingHTML}` : ''}<h3>已批准成員</h3>${approvedHTML || '<p class="muted">暫未有其他成員</p>'}`;
  };
  adminPanelUnsubs.push(onSnapshot(requestsRef, (snap) => { pending = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status === 'pending'); render(); }));
  adminPanelUnsubs.push(onSnapshot(membersRef, (snap) => { approved = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status === 'approved'); render(); }));
}

async function approveMember(uid) {
  try {
    const reqRef = doc(requestsRef, uid);
    const req = await getDoc(reqRef);
    if (!req.exists()) return showToast('找不到申請');
    const data = req.data();
    const batch = writeBatch(db);
    batch.set(doc(membersRef, uid), { uid, email: data.email || '', displayName: data.displayName || '', photoURL: data.photoURL || '', role: 'member', status: 'approved', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.delete(reqRef);
    await batch.commit();
    showToast('已批准家庭成員');
  } catch { showToast('未能批准成員'); }
}

async function rejectRequest(uid) {
  if (!window.confirm('拒絕這個加入家庭的申請？')) return;
  try { await deleteDoc(doc(requestsRef, uid)); showToast('已拒絕申請'); } catch { showToast('未能拒絕申請'); }
}

async function removeMember(uid) {
  if (!window.confirm('移除這位家庭成員？對方之後可再次申請。')) return;
  try { await deleteDoc(doc(membersRef, uid)); showToast('已移除家庭成員'); } catch { showToast('未能移除成員'); }
}

function bindBackupUI() {
  document.getElementById('export-data').addEventListener('click', () => {
    if (!guardPrivateAction()) return;
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
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
    if (!file || !guardPrivateAction()) return;
    try {
      const parsed = JSON.parse(await file.text()); const imported = parsed.data || parsed;
      if (!Array.isArray(imported.todos) || !Array.isArray(imported.events) || !Array.isArray(imported.contacts)) throw new Error('Invalid backup');
      if (!window.confirm('將備份資料加入目前家庭雲端？現有資料不會自動刪除。')) return;
      await importLegacy(imported); showToast('已匯入家庭雲端');
    } catch { showToast('備份檔案格式不正確'); } finally { event.target.value = ''; }
  });
}

function renderAll() {
  renderTodos(); renderCalendar(); renderContacts(); renderHomeSummary(); renderAuthState(); renderMemberPanel(); renderConnectionState(); renderAnnouncements();
}

function renderHomeSummary() {
  if (!privateAllowed()) {
    document.getElementById('home-todo-count').textContent = '—';
    document.getElementById('home-todo-note').textContent = authUser ? '等待批准' : '登入後顯示';
    document.getElementById('home-event-count').textContent = '—';
    document.getElementById('home-next-event').textContent = authUser ? '等待批准' : '登入後顯示';
    return;
  }
  const pending = state.todos.filter((t) => !t.completed).length;
  const completed = state.todos.filter((t) => t.completed).length;
  document.getElementById('home-todo-count').textContent = pending;
  document.getElementById('home-todo-note').textContent = pending ? `${completed} 項已完成` : '全部完成';
  const today = toISODate(new Date());
  const todaysEvents = state.events.filter((e) => e.date === today).sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  document.getElementById('home-event-count').textContent = todaysEvents.length;
  const next = todaysEvents.find((e) => !e.time || `${today}T${e.time}` >= localDateTimeKey(new Date())) || todaysEvents[0];
  document.getElementById('home-next-event').textContent = next ? `${next.time ? next.time + ' ' : ''}${next.title}` : '今日未有活動';
}

function updateDateAndGreeting() {
  const date = new Date();
  const weekday = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()];
  document.getElementById('home-date').textContent = `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 ${weekday}`;
  const hour = date.getHours();
  const title = hour < 12 ? '早晨！' : hour < 18 ? '午安！' : '晚上好！';
  document.getElementById('greeting-title').textContent = title;
  document.getElementById('greeting-icon').textContent = hour < 18 ? '☀️' : '🌙';
}

async function loadWeather() {
  const tempEl = document.getElementById('weather-temp'); const noteEl = document.getElementById('weather-note');
  try {
    const response = await fetchWithTimeout(HKO_CURRENT, 9000); if (!response.ok) throw new Error(`HTTP ${response.status}`); const data = await response.json();
    const temps = data.temperature?.data || []; const preferred = temps.find((x) => String(x.place).includes('沙田')) || temps.find((x) => String(x.place).includes('香港天文台')) || temps[0];
    if (preferred?.value != null) tempEl.textContent = `${Math.round(preferred.value)}°C`;
    const humidity = data.humidity?.data?.[0]?.value; noteEl.textContent = humidity != null ? `濕度 ${humidity}% · 天文台` : '香港天文台';
    document.getElementById('weather-icon').textContent = weatherEmoji(data.icon?.[0]);
  } catch { tempEl.textContent = '--°C'; noteEl.textContent = '暫時未能取得天氣'; }
}

async function loadBusETA({ quiet = false } = {}) {
  const updated = document.getElementById('bus-updated'); const dot = document.getElementById('bus-status-dot');
  if (!quiet) { dot.className = 'status-dot loading'; updated.textContent = '正在更新巴士資料…'; renderBusSkeleton(); }
  const results = await Promise.all(ROUTES.map(loadOneRoute));
  renderBusResults(results);
  const successful = results.some((r) => !r.error);
  const dt = new Date();
  updated.textContent = successful ? `資料更新：${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '暫時未能取得實時資料，請稍後再試';
  dot.className = successful ? 'status-dot' : 'status-dot error';
}

async function loadOneRoute(config) {
  const [kmbResult, citybusResult] = await Promise.all([
    loadKmbEtas(config),
    config.jointCitybus ? loadCitybusEtas(config) : Promise.resolve({ etas: [], failed: false }),
  ]);
  const etas = dedupeEtas([...kmbResult.etas, ...citybusResult.etas]).sort((a,b) => a.etaDate - b.etaDate).slice(0,3);
  return { ...config, etas, error: kmbResult.failed && citybusResult.failed };
}

async function loadKmbEtas(config) {
  try {
    const etaResp = await fetchWithTimeout(`${KMB_BASE}/eta/${encodeURIComponent(config.stopId)}/${encodeURIComponent(config.route)}/${encodeURIComponent(config.serviceType)}`, 9000);
    if (!etaResp.ok) throw new Error(`ETA HTTP ${etaResp.status}`);
    const etaData = (await etaResp.json()).data || [];
    const etas = etaData.filter((x) => x.eta && (!x.dir || x.dir === config.bound)).map((x) => ({ ...x, source: 'KMB', etaDate: new Date(x.eta) })).filter(validFutureEta);
    return { etas, failed: false };
  } catch (error) {
    console.warn(`KMB ${config.route} ETA error`, error);
    return { etas: [], failed: true };
  }
}

async function loadCitybusEtas(config) {
  try {
    const etaResp = await fetchWithTimeout(`${CTB_BASE}/eta/CTB/${encodeURIComponent(config.citybusStopId)}/${encodeURIComponent(config.route)}`, 8000);
    if (!etaResp.ok) throw new Error(`ETA HTTP ${etaResp.status}`);
    const etaData = (await etaResp.json()).data || [];
    const etas = etaData
      .filter((x) => x.eta && matchesCitybusDirection(x, config))
      .map((x) => ({ ...x, source: 'CTB', etaDate: new Date(x.eta) }))
      .filter(validFutureEta);
    return { etas, failed: false };
  } catch (error) {
    console.warn(`Citybus ${config.route} ETA error`, error);
    return { etas: [], failed: true };
  }
}

function matchesCitybusDirection(item, config) {
  if (item.dir && item.dir !== config.citybusBound) return false;
  const destination = `${item.dest_tc || ''} ${item.dest_en || ''}`.trim().toUpperCase();
  if (!destination) return true;
  return destination.includes(config.citybusDestTc) || destination.includes(config.citybusDestEn);
}

function validFutureEta(item) { return !Number.isNaN(item.etaDate.getTime()) && item.etaDate.getTime() > Date.now() - 90_000; }
function dedupeEtas(items) { const sorted = items.sort((a,b) => a.etaDate - b.etaDate); const result = []; for (const item of sorted) if (!result.some((x) => x.source === item.source && Math.abs(x.etaDate - item.etaDate) < 45_000)) result.push(item); return result; }
function renderBusSkeleton() { document.getElementById('bus-list').innerHTML = ROUTES.map((r) => `<div class="bus-row"><span class="route-badge">${r.route}</span><div class="route-destination"><strong>${r.dest}</strong><small>站：${r.stopCode}</small></div><span class="eta-none">載入中…</span></div>`).join(''); }
function renderBusResults(results) { document.getElementById('bus-list').innerHTML = results.map((r) => { const eta = r.error ? '<span class="eta-none">未能更新</span>' : r.etas.length ? `<div class="eta-list">${r.etas.map((x) => `<span class="eta-pill"><span class="eta-operator ${x.source === 'CTB' ? 'ctb' : 'kmb'}">${x.source === 'CTB' ? '城巴' : '九巴'}</span>${formatETA(x.etaDate)}</span>`).join('')}</div>` : '<span class="eta-none">暫無班次</span>'; return `<div class="bus-row"><span class="route-badge">${r.route}</span><div class="route-destination"><strong>${r.dest}</strong><small>${r.jointCitybus ? '九巴＋城巴 · ' : '九巴 · '}站 ${r.stopCode}</small></div>${eta}</div>`; }).join(''); }
function formatETA(date) { const mins = Math.max(0, Math.round((date.getTime() - Date.now()) / 60000)); return mins <= 1 ? '即將到站' : `${mins} 分鐘`; }
function weatherEmoji(iconNo) { const n = Number(iconNo); if ([50,51].includes(n)) return '☀️'; if ([52,53].includes(n)) return '🌤️'; if ([54,55,56,57,58,59,60,61,62,63,64].includes(n)) return '☁️'; if ([65,66,67,68,69,70,71,72,73,74,75,76,77].includes(n)) return '🌧️'; if ([80,81,82].includes(n)) return '🌫️'; if ([90,91,92,93].includes(n)) return '🌙'; return '🌤️'; }

function setPrivateButtonsEnabled(enabled) {
  ['add-todo-top','add-todo-fab','add-event-top','add-event-inline','add-contact-top','export-data','import-data'].forEach((id) => {
    const el = document.getElementById(id); if (!el) return; if ('disabled' in el) el.disabled = !enabled; el.classList.toggle('disabled', !enabled);
  });
}
function lockedHTML(message) { return `<div class="empty-state locked-state"><span class="emoji">🔒</span><strong>${escapeHTML(message)}</strong><span>家庭資料只供已批准成員使用。</span></div>`; }
function sortByCreatedDesc(a,b) { const av = a.createdAt?.seconds || 0; const bv = b.createdAt?.seconds || 0; return bv - av; }
function toISODate(date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function fromISODate(value) { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }
function localDateTimeKey(date) { return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function pad(value) { return String(value).padStart(2,'0'); }
async function fetchWithTimeout(url, ms) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); try { return await fetch(url, { signal: controller.signal, cache: 'no-store' }); } finally { clearTimeout(timer); } }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
function escapeAttr(value) { return escapeHTML(value); }
function showToast(message) { const toast = document.getElementById('toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
