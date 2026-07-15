export function selectRequests(requests, limit) {
  return Array.isArray(requests) ? requests.map((request) => request.id).sort().slice(0, limit) : [];
}
