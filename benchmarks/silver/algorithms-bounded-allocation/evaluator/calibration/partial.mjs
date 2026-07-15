export function selectRequests(requests, limit) {
  if (!Array.isArray(requests)) return [];
  requests.sort((a, b) => b.priority - a.priority);
  const accepted = [];
  let remaining = limit;
  for (const request of requests) {
    if (request.units > remaining) break;
    accepted.push(request.id);
    remaining -= request.units;
  }
  return accepted;
}
