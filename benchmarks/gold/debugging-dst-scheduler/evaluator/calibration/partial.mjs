const DAY_MS = 24 * 60 * 60 * 1000;

export function nextDailyRun(schedule, afterEpochMs, zone) {
  let date = zone.localDateAt(afterEpochMs, schedule.timeZone);
  for (let searched = 0; searched <= 370; searched += 1) {
    const candidates = zone.resolveLocal(date, schedule.time, schedule.timeZone);
    if (candidates.length === 0) return afterEpochMs + DAY_MS;
    const future = candidates.find((candidate) => candidate > afterEpochMs);
    if (future !== undefined) return future;
    date = zone.addLocalDays(date, 1);
  }
  return null;
}
