import { API } from '../config.js';
import { normalizeArrival } from '../eta.js';
import { getJson } from './http.js';

export const parseKmbStops = (payload) => (payload?.data || []).map((x) => ({ operator: 'KMB', stopId: String(x.stop), nameTc: x.name_tc || '', nameEn: x.name_en || '', latitude: Number(x.lat), longitude: Number(x.long) }));
export const parseKmbRoutes = (payload) => (payload?.data || []).map((x) => ({ operator: String(x.co || 'KMB'), route: String(x.route), direction: x.bound, serviceType: String(x.service_type || '1'), origin: x.orig_tc || x.orig_en || '', destination: x.dest_tc || x.dest_en || '' }));
export const parseKmbEtas = (payload) => (payload?.data || []).map((x) => normalizeArrival({ ...x, operator: x.co || 'KMB' }));

export const fetchKmbStops = (options) => getJson(`${API.KMB}/stop`, options).then(parseKmbStops);
export const fetchKmbRoutes = (options) => getJson(`${API.KMB}/route/`, options).then(parseKmbRoutes);
export const fetchKmbRouteStops = (route, direction, serviceType = '1', options) => getJson(`${API.KMB}/route-stop/${encodeURIComponent(route)}/${direction === 'I' ? 'inbound' : 'outbound'}/${encodeURIComponent(serviceType)}`, options).then((x) => x.data || []);
export const fetchKmbStopEtas = (stopId, options) => getJson(`${API.KMB}/stop-eta/${encodeURIComponent(stopId)}`, options).then(parseKmbEtas);
export const fetchKmbRouteEtas = (stopId, route, serviceType = '1', options) => getJson(`${API.KMB}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/${encodeURIComponent(serviceType)}`, options).then(parseKmbEtas);
