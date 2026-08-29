export async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  return {
    status: response.status,
    body: await response.json(),
  };
}
