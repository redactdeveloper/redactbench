export function normalizeTicket(input) {
  return { id: input.id, title: input.title.trim().replace(/\s+/gu, " ") };
}
