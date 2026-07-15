export function normalizeTicket(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (!Number.isSafeInteger(input.id) || input.id <= 0 || typeof input.title !== "string") return null;
  const title = input.title.trim().replace(/\s+/gu, " ");
  return title ? { id: input.id, title } : null;
}
