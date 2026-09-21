import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { Timestamp, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-family-helpers';
const familyId = 'fufai';
const now = Timestamp.fromDate(new Date('2026-08-27T00:00:00Z'));
let env;

const path = (collection, id) => `families/${familyId}/${collection}/${id}`;
const transportPath = (uid, preferenceId = 'preferences') => `families/${familyId}/members/${uid}/transport/${preferenceId}`;
const transportEntryPath = (uid, collection, id) => `${transportPath(uid)}/${collection}/${id}`;
const auth = (uid, email = `${uid}@example.test`) => env.authenticatedContext(uid, { email }).firestore();
const route = (overrides = {}) => ({ id: 'route-kmb-980x-o', operator: 'KMB', route: '980X', direction: 'O', serviceType: '1', stopId: '15FF958BE6921BAA', stopName: '耀安邨', destination: '灣仔', order: 0, ...overrides });
const stop = (overrides = {}) => ({ id: 'stop-ctb-001950', operator: 'CTB', stopId: '001950', stopName: '海富中心', routes: ['680', '681'], order: 0, ...overrides });
const mtr = (overrides = {}) => ({ id: 'mtr-tml-mos-up', line: 'TML', station: 'MOS', direction: 'UP', destination: '屯門', order: 0, ...overrides });
const preference = (overrides = {}) => ({
  schemaVersion: 1,
  revision: 1,
  interval: 30,
  showOnHome: true,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

const privateShapes = {
  todos: () => ({ title: '項目', category: 'todo', completed: false, createdBy: 'member', createdAt: now, updatedAt: now }),
  calendarEvents: () => ({ title: '活動', date: '2026-09-30', time: '', category: 'family', repeat: 'none', createdBy: 'member', createdAt: now, updatedAt: now }),
  usefulInfo: () => ({ category: 'other', name: '資料', phone: '', address: '', note: '', sortOrder: 0, createdAt: now, updatedAt: now }),
  notes: () => ({ title: '筆記', content: '', createdBy: 'member', createdAt: now, updatedAt: now }),
  reminders: () => ({ title: '提醒', dueDate: '2027-01-01', repeat: 'none', leadDays: 0, createdBy: 'member', createdAt: now, updatedAt: now }),
  expenses: () => ({ title: '超市', amountCents: 12850, currency: 'HKD', date: '2026-08-27', category: 'groceries', paidBy: '媽媽', note: '', createdBy: 'member', createdAt: now, updatedAt: now }),
};

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, path('members', 'admin')), { uid: 'admin', email: 'admin@example.test', role: 'admin', status: 'approved' });
    await setDoc(doc(db, path('members', 'member')), { uid: 'member', email: 'member@example.test', role: 'member', status: 'approved' });
    await setDoc(doc(db, path('members', 'member2')), { uid: 'member2', email: 'member2@example.test', role: 'member', status: 'approved' });
    await setDoc(doc(db, path('members', 'pending')), { uid: 'pending', email: 'pending@example.test', role: 'member', status: 'pending' });
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
after(async () => env?.cleanup());

test('Firestore emulator: guest sees only public announcements', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, path('announcements', 'public'))));
  await assertFails(getDoc(doc(db, path('todos', 'private'))));
  await assertFails(setDoc(doc(db, path('announcements', 'x')), { message: 'no' }));
});

test('Firestore emulator: requester can create and read only own request', async () => {
  const db = auth('requester');
  const own = doc(db, path('membershipRequests', 'requester'));
  await assertSucceeds(setDoc(own, { uid: 'requester', email: 'requester@example.test', displayName: 'R', photoURL: '', status: 'pending', createdAt: now, updatedAt: now }));
  await assertSucceeds(getDoc(own));
  await assertFails(getDoc(doc(db, path('membershipRequests', 'someone-else'))));
  await assertFails(setDoc(doc(db, path('membershipRequests', 'other')), { uid: 'other', email: 'requester@example.test', status: 'pending', createdAt: now, updatedAt: now }));
});

test('Firestore emulator: approved member can use family data but cannot administer', async () => {
  const db = auth('member');
  const todo = doc(db, path('todos', 't1'));
  await assertSucceeds(setDoc(todo, { title: '買奶', category: 'shopping', completed: false, createdBy: 'member', createdAt: now, updatedAt: now }));
  await assertSucceeds(getDoc(todo));
  await assertFails(setDoc(doc(db, path('members', 'attacker')), { uid: 'attacker', email: 'x@example.test', role: 'admin', status: 'approved' }));
  await assertFails(setDoc(doc(db, path('announcements', 'a1')), { message: 'member cannot publish' }));
});

test('Firestore emulator: pending user cannot access private family data', async () => {
  const db = auth('pending');
  await assertFails(getDoc(doc(db, path('todos', 't1'))));
  await assertFails(setDoc(doc(db, path('todos', 't1')), { title: 'x', category: 'todo', completed: false, createdBy: 'pending', createdAt: now, updatedAt: now }));
});

test('Firestore emulator: approved members own isolated transport preferences', async () => {
  const memberDb = auth('member');
  const adminDb = auth('admin');
  const own = doc(memberDb, transportPath('member'));

  await assertSucceeds(setDoc(own, preference()));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'routes', 'route-kmb-980x-o')), route()));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'routes', 'route-gmb-101m-1')), route({ id: 'route-gmb-101m-1', operator: 'GMB', route: '101M', routeId: '2000001', direction: '1', serviceType: '', stopId: 'gmb-stop-1', stopName: '馬鞍山市中心', destination: '坑口站', order: 1 })));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'routes', 'route-lwb-a41-o')), route({ id: 'route-lwb-a41-o', operator: 'LWB', route: 'A41', direction: 'O', stopName: '', destination: '', order: 2 })));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'stops', 'stop-ctb-001950')), stop()));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'stops', 'stop-max-groups')), stop({ id: 'stop-max-groups', routes: Array.from({ length: 12 }, (_, index) => `group-${index}`), order: 11 })));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'mtr', 'mtr-tml-mos-up')), mtr()));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'mtr', 'mtr-isl-adm-down')), mtr({ id: 'mtr-isl-adm-down', line: 'ISL', station: 'ADM', direction: 'DOWN', destination: '堅尼地城', order: 1 })));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'routes', 'route-order-35')), route({ id: 'route-order-35', order: 35 })));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'stops', 'stop-order-35')), stop({ id: 'stop-order-35', order: 35 })));
  await assertSucceeds(setDoc(doc(memberDb, transportEntryPath('member', 'mtr', 'mtr-order-35')), mtr({ id: 'mtr-order-35', order: 35 })));
  const routeRef = doc(memberDb, transportEntryPath('member', 'routes', 'route-kmb-980x-o'));
  await assertSucceeds(getDoc(routeRef));
  await assertSucceeds(updateDoc(routeRef, { destination: '金鐘' }));
  await assertSucceeds(getDoc(own));
  await assertSucceeds(updateDoc(own, { revision: 2, interval: 60, showOnHome: false, updatedAt: serverTimestamp() }));

  await assertFails(getDoc(doc(adminDb, transportPath('member'))));
  await assertFails(updateDoc(doc(adminDb, transportPath('member')), { revision: 3, routes: [], updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(adminDb, transportPath('member'))));
  await assertFails(getDoc(doc(adminDb, transportEntryPath('member', 'routes', 'route-kmb-980x-o'))));
  await assertSucceeds(deleteDoc(own));
});

test('Firestore emulator: transport preferences deny non-owners and non-approved users', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), transportPath('member')), {
      ...preference({ createdAt: now, updatedAt: now }),
    });
  });

  for (const db of [
    env.unauthenticatedContext().firestore(),
    auth('requester'),
    auth('pending'),
    auth('member2'),
  ]) {
    const target = doc(db, transportPath('member'));
    await assertFails(getDoc(target));
    await assertFails(setDoc(target, preference()));
    await assertFails(updateDoc(target, { revision: 2, routes: [], updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(target));
    const otherEntry = doc(db, transportEntryPath('member', 'routes', 'route-kmb-980x-o'));
    await assertFails(getDoc(otherEntry));
    await assertFails(setDoc(otherEntry, route()));
    await assertFails(deleteDoc(otherEntry));
  }
});

test('Firestore emulator: transport preference schema is exact and bounded', async () => {
  const db = auth('member');
  const target = doc(db, transportPath('member'));
  const valid = preference();

  await assertSucceeds(setDoc(target, valid));
  await assertFails(setDoc(doc(db, transportPath('member', 'other')), valid));
  await assertFails(setDoc(target, { ...valid, schemaVersion: 2 }));
  await assertFails(setDoc(target, { ...valid, revision: 0 }));
  await assertFails(setDoc(target, { ...valid, interval: 10 }));
  await assertFails(setDoc(target, { ...valid, showOnHome: 'yes' }));
  await assertFails(setDoc(target, { ...valid, routes: [] }));
  await assertFails(setDoc(target, { ...valid, preciseLocation: 'home' }));
  await assertFails(setDoc(target, { ...valid, createdAt: now, updatedAt: now }));
  await assertFails(updateDoc(target, { revision: 3, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(target, { revision: 2, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test('Firestore emulator: malformed nested transport entries are denied', async () => {
  const db = auth('member');
  const invalidRoutes = [
    route({ operator: 'MTR' }), route({ operator: 'GMB' }), route({ routeId: 'unexpected' }),
    route({ direction: 'UP' }), route({ destination: 'x'.repeat(121) }), route({ extra: true }), route({ order: 36 }),
  ];
  for (const value of invalidRoutes) {
    await assertFails(setDoc(doc(db, transportEntryPath('member', 'routes', value.id)), value));
  }
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'routes', 'wrong-id')), route()));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'routes', 'route-gmb-invalid-direction')), route({ id: 'route-gmb-invalid-direction', operator: 'GMB', routeId: '2000001', direction: 'I' })));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'stops', 'stop-ctb-001950')), stop({ operator: 'MTR' })));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'stops', 'stop-ctb-001950')), stop({ routes: [''] })));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'stops', 'stop-ctb-001950')), stop({ routes: Array.from({ length: 13 }, (_, index) => `group-${index}`) })));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'stops', 'stop-ctb-001950')), stop({ order: 36 })));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'mtr', 'mtr-tml-mos-up')), mtr({ line: 'XYZ' })));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'mtr', 'mtr-tml-mos-up')), mtr({ direction: 'I' })));
  await assertFails(setDoc(doc(db, transportEntryPath('member', 'mtr', 'mtr-tml-mos-up')), mtr({ order: 36 })));
});

test('Firestore emulator: private collection CRUD matrix preserves collaborative access', async () => {
  const deniedRoles = [
    ['guest', env.unauthenticatedContext().firestore()],
    ['requester', auth('requester')],
    ['pending', auth('pending')],
  ];
  const allowedRoles = [
    ['member', auth('member')],
    ['admin', auth('admin')],
  ];

  await env.withSecurityRulesDisabled(async (context) => {
    for (const [collection, shape] of Object.entries(privateShapes)) {
      await setDoc(doc(context.firestore(), path(collection, 'existing')), shape());
    }
  });

  for (const [role, db] of deniedRoles) {
    for (const [collection, shape] of Object.entries(privateShapes)) {
      const existing = doc(db, path(collection, 'existing'));
      const candidate = doc(db, path(collection, `create-${role}`));
      await assertFails(getDoc(existing));
      await assertFails(setDoc(candidate, shape()));
      await assertFails(updateDoc(existing, { updatedAt: now }));
      await assertFails(deleteDoc(existing));
    }
  }

  for (const [role, db] of allowedRoles) {
    for (const [collection, shape] of Object.entries(privateShapes)) {
      const candidate = doc(db, path(collection, `crud-${role}`));
      await assertSucceeds(setDoc(candidate, shape()));
      await assertSucceeds(getDoc(candidate));
      await assertSucceeds(updateDoc(candidate, { updatedAt: now }));
      await assertSucceeds(deleteDoc(candidate));
    }
  }
});

test('Firestore emulator: admin can manage membership and announcements', async () => {
  const db = auth('admin');
  await assertSucceeds(setDoc(doc(db, path('members', 'new')), { uid: 'new', email: 'new@example.test', role: 'member', status: 'approved' }));
  await assertSucceeds(setDoc(doc(db, path('announcements', 'a1')), { message: 'Welcome' }));
  await assertSucceeds(deleteDoc(doc(db, path('announcements', 'a1'))));
});

test('Firestore emulator: designated bootstrap succeeds only for own matching account', async () => {
  const bootstrapEmail = 'jatoy0a11@gmail.com';
  const valid = auth('bootstrap', bootstrapEmail);
  await assertSucceeds(setDoc(doc(valid, path('members', 'bootstrap')), { uid: 'bootstrap', email: bootstrapEmail, displayName: 'Owner', photoURL: '', role: 'admin', status: 'approved', createdAt: now, updatedAt: now }));

  const wrongEmail = auth('wrong-email', 'other@example.test');
  await assertFails(setDoc(doc(wrongEmail, path('members', 'wrong-email')), { uid: 'wrong-email', email: 'other@example.test', displayName: '', photoURL: '', role: 'admin', status: 'approved', createdAt: now, updatedAt: now }));

  const crossUid = auth('bootstrap-cross', bootstrapEmail);
  await assertFails(setDoc(doc(crossUid, path('members', 'victim')), { uid: 'victim', email: bootstrapEmail, displayName: '', photoURL: '', role: 'admin', status: 'approved', createdAt: now, updatedAt: now }));
});

test('Firestore emulator: admin can approve request and later remove member', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path('membershipRequests', 'candidate')), { uid: 'candidate', email: 'candidate@example.test', displayName: 'Candidate', photoURL: '', status: 'pending', createdAt: now, updatedAt: now });
  });
  const db = auth('admin');
  const request = doc(db, path('membershipRequests', 'candidate'));
  const member = doc(db, path('members', 'candidate'));
  await assertSucceeds(updateDoc(request, { status: 'approved', updatedAt: now }));
  await assertSucceeds(setDoc(member, { uid: 'candidate', email: 'candidate@example.test', displayName: 'Candidate', photoURL: '', role: 'member', status: 'approved', createdAt: now, updatedAt: now }));
  await assertSucceeds(deleteDoc(request));
  await assertSucceeds(deleteDoc(member));
});

test('Firestore emulator: self-promotion and cross-user requests are denied', async () => {
  const db = auth('attacker');
  await assertFails(setDoc(doc(db, path('members', 'attacker')), { uid: 'attacker', email: 'attacker@example.test', role: 'admin', status: 'approved', createdAt: now, updatedAt: now }));
  await assertFails(setDoc(doc(db, path('membershipRequests', 'victim')), { uid: 'victim', email: 'attacker@example.test', displayName: '', photoURL: '', status: 'pending', createdAt: now, updatedAt: now }));
});

test('Firestore emulator: current calendar shape is writable', async () => {
  const db = auth('member');
  await assertSucceeds(setDoc(doc(db, path('calendarEvents', 'current')), { title: '覆診', date: '2026-09-30', time: '09:05', category: 'medical', repeat: 'monthly', createdBy: 'member', createdAt: now, updatedAt: now }));
});

test('Firestore emulator: current useful info, note, and reminder shapes are writable', async () => {
  const db = auth('member');
  await assertSucceeds(setDoc(doc(db, path('usefulInfo', 'i1')), { category: 'medical', name: '醫生', phone: '1234', address: '香港', note: '', sortOrder: 0, createdAt: now, updatedAt: now }));
  await assertSucceeds(setDoc(doc(db, path('usefulInfo', 'company')), { category: 'company', name: '公司', phone: '', address: '', note: '', sortOrder: 40, createdAt: now, updatedAt: now }));
  await assertFails(setDoc(doc(db, path('usefulInfo', 'legacy-school-write')), { category: 'school', name: '學校', phone: '', address: '', note: '', sortOrder: 40, createdAt: now, updatedAt: now }));
  await assertSucceeds(setDoc(doc(db, path('notes', 'n1')), { title: '門鎖', content: '提示', createdBy: 'member', createdAt: now, updatedAt: now }));
  await assertSucceeds(setDoc(doc(db, path('reminders', 'r1')), { title: '續期', dueDate: '2027-01-01', repeat: 'yearly', leadDays: 30, createdBy: 'member', createdAt: now, updatedAt: now }));
});

test('Firestore emulator: legacy calendar without repeat remains readable/deletable but cannot be partially updated', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path('calendarEvents', 'legacy')), { title: '舊活動', date: '2026-09-30', time: '', category: 'family', createdBy: 'member', createdAt: now, updatedAt: now });
  });
  const db = auth('member');
  const legacy = doc(db, path('calendarEvents', 'legacy'));
  await assertSucceeds(getDoc(legacy));
  await assertFails(updateDoc(legacy, { title: '改名', updatedAt: now }));
  await assertSucceeds(deleteDoc(legacy));
});

test('Firestore emulator: malformed legacy records are readable/deletable but strict writes are denied', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path('todos', 'legacy')), { title: '舊項目', category: 'todo', completed: false });
  });
  const db = auth('member');
  const legacy = doc(db, path('todos', 'legacy'));
  await assertSucceeds(getDoc(legacy));
  await assertFails(updateDoc(legacy, { completed: true, updatedAt: now }));
  await assertSucceeds(deleteDoc(legacy));
});

test('Firestore emulator: legacy optional-field gaps require normalization before editing', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, path('usefulInfo', 'legacy-info')), { category: 'medical', name: '舊聯絡', phone: '', address: '', createdAt: now, updatedAt: now });
    await setDoc(doc(db, path('reminders', 'legacy-reminder')), { title: '舊提醒', dueDate: '2027-01-01', createdBy: 'member', createdAt: now, updatedAt: now });
  });
  const db = auth('member');
  const info = doc(db, path('usefulInfo', 'legacy-info'));
  const reminder = doc(db, path('reminders', 'legacy-reminder'));
  await assertSucceeds(getDoc(info));
  await assertSucceeds(getDoc(reminder));
  await assertFails(updateDoc(info, { name: '改名', updatedAt: now }));
  await assertFails(updateDoc(reminder, { title: '改名', updatedAt: now }));
});

test('Firestore emulator: legacy note and unknown extra field are readable/deletable but not editable', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, path('notes', 'legacy-note')), { title: '舊筆記', createdBy: 'member', createdAt: now, updatedAt: now });
    await setDoc(doc(db, path('todos', 'legacy-extra')), { ...privateShapes.todos(), obsoleteField: 'legacy' });
  });
  const db = auth('member');
  for (const [collection, id] of [['notes', 'legacy-note'], ['todos', 'legacy-extra']]) {
    const legacy = doc(db, path(collection, id));
    await assertSucceeds(getDoc(legacy));
    await assertFails(updateDoc(legacy, { updatedAt: now }));
    await assertSucceeds(deleteDoc(legacy));
  }
});
