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
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { createBackup, validateBackup, MAX_BACKUP_BYTES } from './backup-utils.js';
import { popupLoginAction } from './auth-utils.js';
import { createTransportController } from './transport-controller.js';

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
const THEME_PREFERENCE_KEY = 'family-helper-theme-preference';
const DASHBOARD_PREFERENCE_KEY = 'family-helper-dashboard-preference';
const HKO_CURRENT = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc';

// Human-readable stop code -> KMB Open Data 16-character stop ID.
// These are deliberately fixed so the app does not guess a direction or platform.
const DEFAULT_ROUTES = [
  { route: '980X', dest: '菲林明道', stopCode: 'MA952', stopId: '15FF958BE6921BAA', bound: 'O', serviceType: '1', jointCitybus: true, citybusStopId: '001950', citybusBound: 'O', citybusDestTc: '灣仔', citybusDestEn: 'WAN CHAI' },
  { route: '681', dest: '中環（香港站）', stopCode: 'MA954', stopId: 'BA6D9F93E62B8075', bound: 'I', serviceType: '1', jointCitybus: true, citybusStopId: '001950', citybusBound: 'I', citybusDestTc: '中環', citybusDestEn: 'CENTRAL' },
  { route: '680', dest: '金鐘', stopCode: 'MA952', stopId: '15FF958BE6921BAA', bound: 'O', serviceType: '1', jointCitybus: true, citybusStopId: '001950', citybusBound: 'I', citybusDestTc: '金鐘', citybusDestEn: 'ADMIRALTY' },
  { route: '87D', dest: '紅磡站', stopCode: 'MA303', stopId: '013F884CBCB1CBE4', bound: 'O', serviceType: '1' },
  { route: '89D', dest: '藍田站', stopCode: 'MA310', stopId: '76E8D8C73E0B8096', bound: 'O', serviceType: '1' },
  { route: '89P', dest: '藍田站', stopCode: 'MA310', stopId: '76E8D8C73E0B8096', bound: 'O', serviceType: '1' },
];
let dashboardPreferences = readDashboardPreferences();

const CATEGORY_META = {
  estate: { label: '屋苑', icon: 'building', cls: 'estate' },
  medical: { label: '醫療', icon: 'heart', cls: 'medical' },
  company: { label: '公司', icon: 'briefcase', cls: 'company' },
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
const notesRef = collection(familyRef, 'notes');
const remindersRef = collection(familyRef, 'reminders');
const expensesRef = collection(familyRef, 'expenses');

let state = { todos: [], events: [], contacts: [], notes: [], reminders: [], expenses: [] };
let announcements = [];
let announcementAccessError = false;
let announcementUnsub = null;
let authUser = null;
let member = null;
let pendingRequest = null;
let sharedUnsubs = [];
let memberUnsubs = [];
let adminPanelError = '';
let currentPage = 'home';
let todoFilter = 'all';
let contactQuery = '';
let clockTimer = null;
const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();
let selectedDate = toISODate(now);
let expenseViewYear = now.getFullYear();
let expenseViewMonth = now.getMonth();
let toastTimer = null;
let networkOnline = navigator.onLine;
const systemDarkMode = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
let themePreference = readThemePreference();

const privateAllowed = () => Boolean(authUser && member?.status === 'approved');
const isAdmin = () => privateAllowed() && member?.role === 'admin';
const transportSnapshots = new Map();

const transportController = createTransportController({
  subscribe(uid, next, error) {
    const metadataRef = doc(membersRef, uid, 'transport', 'preferences');
    const refs = {
      routes: collection(metadataRef, 'routes'),
      stops: collection(metadataRef, 'stops'),
      mtr: collection(metadataRef, 'mtr'),
    };
    const value = { metadata: null, routes: [], stops: [], mtr: [] };
    const ready = new Set();
    const publish = (key) => {
      ready.add(key);
      if (ready.size !== 4) return;
      const aggregate = { ...(value.metadata || {}), routes: value.routes, stops: value.stops, mtr: value.mtr };
      transportSnapshots.set(uid, aggregate);
      next(aggregate);
    };
    const unsubs = [
      onSnapshot(metadataRef, (snapshot) => { value.metadata = snapshot.exists() ? snapshot.data() : null; publish('metadata'); }, error),
      ...Object.entries(refs).map(([key, ref]) => onSnapshot(ref, (snapshot) => {
        value[key] = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
        publish(key);
      }, error)),
    ];
    return () => { unsubs.forEach((stop) => stop()); transportSnapshots.delete(uid); };
  },
  async mutate(uid, transform) {
    const ref = doc(membersRef, uid, 'transport', 'preferences');
    const remote = transportSnapshots.get(uid) || null;
    const prepared = transform(remote);
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const currentRevision = Number(snapshot.data()?.revision) || 0;
      if (currentRevision !== (Number(remote?.revision) || 0)) throw new Error('transport-preference-conflict');
      const revision = currentRevision + 1;
      const payload = { schemaVersion: 1, revision, interval: prepared.interval, showOnHome: prepared.showOnHome, updatedAt: serverTimestamp() };
      if (!snapshot.exists()) payload.createdAt = serverTimestamp();
      else payload.createdAt = snapshot.data().createdAt;
      transaction.set(ref, payload);
      for (const key of ['routes', 'stops', 'mtr']) {
        const previous = new Map((remote?.[key] || []).map((item) => [item.id, item]));
        const nextItems = new Map((prepared[key] || []).map((item) => [item.id, item]));
        const itemsRef = collection(ref, key);
        for (const id of previous.keys()) if (!nextItems.has(id)) transaction.delete(doc(itemsRef, id));
        for (const [id, item] of nextItems) transaction.set(doc(itemsRef, id), item);
      }
      const result = { ...payload, routes: prepared.routes, stops: prepared.stops, mtr: prepared.mtr, createdAt: snapshot.data()?.createdAt, updatedAt: new Date() };
      transportSnapshots.set(uid, result);
      return result;
    });
  },
  legacyRoutes: () => dashboardPreferences.routes.map((routeName) => DEFAULT_ROUTES.find((route) => route.route === routeName)).filter(Boolean).map((route) => ({ ...route, operator: 'KMB', direction: route.bound, stopName: route.stopCode, destination: route.dest })),
  privateAllowed,
  showToast,
  switchPage,
});

window.addEventListener('DOMContentLoaded', init);

function init() {
  applyTheme();
  bindNavigation();
  bindTodoUI();
  bindCalendarUI();
  bindContactUI();
  bindBackupUI();
  bindHomeUI();
  bindAuthUI();
  bindMemberUI();
  bindAnnouncementUI();
  bindDialogCancelUI();
  bindThemeUI();
  bindDashboardSettings();
  bindNotesUI();
  bindRemindersUI();
  bindExpensesUI();
  bindConfirmUI();
  transportController.bind();
  updateDateAndGreeting();
  clockTimer = window.setInterval(updateDateAndGreeting, 30_000);
  renderAll();
  loadWeather();
  startAnnouncementListener();
  window.addEventListener('online', () => { networkOnline = true; renderConnectionState(); });
  window.addEventListener('offline', () => { networkOnline = false; renderConnectionState(); });
  onAuthStateChanged(auth, handleAuthState, (error) => { console.error('Auth state:', error); showToast('登入狀態讀取失敗'); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').then((registration) => registration.update()).catch(() => {});
  }
}

function readThemePreference() {
  try {
    const value = localStorage.getItem(THEME_PREFERENCE_KEY);
    return ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function readDashboardPreferences() {
  const defaults = { modules: { reminders: true, notes: true }, routes: DEFAULT_ROUTES.map((route) => route.route) };
  try {
    const saved = JSON.parse(localStorage.getItem(DASHBOARD_PREFERENCE_KEY) || 'null');
    return {
      modules: { ...defaults.modules, ...(saved?.modules || {}) },
      routes: Array.isArray(saved?.routes) && saved.routes.length ? saved.routes.filter((route) => defaults.routes.includes(route)) : defaults.routes,
    };
  } catch { return defaults; }
}

function saveDashboardPreferences() {
  try { localStorage.setItem(DASHBOARD_PREFERENCE_KEY, JSON.stringify(dashboardPreferences)); } catch {}
  renderDashboardSettings();
  renderHomeSummary();
}

function bindThemeUI() {
  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.addEventListener('click', () => {
      themePreference = button.dataset.themeOption;
      try { localStorage.setItem(THEME_PREFERENCE_KEY, themePreference); } catch {}
      applyTheme();
    });
  });
  const onSystemThemeChange = () => {
    if (themePreference === 'auto') applyTheme();
  };
  if (systemDarkMode.addEventListener) systemDarkMode.addEventListener('change', onSystemThemeChange);
  else if (systemDarkMode.addListener) systemDarkMode.addListener(onSystemThemeChange);
  renderThemePreference();
}

function applyTheme() {
  const effectiveTheme = themePreference === 'auto' ? (systemDarkMode.matches ? 'dark' : 'light') : themePreference;
  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.style.colorScheme = effectiveTheme;
  document.body?.setAttribute('data-theme', effectiveTheme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effectiveTheme === 'dark' ? '#121722' : '#f4f7fb');
  renderThemePreference();
}

function renderThemePreference() {
  const effectiveTheme = document.documentElement.dataset.theme || 'light';
  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    const selected = button.dataset.themeOption === themePreference;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const note = document.getElementById('theme-note');
  if (note) note.textContent = themePreference === 'auto' ? `跟隨裝置設定（目前：${effectiveTheme === 'dark' ? '夜間' : '日間'}）` : `目前使用${effectiveTheme === 'dark' ? '夜間' : '日間'}模式`;
}

function bindNavigation() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.setAttribute('aria-current', button.dataset.nav === currentPage ? 'page' : 'false');
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
  document.querySelectorAll('.nav-item').forEach((b) => b.setAttribute('aria-current', b.dataset.nav === page ? 'page' : 'false'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'calendar') renderCalendar();
  if (page === 'info') renderContacts();
  if (page === 'settings') { renderAuthState(); renderMemberPanel(); renderAnnouncements(); }
  if (page === 'todos') renderTodos();
  if (page === 'expenses') renderExpenses();
  transportController.setPage(page);
}

function bindHomeUI() {
  document.querySelectorAll('[data-quick-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.quickAction;
    if (action === 'todo') openTodoDialog();
    if (action === 'event') openEventDialog();
    if (action === 'contact') switchPage('info');
    if (action === 'note') openNoteDialog();
    if (action === 'reminder') openReminderDialog();
    if (action === 'expense') openExpenseDialog();
  }));
}

function bindDashboardSettings() {
  document.querySelectorAll('[data-module-toggle]').forEach((input) => input.addEventListener('change', () => {
    if (input.dataset.moduleToggle === 'transport') {
      transportController.setShowOnHome(input.checked);
      return;
    }
    dashboardPreferences.modules[input.dataset.moduleToggle] = input.checked;
    saveDashboardPreferences();
  }));
  renderDashboardSettings();
}

function renderDashboardSettings() {
  document.querySelectorAll('[data-home-module]').forEach((module) => { module.hidden = dashboardPreferences.modules[module.dataset.homeModule] === false; });
  document.querySelectorAll('[data-module-toggle]').forEach((input) => { input.checked = input.dataset.moduleToggle === 'transport' ? transportController.getShowOnHome() : dashboardPreferences.modules[input.dataset.moduleToggle] !== false; });
}

function bindAnnouncementUI() {
  document.getElementById('add-announcement').addEventListener('click', () => {
    if (!isAdmin()) return showToast('只有家庭管理員可以發佈公告');
    document.getElementById('announcement-message').value = '';
    document.getElementById('announcement-dialog').showModal();
    setTimeout(() => document.getElementById('announcement-message').focus(), 50);
  });
  document.getElementById('save-announcement').addEventListener('click', publishAnnouncement);
  document.getElementById('delete-announcement').addEventListener('click', () => {
    const latest = announcements[0];
    if (latest) deleteAnnouncement(latest.id);
  });
}

function bindDialogCancelUI() {
  document.querySelectorAll('[data-dialog-cancel]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close('cancel'));
  });
}

function startAnnouncementListener() {
  announcementUnsub?.();
  announcementUnsub = onSnapshot(announcementsRef, (snap) => {
    announcementAccessError = false;
    announcements = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAtMs || b.createdAt?.seconds || 0) - (a.createdAtMs || a.createdAt?.seconds || 0));
    renderAnnouncements();
  }, (error) => {
    announcementAccessError = error.code === 'permission-denied';
    console.warn('Announcement listener unavailable. Publish firestore.rules to enable public announcements.', error.code);
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
    showToast(error.code === 'permission-denied' ? '未能發佈公告：請先發布 Firestore 規則' : '未能發佈公告');
  }
}

async function deleteAnnouncement(id) {
  if (!isAdmin() || !await confirmAction('刪除這則公告？', '取消公告')) return;
  try {
    await deleteDoc(doc(announcementsRef, id));
    showToast('公告已刪除');
  } catch (error) {
    console.error('Delete announcement:', error);
    showToast(error.code === 'permission-denied' ? '未能取消公告：請先發布 Firestore 規則' : '未能取消公告');
  }
}

function renderAnnouncements() {
  const latest = announcements[0];
  document.querySelectorAll('[data-announcement-slot]').forEach((slot) => {
    slot.hidden = !latest;
    slot.innerHTML = latest ? `<aside class="announcement-banner" role="status"><span class="announcement-icon">📣</span><div><strong>全家公告</strong><p>${escapeHTML(latest.message)}</p></div></aside>` : '';
  });
  document.getElementById('announcement-admin-card').hidden = !isAdmin();
  const cancelCard = document.getElementById('announcement-cancel-card');
  cancelCard.hidden = !isAdmin() || !latest;
  document.getElementById('announcement-current-message').textContent = latest?.message || '';
  const adminStatus = document.getElementById('announcement-admin-status');
  if (adminStatus) adminStatus.textContent = announcementAccessError
    ? '公告目前被 Firestore 規則封鎖。請在 Firebase Console 發布 firestore.rules。'
    : '所有訪客即使未登入也能看到最新公告。';
}

function bindAuthUI() {
  document.getElementById('google-login').addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const action = popupLoginAction(error.code);
      if (action === 'cancel') return;
      if (action === 'error') {
        console.warn('Popup login failed', error);
        showToast('Google 登入失敗，請稍後再試');
        return;
      }
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
  transportController.setIdentity(user, false);
  member = null;
  pendingRequest = null;
  state = { todos: [], events: [], contacts: [], notes: [], reminders: [], expenses: [] };

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
      transportController.setIdentity(user, true);
    } else {
      transportController.setIdentity(user, false);
      stopSharedListeners();
      state = { todos: [], events: [], contacts: [], notes: [], reminders: [], expenses: [] };
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
  sharedUnsubs.push(onSnapshot(notesRef, (snap) => {
    state.notes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortByCreatedDesc);
    renderHomeSummary();
  }, cloudListenerError));
  sharedUnsubs.push(onSnapshot(remindersRef, (snap) => {
    state.reminders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderHomeSummary();
  }, cloudListenerError));
  sharedUnsubs.push(onSnapshot(expensesRef, (snap) => {
    state.expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderExpenses();
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
    ['company', { category: 'company', name: '公司', phone: '', address: '', note: '', sortOrder: 40 }],
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
  const accepted = await confirmAction('發現舊有本機資料，是否匯入家庭雲端？', '匯入舊資料');
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
  const writes = [];
  (data.todos || []).forEach((item) => {
    const ref = doc(todosRef);
    writes.push((batch) => batch.set(ref, { title: item.text || item.title || '', category: item.category || 'todo', completed: Boolean(item.done ?? item.completed), createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  (data.events || []).forEach((item) => {
    const ref = doc(eventsRef);
    writes.push((batch) => batch.set(ref, { title: item.title || '', date: item.date || toISODate(new Date()), time: item.time || '', category: item.category || 'other', repeat: item.repeat || 'none', createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  (data.contacts || []).filter((c) => c.name).forEach((item) => {
    const ref = item.id === 'emergency-999' ? doc(infoRef, 'emergency-999') : doc(infoRef);
    writes.push((batch) => batch.set(ref, { category: item.category || 'other', name: item.name, phone: item.phone || '', address: item.address || '', note: item.note || '', sortOrder: item.sortOrder ?? 999, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
  });
  (data.notes || []).filter((item) => item.title).forEach((item) => {
    writes.push((batch) => batch.set(doc(notesRef), { title: item.title, content: item.content || '', createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  (data.reminders || []).filter((item) => item.title && item.dueDate).forEach((item) => {
    writes.push((batch) => batch.set(doc(remindersRef), { title: item.title, dueDate: item.dueDate, repeat: item.repeat || 'none', leadDays: Number(item.leadDays || 0), createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  (data.expenses || []).filter((item) => item.title && item.date && item.amountCents).forEach((item) => {
    writes.push((batch) => batch.set(doc(expensesRef), { title: item.title, amountCents: Number(item.amountCents), currency: 'HKD', date: item.date, category: item.category || 'other', paidBy: item.paidBy || '', note: item.note || '', createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  for (let start = 0; start < writes.length; start += 400) {
    const batch = writeBatch(db);
    writes.slice(start, start + 400).forEach((write) => write(batch));
    await batch.commit();
  }
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
  const filtered = state.todos.filter((item) => !item.completed && (todoFilter === 'all' || item.category === todoFilter));
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
      try { await updateDoc(doc(todosRef, item.id), { completed: e.target.checked, updatedAt: serverTimestamp() }); } catch { renderTodos(); renderHomeSummary(); showToast('未能更新項目'); }
    });
    row.querySelector('.edit-todo').addEventListener('click', () => openTodoDialog(item));
    row.querySelector('.delete-todo').addEventListener('click', async () => {
      if (!await confirmAction(`刪除「${item.title}」？`, '刪除清單項目')) return;
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
    const hasEvents = eventsForDate(iso).length > 0;
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
  const events = eventsForDate(selectedDate).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  if (!events.length) {
    holder.innerHTML = '<div class="empty-state"><span class="emoji">📅</span><strong>這日未有行程</strong><span>按「新增」加入家庭活動。</span></div>';
    return;
  }
  holder.innerHTML = events.map((event) => {
    const meta = EVENT_META[event.category] || EVENT_META.other;
    return `<div class="event-item" data-id="${escapeAttr(event.id)}"><div class="event-icon">${meta.emoji}</div><div class="event-main"><strong>${event.time ? escapeHTML(event.time) + '　' : ''}${escapeHTML(event.title)}</strong><small>${meta.label}${event.repeat && event.repeat !== 'none' ? ` · ${repeatLabel(event.repeat)}` : ''}</small></div><div class="row-actions"><button class="mini-icon-button edit-event" type="button" aria-label="修改"><svg><use href="#i-edit"></use></svg></button><button class="mini-icon-button danger delete-event" type="button" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button></div></div>`;
  }).join('');
  holder.querySelectorAll('.event-item').forEach((row) => {
    const event = state.events.find((x) => x.id === row.dataset.id);
    row.querySelector('.edit-event').addEventListener('click', () => openEventDialog(event));
    row.querySelector('.delete-event').addEventListener('click', async () => {
      if (!await confirmAction(`刪除「${event.title}」？`, '刪除行程')) return;
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
  document.getElementById('event-repeat').value = event?.repeat || 'none';
  dialog.showModal();
}

async function saveEventFromDialog() {
  if (!guardPrivateAction()) return;
  const id = document.getElementById('event-id').value;
  const title = document.getElementById('event-title').value.trim();
  const date = document.getElementById('event-date').value;
  const time = document.getElementById('event-time').value;
  const category = document.getElementById('event-category').value;
  const repeat = document.getElementById('event-repeat').value;
  if (!title || !date) return showToast('請輸入事項及日期');
  try {
    if (id) await updateDoc(doc(eventsRef, id), { title, date, time, category, repeat, updatedAt: serverTimestamp() });
    else await addDoc(eventsRef, { title, date, time, category, repeat, createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    selectedDate = date; const selected = fromISODate(date); viewYear = selected.getFullYear(); viewMonth = selected.getMonth();
    document.getElementById('event-dialog').close(); showToast(id ? '已更新行程' : '已新增行程');
  } catch { showToast('未能儲存行程'); }
}

function bindContactUI() {
  document.getElementById('add-contact-top').addEventListener('click', () => openContactDialog());
  document.getElementById('save-contact').addEventListener('click', saveContactFromDialog);
  document.getElementById('contact-search').addEventListener('input', (event) => {
    contactQuery = event.target.value.trim().toLocaleLowerCase('zh-Hant');
    renderContacts();
  });
}

function renderContacts() {
  const holder = document.getElementById('contact-groups');
  if (!privateAllowed()) {
    holder.innerHTML = lockedHTML(authUser ? '等待管理員批准' : '登入後與家人共享實用資料');
    return;
  }
  const visibleContacts = contactQuery
    ? state.contacts.filter((item) => [item.name, item.phone, item.address, item.note].some((value) => String(value || '').toLocaleLowerCase('zh-Hant').includes(contactQuery)))
    : state.contacts;
  const order = ['estate','medical','company','emergency','other'];
  const sections = order.map((category) => {
    const items = visibleContacts.filter((c) => contactCategory(c.category) === category);
    if (!items.length) return '';
    const meta = CATEGORY_META[category] || CATEGORY_META.other;
    return `<article class="card contact-card"><div class="contact-title ${meta.cls}"><svg><use href="#i-${meta.icon}"></use></svg>${meta.label}</div>${items.map(contactRowHTML).join('')}</article>`;
  }).join('');
  holder.innerHTML = sections || (contactQuery
    ? '<div class="empty-state"><span class="emoji">🔎</span><strong>找不到相符資料</strong><span>試試其他名稱、電話或地址。</span></div>'
    : '<div class="empty-state"><span class="emoji">☎️</span><strong>未有實用資料</strong><span>按「新增」加入常用電話。</span></div>');
  holder.querySelectorAll('.contact-row').forEach((row) => {
    const item = state.contacts.find((x) => x.id === row.dataset.id);
    row.querySelector('.edit-contact')?.addEventListener('click', () => openContactDialog(item));
    row.querySelector('.delete-contact')?.addEventListener('click', async () => {
      if (item.id === 'emergency-999') return;
      if (!await confirmAction(`刪除「${item.name}」？`, '刪除實用資料')) return;
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

function contactCategory(category) {
  return category === 'school' ? 'company' : category;
}

function openContactDialog(item = null) {
  if (!guardPrivateAction()) return;
  document.getElementById('contact-dialog-title').textContent = item ? '修改實用資料' : '新增實用資料';
  document.getElementById('contact-id').value = item?.id || '';
  document.getElementById('contact-category').value = contactCategory(item?.category || 'estate');
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

function bindNotesUI() {
  document.getElementById('save-note').addEventListener('click', saveNoteFromDialog);
  document.getElementById('home-notes').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-note-action]');
    if (!button) return;
    const note = state.notes.find((item) => item.id === button.dataset.id);
    if (!note) return;
    if (button.dataset.noteAction === 'edit') openNoteDialog(note);
    if (button.dataset.noteAction === 'delete' && await confirmAction(`刪除筆記「${note.title}」？`, '刪除筆記')) {
      try { await deleteDoc(doc(notesRef, note.id)); showToast('已刪除筆記'); } catch { showToast('未能刪除筆記'); }
    }
  });
}

function openNoteDialog(note = null) {
  if (!guardPrivateAction()) return;
  document.getElementById('note-dialog-title').textContent = note ? '修改家庭筆記' : '新增家庭筆記';
  document.getElementById('note-id').value = note?.id || '';
  document.getElementById('note-title').value = note?.title || '';
  document.getElementById('note-content').value = note?.content || '';
  document.getElementById('note-dialog').showModal();
  setTimeout(() => document.getElementById('note-title').focus(), 50);
}

async function saveNoteFromDialog() {
  if (!guardPrivateAction()) return;
  const id = document.getElementById('note-id').value;
  const title = document.getElementById('note-title').value.trim();
  const content = document.getElementById('note-content').value.trim();
  if (!title) return showToast('請輸入筆記標題');
  try {
    if (id) await updateDoc(doc(notesRef, id), { title, content, updatedAt: serverTimestamp() });
    else await addDoc(notesRef, { title, content, createdBy: authUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    document.getElementById('note-dialog').close();
    showToast(id ? '已更新筆記' : '已新增筆記');
  } catch { showToast('未能儲存筆記'); }
}

function bindRemindersUI() {
  document.getElementById('save-reminder').addEventListener('click', saveReminderFromDialog);
  document.getElementById('home-reminders').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-reminder-action]');
    if (!button) return;
    const reminder = state.reminders.find((item) => item.id === button.dataset.id);
    if (!reminder) return;
    if (button.dataset.reminderAction === 'edit') openReminderDialog(reminder);
    if (button.dataset.reminderAction === 'delete' && await confirmAction(`刪除提醒「${reminder.title}」？`, '刪除提醒')) {
      try { await deleteDoc(doc(remindersRef, reminder.id)); showToast('已刪除提醒'); } catch { showToast('未能刪除提醒'); }
    }
  });
}

function openReminderDialog(reminder = null) {
  if (!guardPrivateAction()) return;
  document.getElementById('reminder-dialog-title').textContent = reminder ? '修改提醒' : '新增提醒';
  document.getElementById('reminder-id').value = reminder?.id || '';
  document.getElementById('reminder-title-input').value = reminder?.title || '';
  document.getElementById('reminder-date').value = reminder?.dueDate || toISODate(new Date());
  document.getElementById('reminder-repeat').value = reminder?.repeat || 'none';
  document.getElementById('reminder-lead').value = String(reminder?.leadDays ?? 14);
  document.getElementById('reminder-dialog').showModal();
}

async function saveReminderFromDialog() {
  if (!guardPrivateAction()) return;
  const id = document.getElementById('reminder-id').value;
  const title = document.getElementById('reminder-title-input').value.trim();
  const dueDate = document.getElementById('reminder-date').value;
  const repeat = document.getElementById('reminder-repeat').value;
  const leadDays = Number(document.getElementById('reminder-lead').value);
  if (!title || !dueDate) return showToast('請輸入事項及到期日');
  try {
    const payload = { title, dueDate, repeat, leadDays, updatedAt: serverTimestamp() };
    if (id) await updateDoc(doc(remindersRef, id), payload);
    else await addDoc(remindersRef, { ...payload, createdBy: authUser.uid, createdAt: serverTimestamp() });
    document.getElementById('reminder-dialog').close();
    showToast(id ? '已更新提醒' : '已新增提醒');
  } catch { showToast('未能儲存提醒'); }
}

const EXPENSE_META = {
  groceries: ['買餸', '🛒'], dining: ['飲食', '🍜'], transport: ['交通', '🚇'], home: ['家居', '🏠'],
  utilities: ['賬單', '🧾'], health: ['醫療', '🩺'], education: ['教育', '📚'], leisure: ['消閒', '🎬'], other: ['其他', '📌'],
};

function bindExpensesUI() {
  document.getElementById('add-expense-top').addEventListener('click', () => openExpenseDialog());
  document.getElementById('add-expense-fab').addEventListener('click', () => openExpenseDialog());
  document.getElementById('save-expense').addEventListener('click', saveExpenseFromDialog);
  document.getElementById('prev-expense-month').addEventListener('click', () => changeExpenseMonth(-1));
  document.getElementById('next-expense-month').addEventListener('click', () => changeExpenseMonth(1));
  document.getElementById('expense-current-month').addEventListener('click', () => {
    const today = new Date(); expenseViewYear = today.getFullYear(); expenseViewMonth = today.getMonth(); renderExpenses();
  });
  document.getElementById('expense-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-expense-action]');
    if (!button) return;
    const expense = state.expenses.find((item) => item.id === button.dataset.id);
    if (!expense) return;
    if (button.dataset.expenseAction === 'edit') openExpenseDialog(expense);
    if (button.dataset.expenseAction === 'delete' && await confirmAction(`刪除開支「${expense.title}」？`, '刪除開支')) {
      try { await deleteDoc(doc(expensesRef, expense.id)); showToast('已刪除開支'); } catch { showToast('未能刪除開支'); }
    }
  });
}

function changeExpenseMonth(offset) {
  const next = new Date(expenseViewYear, expenseViewMonth + offset, 1);
  expenseViewYear = next.getFullYear(); expenseViewMonth = next.getMonth(); renderExpenses();
}

function openExpenseDialog(expense = null) {
  if (!guardPrivateAction()) return;
  document.getElementById('expense-dialog-title').textContent = expense ? '修改家庭開支' : '新增家庭開支';
  document.getElementById('expense-id').value = expense?.id || '';
  document.getElementById('expense-title').value = expense?.title || '';
  document.getElementById('expense-amount').value = expense ? (Number(expense.amountCents) / 100).toFixed(2) : '';
  document.getElementById('expense-date').value = expense?.date || toISODate(new Date());
  document.getElementById('expense-category').value = expense?.category || 'groceries';
  document.getElementById('expense-paid-by').value = expense?.paidBy || '';
  document.getElementById('expense-note').value = expense?.note || '';
  document.getElementById('expense-dialog').showModal();
  setTimeout(() => document.getElementById('expense-title').focus(), 50);
}

async function saveExpenseFromDialog() {
  if (!guardPrivateAction()) return;
  const id = document.getElementById('expense-id').value;
  const title = document.getElementById('expense-title').value.trim();
  const amount = Number(document.getElementById('expense-amount').value);
  const date = document.getElementById('expense-date').value;
  const category = document.getElementById('expense-category').value;
  const paidBy = document.getElementById('expense-paid-by').value.trim();
  const note = document.getElementById('expense-note').value.trim();
  if (!title || !date || !Number.isFinite(amount) || amount < 0.01 || amount > 9999999.99) return showToast('請輸入項目、日期及有效金額');
  const payload = { title, amountCents: Math.round(amount * 100), currency: 'HKD', date, category, paidBy, note, updatedAt: serverTimestamp() };
  try {
    if (id) await updateDoc(doc(expensesRef, id), payload);
    else await addDoc(expensesRef, { ...payload, createdBy: authUser.uid, createdAt: serverTimestamp() });
    document.getElementById('expense-dialog').close();
    expenseViewYear = Number(date.slice(0, 4)); expenseViewMonth = Number(date.slice(5, 7)) - 1;
    showToast(id ? '已更新開支' : '已記錄開支');
  } catch { showToast('未能儲存開支'); }
}

function renderExpenses() {
  const list = document.getElementById('expense-list');
  if (!list) return;
  document.getElementById('expense-month-title').textContent = `${expenseViewYear}年 ${expenseViewMonth + 1}月`;
  if (!privateAllowed()) {
    document.getElementById('expense-month-total').textContent = 'HK$—';
    document.getElementById('expense-month-count').textContent = authUser ? '等待批准' : '登入後顯示';
    document.getElementById('expense-breakdown').innerHTML = '';
    document.getElementById('expense-month-change').textContent = '';
    document.getElementById('expense-current-month').hidden = true;
    list.innerHTML = lockedHTML(authUser ? '等待批准後顯示家庭開支' : '登入後顯示家庭開支');
    return;
  }
  const prefix = `${expenseViewYear}-${pad(expenseViewMonth + 1)}`;
  const items = state.expenses.filter((item) => item.date?.startsWith(prefix)).sort((a, b) => b.date.localeCompare(a.date) || sortByCreatedDesc(a, b));
  const total = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  document.getElementById('expense-month-total').textContent = formatMoney(total);
  document.getElementById('expense-month-count').textContent = `${items.length} 筆開支`;
  const previous = new Date(expenseViewYear, expenseViewMonth - 1, 1);
  const previousPrefix = `${previous.getFullYear()}-${pad(previous.getMonth() + 1)}`;
  const previousTotal = state.expenses.filter((item) => item.date?.startsWith(previousPrefix)).reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const change = document.getElementById('expense-month-change');
  change.className = 'expense-change';
  if (!previousTotal) change.textContent = total ? '上月未有記錄' : '';
  else {
    const difference = total - previousTotal;
    const percentage = Math.round(Math.abs(difference) / previousTotal * 100);
    change.textContent = difference === 0 ? '與上月相同' : `較上月${difference > 0 ? '多' : '少'} ${percentage}%`;
    change.classList.add(difference > 0 ? 'increase' : 'decrease');
  }
  const today = new Date();
  document.getElementById('expense-current-month').hidden = expenseViewYear === today.getFullYear() && expenseViewMonth === today.getMonth();
  const totals = items.reduce((result, item) => { result[item.category] = (result[item.category] || 0) + Number(item.amountCents || 0); return result; }, {});
  document.getElementById('expense-breakdown').innerHTML = Object.entries(totals).sort((a,b) => b[1] - a[1]).map(([category, cents]) => {
    const meta = EXPENSE_META[category] || EXPENSE_META.other;
    const share = total ? Math.round(cents / total * 100) : 0;
    return `<span><b>${meta[1]} ${meta[0]}</b><small>${formatMoney(cents)} · ${share}%</small><i aria-hidden="true"><u style="width:${share}%"></u></i></span>`;
  }).join('');
  list.innerHTML = items.length ? items.map((item) => {
    const meta = EXPENSE_META[item.category] || EXPENSE_META.other;
    const detail = [formatChineseDate(item.date), meta[0], item.paidBy ? `${item.paidBy}付款` : '', item.note || ''].filter(Boolean).join(' · ');
    return `<article class="expense-item"><span class="expense-icon">${meta[1]}</span><div class="expense-main"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(detail)}</small></div><b class="expense-amount">${formatMoney(item.amountCents)}</b><div class="row-actions"><button class="mini-icon-button" type="button" data-expense-action="edit" data-id="${escapeAttr(item.id)}" aria-label="修改"><svg><use href="#i-edit"></use></svg></button><button class="mini-icon-button danger" type="button" data-expense-action="delete" data-id="${escapeAttr(item.id)}" aria-label="刪除"><svg><use href="#i-trash"></use></svg></button></div></article>`;
  }).join('') : `<div class="empty-state"><span class="emoji">🧾</span><strong>這個月未有開支</strong><span>記下第一筆家庭開支</span></div>`;
}

function formatMoney(cents) { return new Intl.NumberFormat('zh-HK', { style: 'currency', currency: 'HKD', currencyDisplay: 'narrowSymbol' }).format(Number(cents || 0) / 100); }
function formatMoneyCompact(cents) { return new Intl.NumberFormat('zh-HK', { style: 'currency', currency: 'HKD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(Number(cents || 0) / 100); }

let confirmResolver = null;
function bindConfirmUI() {
  document.querySelectorAll('[data-confirm-value]').forEach((button) => button.addEventListener('click', () => {
    document.getElementById('confirm-dialog').close();
    confirmResolver?.(button.dataset.confirmValue === 'true');
    confirmResolver = null;
  }));
  document.getElementById('confirm-dialog').addEventListener('cancel', (event) => {
    event.preventDefault(); document.getElementById('confirm-dialog').close(); confirmResolver?.(false); confirmResolver = null;
  });
}

function confirmAction(message, title = '請確認') {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-dialog').showModal();
  return new Promise((resolve) => { confirmResolver = resolve; });
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
    list.innerHTML = adminPanelError
      ? `<div class="member-status"><strong>未能讀取等待批准的申請</strong><span>${escapeHTML(adminPanelError)}</span></div>`
      : `${pendingHTML ? `<h3>等待批准</h3>${pendingHTML}` : ''}<h3>已批准成員</h3>${approvedHTML || '<p class="muted">暫未有其他成員</p>'}`;
  };
  adminPanelError = '';
  const listenerError = (error) => { adminPanelError = error.code === 'permission-denied' ? '請在 Firebase Console 發布 firestore.rules，然後重新整理。' : '請重新整理後再試。'; console.error('Admin member panel:', error); render(); };
  adminPanelUnsubs.push(onSnapshot(requestsRef, (snap) => { pending = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status === 'pending'); render(); }, listenerError));
  adminPanelUnsubs.push(onSnapshot(membersRef, (snap) => { approved = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status === 'approved'); render(); }, listenerError));
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
  if (!await confirmAction('拒絕這個加入家庭的申請？', '拒絕申請')) return;
  try { await deleteDoc(doc(requestsRef, uid)); showToast('已拒絕申請'); } catch { showToast('未能拒絕申請'); }
}

async function removeMember(uid) {
  if (!await confirmAction('移除這位家庭成員？對方之後可再次申請。', '移除家庭成員')) return;
  try { await deleteDoc(doc(membersRef, uid)); showToast('已移除家庭成員'); } catch { showToast('未能移除成員'); }
}

function bindBackupUI() {
  document.getElementById('export-data').addEventListener('click', () => {
    if (!guardPrivateAction()) return;
    const blob = new Blob([JSON.stringify(createBackup(state), null, 2)], { type: 'application/json' });
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
    if (!guardPrivateAction()) {
      event.target.value = '';
      return;
    }
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
      const imported = validateBackup(JSON.parse(await file.text()), file.size);
      if (!await confirmAction('將備份資料加入目前家庭雲端？現有資料不會刪除或去除重複項目，因此可能出現重複資料。', '匯入備份')) return;
      await importLegacy(imported); showToast('已匯入家庭雲端');
    } catch { showToast('備份檔案格式不正確'); } finally { event.target.value = ''; }
  });
}

function renderAll() {
  renderTodos(); renderCalendar(); renderContacts(); renderExpenses(); renderHomeSummary(); renderAuthState(); renderMemberPanel(); renderConnectionState(); renderAnnouncements();
}

function renderHomeSummary() {
  const agenda = document.getElementById('home-agenda');
  const tasks = document.getElementById('home-tasks');
  const notes = document.getElementById('home-notes');
  const reminders = document.getElementById('home-reminders');
  if (!privateAllowed()) {
    document.getElementById('home-todo-count').textContent = '—';
    document.getElementById('home-todo-note').textContent = authUser ? '等待批准' : '登入後顯示';
    document.getElementById('home-event-count').textContent = '—';
    document.getElementById('home-next-event').textContent = authUser ? '等待批准' : '登入後顯示';
    document.getElementById('home-expense-total').textContent = 'HK$—';
    document.getElementById('home-expense-note').textContent = authUser ? '等待批准' : '登入後顯示';
    agenda.innerHTML = homeLockedPreview(authUser ? '等待批准後顯示家庭行程' : '登入後顯示家庭行程');
    tasks.innerHTML = homeLockedPreview(authUser ? '等待批准後顯示家庭清單' : '登入後顯示家庭清單');
    notes.innerHTML = homeLockedPreview(authUser ? '等待批准後顯示家庭筆記' : '登入後顯示家庭筆記');
    reminders.innerHTML = homeLockedPreview(authUser ? '等待批准後顯示提醒' : '登入後顯示提醒');
    return;
  }
  const pending = state.todos.filter((t) => !t.completed).length;
  const completed = state.todos.filter((t) => t.completed).length;
  document.getElementById('home-todo-count').textContent = pending;
  document.getElementById('home-todo-note').textContent = pending ? `${completed} 項已完成` : '全部完成';
  const today = toISODate(new Date());
  const todaysEvents = eventsForDate(today).sort((a,b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  document.getElementById('home-event-count').textContent = todaysEvents.length;
  const next = todaysEvents.find((e) => !e.time || `${today}T${e.time}` >= localDateTimeKey(new Date())) || todaysEvents[0];
  document.getElementById('home-next-event').textContent = next ? `${next.time ? next.time + ' ' : ''}${next.title}` : '今日未有活動';
  const monthExpenses = state.expenses.filter((item) => item.date?.startsWith(today.slice(0, 7)));
  const monthExpenseTotal = monthExpenses.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  document.getElementById('home-expense-total').textContent = formatMoneyCompact(monthExpenseTotal);
  document.getElementById('home-expense-note').textContent = monthExpenses.length ? `${monthExpenses.length} 筆記錄` : '暫未有記錄';
  const upcoming = upcomingEventOccurrences(3);
  agenda.innerHTML = upcoming.length ? upcoming.map((event) => {
    const meta = EVENT_META[event.category] || EVENT_META.other;
    const dateLabel = event.date === today ? '今日' : `${Number(event.date.slice(5, 7))}月${Number(event.date.slice(8, 10))}日`;
    return `<button type="button" class="preview-row" data-home-event-date="${escapeAttr(event.date)}"><span class="preview-icon purple">${meta.emoji}</span><span class="preview-main"><strong>${escapeHTML(event.title)}</strong><small>${dateLabel}${event.time ? ` · ${escapeHTML(event.time)}` : ''} · ${meta.label}</small></span><span class="preview-arrow">›</span></button>`;
  }).join('') : homeEmptyPreview('📅', '暫時未有即將到來的行程', '加入第一個家庭行程');
  agenda.querySelectorAll('[data-home-event-date]').forEach((button) => button.addEventListener('click', () => {
    selectedDate = button.dataset.homeEventDate;
    const date = fromISODate(selectedDate); viewYear = date.getFullYear(); viewMonth = date.getMonth(); switchPage('calendar');
  }));
  const openTasks = state.todos.filter((item) => !item.completed).slice(0, 4);
  tasks.innerHTML = openTasks.length ? openTasks.map((item) => `<button type="button" class="preview-row task-preview" data-home-task="${escapeAttr(item.id)}"><span class="preview-check" aria-hidden="true"></span><span class="preview-main"><strong>${escapeHTML(item.title)}</strong><small>${item.category === 'shopping' ? '購物' : '待辦'}</small></span></button>`).join('') : homeEmptyPreview('✨', '清單已全部完成', '做得好，今日可以輕鬆一下');
  tasks.querySelectorAll('[data-home-task]').forEach((button) => button.addEventListener('click', () => switchPage('todos')));
  const recentNotes = state.notes.slice(0, 3);
  notes.innerHTML = recentNotes.length ? recentNotes.map((note) => `<article class="note-preview"><button type="button" class="note-content-button" data-note-action="edit" data-id="${escapeAttr(note.id)}"><strong>${escapeHTML(note.title)}</strong><small>${escapeHTML(note.content || '沒有補充內容')}</small></button><button type="button" class="mini-icon-button danger" data-note-action="delete" data-id="${escapeAttr(note.id)}" aria-label="刪除筆記"><svg><use href="#i-trash"></use></svg></button></article>`).join('') : homeEmptyPreview('📝', '未有家庭筆記', '快速記下大家都要知道的事項');
  const upcomingReminders = state.reminders.map((item) => ({ ...item, nextDate: nextReminderDate(item) })).sort((a, b) => a.nextDate.localeCompare(b.nextDate)).slice(0, 4);
  reminders.innerHTML = upcomingReminders.length ? upcomingReminders.map((item) => `<article class="reminder-preview"><button type="button" class="reminder-content-button" data-reminder-action="edit" data-id="${escapeAttr(item.id)}"><span class="due-badge ${reminderUrgency(item)}">${formatReminderDays(item.nextDate)}</span><span><strong>${escapeHTML(item.title)}</strong><small>${formatChineseDate(item.nextDate)}${item.repeat !== 'none' ? ` · ${repeatLabel(item.repeat)}` : ''}</small></span></button><button type="button" class="mini-icon-button danger" data-reminder-action="delete" data-id="${escapeAttr(item.id)}" aria-label="刪除提醒"><svg><use href="#i-trash"></use></svg></button></article>`).join('') : homeEmptyPreview('🔔', '未有重要提醒', '加入續期、保險或家庭週期事項');
}

function updateDateAndGreeting() {
  const date = new Date();
  const weekday = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()];
  document.getElementById('home-date').textContent = `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 ${weekday}`;
  document.getElementById('home-clock').textContent = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function weatherEmoji(iconNo) { const n = Number(iconNo); if ([50,51].includes(n)) return '☀️'; if ([52,53].includes(n)) return '🌤️'; if ([54,55,56,57,58,59,60,61,62,63,64].includes(n)) return '☁️'; if ([65,66,67,68,69,70,71,72,73,74,75,76,77].includes(n)) return '🌧️'; if ([80,81,82].includes(n)) return '🌫️'; if ([90,91,92,93].includes(n)) return '🌙'; return '🌤️'; }

function setPrivateButtonsEnabled(enabled) {
  ['add-todo-top','add-todo-fab','add-event-top','add-event-inline','add-contact-top','add-expense-top','add-expense-fab','export-data','import-data'].forEach((id) => {
    const el = document.getElementById(id); if (!el) return; if ('disabled' in el) el.disabled = !enabled; el.classList.toggle('disabled', !enabled);
  });
}
function eventsForDate(iso) {
  const target = fromISODate(iso);
  return state.events.filter((event) => {
    if (!event.date || iso < event.date) return false;
    if (!event.repeat || event.repeat === 'none') return event.date === iso;
    const start = fromISODate(event.date);
    if (event.repeat === 'weekly') return Math.round((target - start) / 86400000) % 7 === 0;
    if (event.repeat === 'monthly') return target.getDate() === Math.min(start.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
    if (event.repeat === 'yearly') return target.getMonth() === start.getMonth() && target.getDate() === Math.min(start.getDate(), new Date(target.getFullYear(), start.getMonth() + 1, 0).getDate());
    return false;
  });
}
function upcomingEventOccurrences(limit) {
  const result = [];
  const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  for (let day = 0; day <= 370 && result.length < limit; day += 1) {
    const date = new Date(cursor); date.setDate(cursor.getDate() + day);
    const iso = toISODate(date);
    eventsForDate(iso).filter((event) => day > 0 || !event.time || `${iso}T${event.time}` >= localDateTimeKey(new Date())).forEach((event) => result.push({ ...event, date: iso }));
    result.sort((a, b) => `${a.date}T${a.time || '99:99'}`.localeCompare(`${b.date}T${b.time || '99:99'}`));
  }
  return result.slice(0, limit);
}
function repeatLabel(value) { return ({ weekly: '每星期', monthly: '每月', yearly: '每年' })[value] || ''; }
function nextReminderDate(reminder) {
  const today = fromISODate(toISODate(new Date()));
  const start = fromISODate(reminder.dueDate || toISODate(today));
  if (reminder.repeat === 'monthly' && start < today) {
    let monthIndex = today.getFullYear() * 12 + today.getMonth();
    const startIndex = start.getFullYear() * 12 + start.getMonth();
    monthIndex = Math.max(monthIndex, startIndex);
    let candidate = dateInMonth(monthIndex, start.getDate());
    if (candidate < today) candidate = dateInMonth(monthIndex + 1, start.getDate());
    return toISODate(candidate);
  }
  if (reminder.repeat === 'yearly' && start < today) {
    let year = today.getFullYear();
    let candidate = dateInYear(year, start.getMonth(), start.getDate());
    if (candidate < today) candidate = dateInYear(year + 1, start.getMonth(), start.getDate());
    return toISODate(candidate);
  }
  return toISODate(start);
}
function dateInMonth(monthIndex, day) { const year = Math.floor(monthIndex / 12); const month = monthIndex % 12; return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate())); }
function dateInYear(year, month, day) { return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate())); }
function reminderUrgency(reminder) {
  const days = Math.ceil((fromISODate(reminder.nextDate) - fromISODate(toISODate(new Date()))) / 86400000);
  return days <= 0 ? 'overdue' : days <= Number(reminder.leadDays || 0) ? 'soon' : '';
}
function formatReminderDays(iso) {
  const days = Math.ceil((fromISODate(iso) - fromISODate(toISODate(new Date()))) / 86400000);
  if (days < 0) return `逾期 ${Math.abs(days)} 日`;
  if (days === 0) return '今日到期';
  return `${days} 日後`;
}
function formatChineseDate(iso) { const date = fromISODate(iso); return `${date.getMonth() + 1}月${date.getDate()}日`; }
function lockedHTML(message) { return `<div class="empty-state locked-state"><span class="emoji">🔒</span><strong>${escapeHTML(message)}</strong><span>家庭資料只供已批准成員使用。</span></div>`; }
function sortByCreatedDesc(a,b) { const av = a.createdAt?.seconds || 0; const bv = b.createdAt?.seconds || 0; return bv - av; }
function toISODate(date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function fromISODate(value) { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }
function localDateTimeKey(date) { return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function pad(value) { return String(value).padStart(2,'0'); }
async function fetchWithTimeout(url, ms) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); try { return await fetch(url, { signal: controller.signal, cache: 'no-store' }); } finally { clearTimeout(timer); } }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }
function escapeAttr(value) { return escapeHTML(value); }
function homeLockedPreview(message) { return `<div class="home-preview-empty"><span>🔒</span><div><strong>${escapeHTML(message)}</strong><small>共享資料受家庭帳戶保護</small></div></div>`; }
function homeEmptyPreview(icon, title, note) { return `<div class="home-preview-empty"><span>${icon}</span><div><strong>${escapeHTML(title)}</strong><small>${escapeHTML(note)}</small></div></div>`; }
function showToast(message) { const toast = document.getElementById('toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
