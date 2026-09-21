const EARTH_RADIUS_M = 6_371_000;
export function haversineMeters(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(Number(b.latitude) - Number(a.latitude));
  const dLon = rad(Number(b.longitude) - Number(a.longitude));
  const lat1 = rad(Number(a.latitude)); const lat2 = rad(Number(b.latitude));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
export function nearbyStops(stops, position, radiusMeters = 500) {
  return stops.map((stop) => ({ ...stop, distanceMeters: haversineMeters(position, stop) })).filter((x) => Number.isFinite(x.distanceMeters) && x.distanceMeters <= radiusMeters).sort((a, b) => a.distanceMeters - b.distanceMeters);
}
export async function poolMap(items, concurrency, mapper) {
  const result = new Array(items.length); let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) { const index = cursor++; result[index] = await mapper(items[index], index); }
  });
  await Promise.all(workers); return result;
}
