import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/src/expiring-cache.mjs";
const { ExpiringCache } = await import(pathToFileURL(modulePath).href);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function startLoaders() {
  await Promise.resolve();
  await Promise.resolve();
}

if (mode === "concurrent") {
  const cache = new ExpiringCache({ now: () => 100 });
  const same = deferred();
  let sameCalls = 0;
  const loadSame = () => {
    sameCalls += 1;
    return same.promise;
  };
  const sameA = cache.get("same", loadSame, 50);
  const sameB = cache.get("same", loadSame, 50);
  await startLoaders();
  assert.equal(sameCalls, 1);
  same.resolve("shared");
  assert.deepEqual(await Promise.all([sameA, sameB]), ["shared", "shared"]);

  const first = deferred();
  const second = deferred();
  let firstCalls = 0;
  let secondCalls = 0;
  const firstResult = cache.get("first", () => {
    firstCalls += 1;
    return first.promise;
  }, 50);
  const secondResult = cache.get("second", () => {
    secondCalls += 1;
    return second.promise;
  }, 50);
  await startLoaders();
  assert.deepEqual([firstCalls, secondCalls], [1, 1]);
  first.resolve("one");
  second.resolve("two");
  assert.deepEqual(await Promise.all([firstResult, secondResult]), ["one", "two"]);
} else if (mode === "stale-rejection") {
  const cache = new ExpiringCache({ now: () => 10 });
  const stale = deferred();
  const staleResult = cache.get("key", () => stale.promise, 50);
  await startLoaders();
  cache.set("key", "fresh", 100);
  stale.reject(new Error("old refresh failed"));
  await assert.rejects(staleResult, /old refresh failed/u);
  let replacementCalls = 0;
  const value = await cache.get("key", async () => {
    replacementCalls += 1;
    return "replacement";
  }, 100);
  assert.equal(value, "fresh");
  assert.equal(replacementCalls, 0);
} else if (mode === "ttl-boundary") {
  let now = 100;
  const cache = new ExpiringCache({ now: () => now });
  cache.set("key", "old", 10);
  now = 109;
  assert.equal(await cache.get("key", async () => "early", 10), "old");
  now = 110;
  let calls = 0;
  const value = await cache.get("key", async () => {
    calls += 1;
    return "new";
  }, 10);
  assert.equal(value, "new");
  assert.equal(calls, 1);
} else if (mode === "error-retry") {
  const cache = new ExpiringCache({ now: () => 0 });
  let calls = 0;
  await assert.rejects(cache.get("key", async () => {
    calls += 1;
    throw new Error("temporary failure");
  }, 10), /temporary failure/u);
  const value = await cache.get("key", async () => {
    calls += 1;
    return "recovered";
  }, 10);
  assert.equal(value, "recovered");
  assert.equal(calls, 2);
} else {
  throw new Error(`unknown evaluator mode: ${mode}`);
}
