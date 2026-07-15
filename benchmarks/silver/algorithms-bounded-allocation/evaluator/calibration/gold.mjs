export function selectRequests(requests, limit) {
  if (!Array.isArray(requests) || !Number.isInteger(limit) || limit < 0) return [];
  const ids = new Set();
  for (const request of requests) {
    if (!request || typeof request !== "object" || typeof request.id !== "string" || request.id.length === 0 || ids.has(request.id) || !Number.isInteger(request.priority) || !Number.isFinite(request.priority) || !Number.isInteger(request.units) || request.units <= 0) return [];
    ids.add(request.id);
  }
  const ordered = [...requests].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const accepted = [];
  let remaining = limit;
  for (const request of ordered) {
    if (request.units <= remaining) {
      accepted.push(request.id);
      remaining -= request.units;
    }
  }
  return accepted;
}
