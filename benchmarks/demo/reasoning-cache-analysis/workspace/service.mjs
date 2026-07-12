import { cacheUser, getCachedUser } from "./cache.mjs";

export async function loadUser(api, tenantId, userId) {
  const cached = getCachedUser(userId);
  if (cached) return cached;

  const user = await api.fetchUser(tenantId, userId);
  cacheUser(userId, user);
  return user;
}
