import { API } from '../config.js';
import { normalizeArrival } from '../eta.js';
import { getJson } from './http.js';

export function parseGmbEtas(payload, routeCatalog = new Map()) {
  const rows = [];
  for (const group of payload?.data || []) {
    const meta = routeCatalog.get(`${group.route_id}|${group.route_seq}`) || {};
    const base = { operator: 'GMB', route: meta.route || meta.code || '', routeId: group.route_id, routeSequence: group.route_seq, direction: String(group.route_seq), destination: meta.destination || meta.dest || '' };
    if (!(group.eta || []).length) rows.push(normalizeArrival(base));
    else for (const eta of group.eta) rows.push(normalizeArrival({ ...base, eta: eta.timestamp, remark: eta.remarks_tc }));
  }
  return rows;
}
export function parseGmbRouteIndex(payload) {
  const groups = payload?.data?.routes || payload?.data || {};
  const rows = Array.isArray(groups) ? groups : Object.values(groups).flat();
  return rows.map((x) => ({ operator: 'GMB', routeId: String(x.route_id ?? x), region: x.region || '' }));
}
export function parseGmbRoute(payload) {
  const routeId = String(payload?.data?.route_id ?? payload?.route_id ?? '');
  const variants = payload?.data?.directions || payload?.data?.routes || payload?.data || [];
  return (Array.isArray(variants) ? variants : []).map((x, index) => ({
    operator: 'GMB', routeId, routeSequence: String(x.route_seq ?? index + 1),
    route: String(x.route_code ?? x.route ?? ''), origin: x.orig_tc || x.origin || '', destination: x.dest_tc || x.destination || '',
  }));
}
export function parseGmbRouteStops(payload, routeMeta = {}) {
  const rows = payload?.data?.route_stops || payload?.data || [];
  return (Array.isArray(rows) ? rows : []).map((x) => ({
    operator: 'GMB', stopId: String(x.stop_id ?? x.stop), nameTc: x.name_tc || x.stop_name_tc || '', nameEn: x.name_en || x.stop_name_en || '',
    latitude: Number(x.latitude ?? x.lat), longitude: Number(x.longitude ?? x.long), stopSequence: Number(x.stop_seq),
    routeId: String(routeMeta.routeId ?? x.route_id ?? ''), routeSequence: String(routeMeta.routeSequence ?? x.route_seq ?? ''),
    route: String(routeMeta.route ?? ''), destination: String(routeMeta.destination ?? ''),
  }));
}
export const fetchGmbRouteIndex = (options) => getJson(`${API.GMB}/route`, options).then(parseGmbRouteIndex);
export const fetchGmbRoute = (routeId, options) => getJson(`${API.GMB}/route/${encodeURIComponent(routeId)}`, options).then(parseGmbRoute);
export const fetchGmbRouteStops = (routeId, routeSequence, options) => getJson(`${API.GMB}/route-stop/${encodeURIComponent(routeId)}/${encodeURIComponent(routeSequence)}`, options).then((x) => x.data || []);
export const fetchGmbRouteStopCatalog = (route, options) => getJson(`${API.GMB}/route-stop/${encodeURIComponent(route.routeId)}/${encodeURIComponent(route.routeSequence)}`, options).then((x) => parseGmbRouteStops(x, route));
export const fetchGmbStopEtas = (stopId, routeCatalog, options) => getJson(`${API.GMB}/eta/stop/${encodeURIComponent(stopId)}`, options).then((x) => parseGmbEtas(x, routeCatalog));
