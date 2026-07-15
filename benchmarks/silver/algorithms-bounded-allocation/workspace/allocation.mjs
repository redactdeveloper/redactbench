export function selectRequests(requests, limit) {
  void limit;
  return requests.map((request) => request.id);
}
