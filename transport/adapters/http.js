export async function getJson(url, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`transport_http_${response.status}`);
  return response.json();
}
