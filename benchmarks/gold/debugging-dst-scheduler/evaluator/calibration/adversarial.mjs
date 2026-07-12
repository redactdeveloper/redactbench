const DAY_MS = 24 * 60 * 60 * 1000;

export function nextDailyRun(schedule, afterEpochMs, zone) {
  zone.localDateAt(afterEpochMs, schedule.timeZone);
  return afterEpochMs + DAY_MS;
}
