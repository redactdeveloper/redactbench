export function nextDailyRun(schedule, afterEpochMs, zone) {
  let date = zone.localDateAt(afterEpochMs, schedule.timeZone);
  for (let searched = 0; searched <= 370; searched += 1) {
    const first = zone.resolveLocal(date, schedule.time, schedule.timeZone)[0];
    if (first !== undefined && first > afterEpochMs) return first;
    date = zone.addLocalDays(date, 1);
  }
  return null;
}
