import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  addPreference, changePreference, createCatalogCache, dedupeArrivals, groupArrivals,
  haversineMeters, mtrLinesForStation, nearbyStops, normalizeArrival, normalizePreferences,
  parseCompactCatalog, parseCtbEtas, parseCtbStops, parseGmbEtas, parseGmbRoute, parseGmbRouteIndex, parseGmbRouteStops, parseKmbEtas, parseMtrSchedule, poolMap,
  removePreference, reorderPreference, routePreferenceId, searchMtr, searchRoutes, searchStops,
} from '../transport/index.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/transport-api.json', import.meta.url), 'utf8'));

test('normalizes legacy config and prevents stable-ID duplicates', () => {
  let config = normalizePreferences({ interval: 30, routes: [{ co: 'KMB', route: '87D', dir: 'O', st: 1, stopId: 'S1', dest: '紅磡' }], mtr: [{ line: 'TML', sta: 'MOS' }] });
  assert.equal(config.items.length, 3);
  assert.equal(config.items[0].id, routePreferenceId(config.items[0]));
  config = addPreference(config, { kind: 'route', operator: 'KMB', route: '87D', direction: 'O', serviceType: '1', stopId: 'S1' });
  assert.equal(config.items.length, 3);
});

test('stop preferences preserve filters, home visibility and manual refresh', () => {
  const config = normalizePreferences({ interval: 0, stops: [{ co: 'CTB', id: '001950', nm: '馬鞍山市中心', showOnHome: false, routes: [{ route: '681', direction: 'I', serviceType: 1 }] }] });
  assert.equal(config.interval, 0);
  assert.equal(config.items[0].showOnHome, false);
  assert.deepEqual(config.items[0].routeFilters, [{ route: '681', direction: 'I', serviceType: '1' }]);
});

test('supports reorder, remove and safe change operations', () => {
  let config = normalizePreferences({ items: [
    { kind: 'stop', operator: 'CTB', stopId: '001950', name: '馬鞍山市中心' },
    { kind: 'mtr', line: 'TML', station: 'MOS', direction: 'UP' },
  ] });
  config = reorderPreference(config, config.items[1].id, 0);
  assert.equal(config.items[0].kind, 'mtr');
  const oldId = config.items[0].id;
  config = changePreference(config, oldId, { kind: 'mtr', line: 'TML', station: 'MOS', direction: 'DOWN' });
  assert.equal(config.items[0].direction, 'DOWN');
  config = removePreference(config, config.items[1].id);
  assert.equal(config.items.length, 1);
});

test('preserves GMB route id, sequence and service identity', () => {
  const config = normalizePreferences({ items: [{ kind: 'route', operator: 'GMB', route: '69', routeId: '2001', direction: 2, serviceType: 1, stopId: 'G1' }] });
  assert.deepEqual(config.items[0], { kind: 'route', operator: 'GMB', route: '69', routeId: '2001', direction: '2', serviceType: '1', stopId: 'G1', stopName: '', destination: '', showOnHome: true, id: 'route|GMB|2001|2|1|G1' });
});

test('parses embedded and source-backed CTB/GMB catalogs', () => {
  const compact = parseCompactCatalog(fixtures.compactCatalog);
  assert.equal(compact.ctbStops[0].stopId, '001950');
  assert.deepEqual(compact.gmbRoutes[0], { operator: 'GMB', routeId: '2001', routeSequence: '2', route: '69', destination: '馬鞍山' });
  assert.equal(parseCtbStops(fixtures.ctbStops)[0].latitude, 22.42413);
  assert.deepEqual(parseGmbRouteIndex(fixtures.gmbRouteIndex)[0], { operator: 'GMB', routeId: '2001', region: 'NT' });
  const route = parseGmbRoute(fixtures.gmbRoute)[0];
  assert.equal(route.routeSequence, '2'); assert.equal(route.route, '69');
  const stops = parseGmbRouteStops(fixtures.gmbStops, route);
  assert.equal(stops[0].stopId, 'G100'); assert.equal(stops[0].routeId, '2001'); assert.equal(stops[0].routeSequence, '2');
});

test('parses authoritative operator fixtures into common arrivals', () => {
  assert.equal(parseKmbEtas(fixtures.kmb)[0].operator, 'KMB');
  assert.equal(parseCtbEtas(fixtures.ctb)[0].destination, '中環');
  const catalog = new Map([['2001|2', { code: '69', destination: '馬鞍山' }]]);
  const gmb = parseGmbEtas(fixtures.gmb, catalog)[0];
  assert.equal(gmb.route, '69'); assert.equal(gmb.routeSequence, 2);
  const mtr = parseMtrSchedule(fixtures.mtr, 'TML', 'MOS');
  assert.equal(mtr.up[0].destination, 'WKS'); assert.equal(mtr.down[0].minutes, 4);
});

test('groups and deduplicates arrivals without merging operators', () => {
  const a = normalizeArrival({ operator: 'KMB', route: '681', direction: 'I', eta: '2026-09-21T12:00:00+08:00' });
  const b = normalizeArrival({ operator: 'KMB', route: '681', direction: 'I', eta: '2026-09-21T12:00:20+08:00' });
  const c = normalizeArrival({ operator: 'CTB', route: '681', direction: 'I', eta: '2026-09-21T12:00:20+08:00' });
  assert.equal(dedupeArrivals([a, b, c]).length, 2);
  assert.equal(groupArrivals([a, c]).length, 2);
});

test('catalog cache handles TTL and search ranking', () => {
  const memory = new Map(); const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  let now = 1000; const cache = createCatalogCache(storage, { maxAgeMs: 100, now: () => now });
  cache.write('stops', [{ stopId: 'S1' }]); assert.equal(cache.read('stops').items.length, 1);
  now = 1200; assert.equal(cache.read('stops'), null); assert.equal(cache.read('stops', { allowStale: true }).items.length, 1);
  assert.equal(searchStops([{ stopId: 'S1', nameTc: '馬鞍山市中心', nameEn: 'Ma On Shan Town Centre' }], '馬鞍山')[0].stopId, 'S1');
  assert.equal(searchRoutes([{ route: '87D', origin: '錦英苑', destination: '紅磡' }, { route: '87', origin: '', destination: '' }], '87D')[0].route, '87D');
});

test('nearby helpers compute distance, radius ordering and bounded pool output', async () => {
  const here = { latitude: 22.42413, longitude: 114.23169 };
  assert.ok(haversineMeters(here, { latitude: 22.42414, longitude: 114.23170 }) < 5);
  const nearby = nearbyStops([{ stopId: 'a', latitude: 22.42414, longitude: 114.23170 }, { stopId: 'b', latitude: 22.5, longitude: 114.3 }], here, 100);
  assert.deepEqual(nearby.map((x) => x.stopId), ['a']);
  assert.deepEqual(await poolMap([1,2,3], 2, async (x) => x * 2), [2,4,6]);
});

test('MTR catalog preserves interchange membership and search', () => {
  assert.ok(mtrLinesForStation('ADM').includes('EAL'));
  assert.ok(mtrLinesForStation('ADM').includes('TWL'));
  assert.equal(searchMtr('馬鞍山')[0].station, 'MOS');
});
