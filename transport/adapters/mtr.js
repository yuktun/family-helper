import { API } from '../config.js';
import { getJson } from './http.js';

export function parseMtrTime(value) {
  if (!value) return null;
  const date = new Date(`${String(value).replace(' ', 'T')}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
export function parseMtrSchedule(payload, line, station) {
  const data = payload?.data?.[`${line}-${station}`] || {};
  const map = (direction) => (data[direction] || []).filter((x) => x?.valid !== 'N').map((x) => ({ operator: 'MTR', line, station, direction, destination: x.dest || '', platform: x.plat || '', sequence: Number(x.seq || 0), minutes: Number.isFinite(Number(x.ttnt)) ? Number(x.ttnt) : null, etaAt: parseMtrTime(x.time) }));
  return { up: map('UP'), down: map('DOWN'), delayed: payload?.isdelay === 'Y', generatedAt: parseMtrTime(data.sys_time || payload?.sys_time || payload?.curr_time), message: payload?.message || '' };
}
export const fetchMtrSchedule = (line, station, options) => getJson(`${API.MTR}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(station)}`, options).then((x) => parseMtrSchedule(x, line, station));
