import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/src/scheduler.mjs";
const { nextDailyRun } = await import(pathToFileURL(modulePath).href);

function addDays(date, count) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count));
  return next.toISOString().slice(0, 10);
}

function fakeZone(baseDate, resolutions) {
  function validate(timeZone) {
    if (timeZone === "Invalid/Zone") throw new RangeError("unknown timezone");
  }
  return {
    addLocalDays: addDays,
    localDateAt(_epochMs, timeZone) {
      validate(timeZone);
      return baseDate;
    },
    resolveLocal(date, _time, timeZone) {
      validate(timeZone);
      return resolutions[date] ?? [];
    }
  };
}

const schedule = { time: "02:30", timeZone: "Test/Local" };

if (mode === "spring-forward") {
  const zone = fakeZone("2026-03-08", {
    "2026-03-08": [],
    "2026-03-09": [5_000]
  });
  assert.equal(nextDailyRun(schedule, 1_000, zone), 5_000);
} else if (mode === "fall-back") {
  const zone = fakeZone("2026-11-01", {
    "2026-11-01": [1_900, 2_100],
    "2026-11-02": [5_000]
  });
  assert.equal(nextDailyRun({ ...schedule, time: "01:30" }, 2_000, zone), 5_000);
} else if (mode === "ordinary") {
  const zone = fakeZone("2026-01-10", {
    "2026-01-10": [1_500],
    "2026-01-11": [3_000]
  });
  assert.equal(nextDailyRun(schedule, 1_000, zone), 1_500);
  assert.equal(nextDailyRun(schedule, 1_600, zone), 3_000);
} else if (mode === "utc-contract") {
  const utcSchedule = { time: "00:00", timeZone: "UTC" };
  const zone = fakeZone("2026-01-10", {
    "2026-01-10": [1_000],
    "2026-01-11": [1_000 + DAY_MS]
  });
  assert.equal(nextDailyRun(utcSchedule, 1_000, zone), 1_000 + DAY_MS);
  assert.throws(
    () => nextDailyRun({ ...schedule, timeZone: "Invalid/Zone" }, 1_000, zone),
    /unknown timezone/u
  );
} else {
  throw new Error(`unknown evaluator mode: ${mode}`);
}
