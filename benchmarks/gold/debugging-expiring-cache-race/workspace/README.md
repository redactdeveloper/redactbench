# Expiring cache

`ExpiringCache` stores values in memory and refreshes them on demand. The constructor accepts `{ now }`, where `now()` returns milliseconds; production callers omit it and use `Date.now`.

`get(key, loader, ttlMs)` returns a fresh value immediately or loads one asynchronously. Same-key callers share an in-flight load, while different keys don't block each other. `set(key, value, ttlMs)` installs a newer value even when an older load is still pending. Entries are fresh only while `now() < expiresAt`, and loader errors are never cached.
