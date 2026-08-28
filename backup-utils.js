export const BACKUP_VERSION = 3;
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 400;

const COLLECTIONS = ['todos', 'events', 'contacts', 'notes', 'reminders'];
const ENUMS = {
  todoCategory: ['todo', 'shopping'],
  eventCategory: ['family', 'school', 'medical', 'car', 'bill', 'birthday', 'other'],
  eventRepeat: ['none', 'weekly', 'monthly', 'yearly'],
  infoCategory: ['estate', 'medical', 'company', 'emergency', 'other'],
  reminderRepeat: ['none', 'monthly', 'yearly'],
};

function fail(message) { throw new Error(message); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); return value; }
function text(value, label, max, { required = false } = {}) {
  if (typeof value !== 'string') fail(`${label} must be text`);
  if (required && !value.trim()) fail(`${label} is required`);
  if (value.length > max) fail(`${label} is too long`);
  return value;
}
function choice(value, label, allowed, fallback) {
  const result = value == null ? fallback : value;
  if (!allowed.includes(result)) fail(`${label} is not supported`);
  return result;
}
function date(value, label) {
  const result = text(value, label, 10, { required: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(`${label} is invalid`);
  const parsed = new Date(`${result}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) fail(`${label} is invalid`);
  return result;
}
function optionalTime(value, label) {
  const result = text(value ?? '', label, 5);
  if (result && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) fail(`${label} is invalid`);
  return result;
}

export function createBackup(data, exportedAt = new Date().toISOString()) {
  return { version: BACKUP_VERSION, exportedAt, data };
}

export function validateBackup(parsed, byteLength = 0) {
  if (byteLength > MAX_BACKUP_BYTES) fail('Backup file is too large');
  const envelope = object(parsed, 'Backup');
  if (envelope.version !== BACKUP_VERSION) fail('Backup version is not supported');
  if (typeof envelope.exportedAt !== 'string' || Number.isNaN(Date.parse(envelope.exportedAt))) fail('Backup export date is invalid');
  const data = object(envelope.data, 'Backup data');
  const keys = Object.keys(data);
  if (keys.some((key) => !COLLECTIONS.includes(key)) || COLLECTIONS.some((key) => !Array.isArray(data[key]))) fail('Backup collections are invalid');
  const count = COLLECTIONS.reduce((sum, key) => sum + data[key].length, 0);
  if (count > MAX_BACKUP_RECORDS) fail('Backup has too many records');

  return {
    todos: data.todos.map((raw, i) => {
      const item = object(raw, `todos[${i}]`);
      if (typeof item.completed !== 'boolean') fail(`todos[${i}].completed must be true or false`);
      return { title: text(item.title, `todos[${i}].title`, 200, { required: true }), category: choice(item.category, `todos[${i}].category`, ENUMS.todoCategory, 'todo'), completed: item.completed };
    }),
    events: data.events.map((raw, i) => {
      const item = object(raw, `events[${i}]`);
      return { title: text(item.title, `events[${i}].title`, 200, { required: true }), date: date(item.date, `events[${i}].date`), time: optionalTime(item.time, `events[${i}].time`), category: choice(item.category, `events[${i}].category`, ENUMS.eventCategory, 'other'), repeat: choice(item.repeat, `events[${i}].repeat`, ENUMS.eventRepeat, 'none') };
    }),
    contacts: data.contacts.map((raw, i) => {
      const item = object(raw, `contacts[${i}]`);
      const sortOrder = item.sortOrder == null ? 999 : Number(item.sortOrder);
      if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 100000) fail(`contacts[${i}].sortOrder is invalid`);
      return { category: choice(item.category, `contacts[${i}].category`, ENUMS.infoCategory, 'other'), name: text(item.name, `contacts[${i}].name`, 120, { required: true }), phone: text(item.phone ?? '', `contacts[${i}].phone`, 80), address: text(item.address ?? '', `contacts[${i}].address`, 500), note: text(item.note ?? '', `contacts[${i}].note`, 1000), sortOrder };
    }),
    notes: data.notes.map((raw, i) => {
      const item = object(raw, `notes[${i}]`);
      return { title: text(item.title, `notes[${i}].title`, 200, { required: true }), content: text(item.content ?? '', `notes[${i}].content`, 5000) };
    }),
    reminders: data.reminders.map((raw, i) => {
      const item = object(raw, `reminders[${i}]`);
      const leadDays = Number(item.leadDays ?? 0);
      if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) fail(`reminders[${i}].leadDays is invalid`);
      return { title: text(item.title, `reminders[${i}].title`, 200, { required: true }), dueDate: date(item.dueDate, `reminders[${i}].dueDate`), repeat: choice(item.repeat, `reminders[${i}].repeat`, ENUMS.reminderRepeat, 'none'), leadDays };
    }),
  };
}
