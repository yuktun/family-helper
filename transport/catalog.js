import { CATALOG_MAX_AGE_MS } from './config.js';

export function createCatalogCache(storage, { prefix = 'home.transport.catalog', maxAgeMs = CATALOG_MAX_AGE_MS, now = () => Date.now() } = {}) {
  const key = (name) => `${prefix}.${name}`;
  return {
    read(name, { allowStale = false } = {}) {
      try {
        const value = JSON.parse(storage.getItem(key(name)) || 'null');
        if (!value || !Array.isArray(value.items) || !Number.isFinite(value.savedAt)) return null;
        return allowStale || now() - value.savedAt < maxAgeMs ? value : null;
      } catch { return null; }
    },
    write(name, items) {
      const value = { version: 1, savedAt: now(), items };
      storage.setItem(key(name), JSON.stringify(value));
      return value;
    },
    remove(name) { storage.removeItem(key(name)); },
  };
}

export function searchStops(stops, query, limit = 30) {
  const tokens = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return stops.map((stop) => {
    const tc = stop.nameTc || stop.name || '', en = stop.nameEn || '';
    const hay = `${tc} ${en}`.toLocaleLowerCase();
    if (!tokens.every((token) => hay.includes(token))) return null;
    let score = tokens.every((token) => tc.toLocaleLowerCase().startsWith(token)) ? 100 : tokens.some((token) => tc.toLocaleLowerCase().startsWith(token)) ? 80 : 50;
    if (/[（(]/.test(tc)) score += 4;
    return { ...stop, score: score - Math.min(tc.length, 60) * 0.6 };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchRoutes(routes, query, limit = 40) {
  const raw = String(query).trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return [];
  return routes.map((item) => {
    const route = String(item.route).toUpperCase(); let score = 0;
    if (route === raw) score = 120; else if (route.startsWith(raw)) score = 100 - Math.min(route.length, 10); else if (route.includes(raw)) score = 60 - Math.min(route.length, 10); else if (/[\u3400-\u9fff]/.test(raw) && `${item.origin} ${item.destination}`.toUpperCase().includes(raw)) score = 30;
    return score ? { ...item, score } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.route.localeCompare(b.route, 'en', { numeric: true })).slice(0, limit);
}
