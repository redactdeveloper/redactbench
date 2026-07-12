let nextId = 0;

export function createRequestIdGenerator(prefix) {
  return () => `${prefix}-${++nextId}`;
}
