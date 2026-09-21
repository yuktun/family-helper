const part = (value) => encodeURIComponent(String(value ?? '').trim());

export function stopPreferenceId(stop) {
  return ['stop', stop.operator || 'KMB', stop.stopId].map(part).join('|');
}

export function routePreferenceId(route) {
  const operator = route.operator || 'KMB';
  const identity = operator === 'GMB' ? route.routeId : route.route;
  return ['route', operator, identity, route.direction, route.serviceType ?? '1', route.stopId].map(part).join('|');
}

export function mtrPreferenceId(item) {
  return ['mtr', 'MTR', item.line, item.station, item.direction].map(part).join('|');
}

export function preferenceId(item) {
  if (item.kind === 'mtr') return mtrPreferenceId(item);
  if (item.kind === 'stop') return stopPreferenceId(item);
  if (item.kind === 'route') return routePreferenceId(item);
  throw new Error('unsupported_preference_kind');
}
