import { API } from '../config.js';
import { normalizeArrival } from '../eta.js';
import { getJson } from './http.js';

export const parseCtbRoutes = (payload) => (payload?.data || []).flatMap((x) => [
  { operator: 'CTB', route: String(x.route), direction: 'O', serviceType: '1', origin: x.orig_tc || x.orig_en || '', destination: x.dest_tc || x.dest_en || '' },
  { operator: 'CTB', route: String(x.route), direction: 'I', serviceType: '1', origin: x.dest_tc || x.dest_en || '', destination: x.orig_tc || x.orig_en || '' },
]);
export const parseCtbStops = (payload) => (payload?.data || []).map((x) => ({ operator: 'CTB', stopId: String(x.stop), nameTc: x.name_tc || '', nameEn: x.name_en || '', latitude: Number(x.lat), longitude: Number(x.long) }));
export const parseCtbEtas = (payload) => (payload?.data || []).map((x) => normalizeArrival({ ...x, operator: 'CTB', destination: x.dest ?? x.dest_tc ?? x.dest_en, remark: x.rmk ?? x.rmk_tc }));
export const fetchCtbRoutes = (options) => getJson(`${API.CTB}/route/CTB`, options).then(parseCtbRoutes);
export const fetchCtbStops = (options) => getJson(`${API.CTB}/stop`, options).then(parseCtbStops);
export const fetchCtbRouteStops = (route, direction, options) => getJson(`${API.CTB}/route-stop/CTB/${encodeURIComponent(route)}/${direction}`, options).then((x) => x.data || []);
export const fetchCtbStopEtas = (stopId, options) => getJson(`${API.CTB_BATCH}/stop-eta/CTB/${encodeURIComponent(stopId)}?lang=zh-hant`, options).then(parseCtbEtas);
