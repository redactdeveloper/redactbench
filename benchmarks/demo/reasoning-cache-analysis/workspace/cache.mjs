const users = new Map();

export function getCachedUser(id) {
  return users.get(id);
}

export function cacheUser(id, user) {
  users.set(id, user);
}
