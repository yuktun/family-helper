export function etaDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeArrival(raw) {
  const at = etaDate(raw.etaAt ?? raw.eta ?? raw.timestamp ?? raw.time);
  return {
    operator: raw.operator || raw.co || 'KMB', route: String(raw.route ?? ''),
    direction: String(raw.direction ?? raw.dir ?? ''), serviceType: String(raw.serviceType ?? raw.service_type ?? '1'),
    destination: String(raw.destination ?? raw.dest_tc ?? raw.dest_en ?? raw.dest ?? ''),
    etaAt: at, remark: String(raw.remark ?? raw.rmk_tc ?? raw.rmk ?? ''),
    sequence: Number(raw.sequence ?? raw.seq ?? 0), routeId: raw.routeId ?? raw.route_id,
    routeSequence: raw.routeSequence ?? raw.route_seq,
  };
}

export function groupArrivals(rows, { limit = 3 } = {}) {
  const groups = new Map();
  for (const raw of rows || []) {
    const item = normalizeArrival(raw);
    const key = item.operator === 'GMB'
      ? `GMB|${item.routeId}|${item.routeSequence}`
      : `${item.operator}|${item.route}|${item.direction}|${item.serviceType}`;
    if (!groups.has(key)) groups.set(key, { key, operator: item.operator, route: item.route, direction: item.direction, serviceType: item.serviceType, destination: item.destination, routeId: item.routeId, routeSequence: item.routeSequence, arrivals: [] });
    groups.get(key).arrivals.push(item);
  }
  for (const group of groups.values()) group.arrivals = group.arrivals.sort((a, b) => (a.etaAt?.getTime() ?? Infinity) - (b.etaAt?.getTime() ?? Infinity)).slice(0, limit);
  return [...groups.values()].sort((a, b) => Number(!a.arrivals.some((x) => x.etaAt)) - Number(!b.arrivals.some((x) => x.etaAt)) || a.route.localeCompare(b.route, 'en', { numeric: true }));
}

export function validFutureArrivals(items, now = Date.now(), graceMs = 90_000) {
  return items.filter((x) => x.etaAt && x.etaAt.getTime() > now - graceMs);
}

export function dedupeArrivals(items, thresholdMs = 45_000) {
  const result = [];
  for (const item of [...items].sort((a, b) => a.etaAt - b.etaAt)) {
    if (!result.some((x) => x.operator === item.operator && x.route === item.route && Math.abs(x.etaAt - item.etaAt) < thresholdMs)) result.push(item);
  }
  return result;
}
