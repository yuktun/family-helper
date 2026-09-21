export function parseCompactCatalog(bank = {}) {
  const ctbStops = (bank.ctb || []).map((x) => ({ operator: 'CTB', stopId: String(x[0]), nameTc: x[1] || '', nameEn: '', latitude: Number(x[2]), longitude: Number(x[3]) }));
  const gmbStops = (bank.gmb || []).map((x) => ({ operator: 'GMB', stopId: String(x[0]), nameTc: x[1] || '', nameEn: '', latitude: Number(x[2]), longitude: Number(x[3]) }));
  const gmbRoutes = (bank.gmbr || []).map((x) => ({ operator: 'GMB', routeId: String(x[0]), routeSequence: String(x[1]), route: String(x[2]), destination: x[3] || '' }));
  return { ctbStops, gmbStops, gmbRoutes };
}

export function parseCompactCatalogText(text) {
  return parseCompactCatalog(JSON.parse(text));
}

export function gmbRouteCatalog(routes) {
  return new Map(routes.map((x) => [`${x.routeId}|${x.routeSequence}`, x]));
}
