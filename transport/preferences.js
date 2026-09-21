import { BUS_DIRECTIONS, DEFAULT_REFRESH_SECONDS, MTR_DIRECTIONS } from './config.js';
import { preferenceId } from './ids.js';

const text = (value, name) => {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`missing_${name}`);
  return result;
};

export function normalizeStop(raw) {
  const operator = raw.operator || raw.co || 'KMB';
  if (!['KMB', 'LWB', 'CTB', 'GMB'].includes(operator)) throw new Error('invalid_stop_operator');
  const routeFilters = (raw.routeFilters || raw.routes || []).map((filter) => ({
    route: text(typeof filter === 'string' ? filter : filter.route, 'filter_route'),
    ...(typeof filter === 'object' && filter.direction != null ? { direction: String(filter.direction) } : {}),
    ...(typeof filter === 'object' && filter.serviceType != null ? { serviceType: String(filter.serviceType) } : {}),
    ...(typeof filter === 'object' && filter.routeId != null ? { routeId: String(filter.routeId) } : {}),
    ...(typeof filter === 'object' && filter.routeSequence != null ? { routeSequence: String(filter.routeSequence) } : {}),
  }));
  return { kind: 'stop', operator, stopId: text(raw.stopId ?? raw.id, 'stop_id'), name: String(raw.name ?? raw.nm ?? ''), routeFilters, showOnHome: raw.showOnHome !== false };
}

export function normalizeRoute(raw) {
  const operator = raw.operator || raw.co || 'KMB';
  if (!['KMB', 'LWB', 'CTB', 'GMB'].includes(operator)) throw new Error('invalid_route_operator');
  const direction = String(raw.direction ?? raw.dir ?? '').trim();
  if (operator === 'GMB') {
    if (!/^\d+$/.test(direction)) throw new Error('invalid_gmb_direction');
  } else if (!BUS_DIRECTIONS.includes(direction)) throw new Error('invalid_bus_direction');
  const routeId = operator === 'GMB' ? text(raw.routeId, 'route_id') : undefined;
  return {
    kind: 'route', operator, route: text(raw.route ?? raw.code, 'route'),
    ...(routeId ? { routeId } : {}), direction,
    serviceType: String(raw.serviceType ?? raw.st ?? '1'),
    stopId: text(raw.stopId, 'stop_id'), stopName: String(raw.stopName ?? ''),
    destination: String(raw.destination ?? raw.dest ?? ''), showOnHome: raw.showOnHome !== false,
  };
}

export function normalizeMtr(raw) {
  const direction = String(raw.direction ?? raw.dir ?? '').toUpperCase();
  if (!MTR_DIRECTIONS.includes(direction)) throw new Error('invalid_mtr_direction');
  return { kind: 'mtr', operator: 'MTR', line: text(raw.line, 'line'), station: text(raw.station ?? raw.sta, 'station'), direction, destination: String(raw.destination ?? raw.dest ?? ''), showOnHome: raw.showOnHome !== false };
}

export function normalizePreference(raw) {
  const kind = raw.kind || (raw.line && (raw.station || raw.sta) ? 'mtr' : raw.route || raw.code ? 'route' : 'stop');
  const item = kind === 'mtr' ? normalizeMtr(raw) : kind === 'route' ? normalizeRoute(raw) : normalizeStop(raw);
  return Object.freeze({ ...item, id: preferenceId(item) });
}

export function normalizePreferences(raw = {}) {
  const items = Array.isArray(raw.items)
    ? raw.items : [...(raw.stops || []).map((x) => ({ ...x, kind: 'stop' })), ...(raw.routes || []).map((x) => ({ ...x, kind: 'route' })), ...(raw.mtr || []).flatMap((x) => x.dir ? [{ ...x, kind: 'mtr' }] : ['UP', 'DOWN'].map((direction) => ({ ...x, direction, kind: 'mtr' })))];
  const seen = new Set();
  const normalized = [];
  for (const rawItem of items) {
    const item = normalizePreference(rawItem);
    if (!seen.has(item.id)) { seen.add(item.id); normalized.push(item); }
  }
  const interval = Number(raw.interval ?? DEFAULT_REFRESH_SECONDS);
  return { version: 2, interval: interval === 0 || (Number.isFinite(interval) && interval >= 15) ? interval : DEFAULT_REFRESH_SECONDS, items: normalized };
}

export function addPreference(config, raw) {
  const item = normalizePreference(raw);
  if (config.items.some((x) => x.id === item.id)) return config;
  return { ...config, items: [...config.items, item] };
}
export function removePreference(config, id) { return { ...config, items: config.items.filter((x) => x.id !== id) }; }
export function changePreference(config, id, raw) {
  const next = normalizePreference(raw);
  if (next.id !== id && config.items.some((x) => x.id === next.id)) throw new Error('duplicate_preference');
  return { ...config, items: config.items.map((x) => x.id === id ? next : x) };
}
export function reorderPreference(config, id, toIndex) {
  const index = config.items.findIndex((x) => x.id === id);
  if (index < 0) return config;
  const items = [...config.items]; const [item] = items.splice(index, 1);
  items.splice(Math.max(0, Math.min(Number(toIndex), items.length)), 0, item);
  return { ...config, items };
}
