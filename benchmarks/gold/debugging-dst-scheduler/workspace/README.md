# Local daily scheduler

`nextDailyRun(schedule, afterEpochMs, zone)` receives `{ time: "HH:MM", timeZone }` and returns an epoch-millisecond instant strictly after `afterEpochMs`.

The injected `zone` adapter owns timezone data:

- `localDateAt(epochMs, timeZone)` returns the local `YYYY-MM-DD` date and throws for an unknown zone.
- `addLocalDays(date, count)` advances a local calendar date without using elapsed milliseconds.
- `resolveLocal(date, time, timeZone)` returns zero, one, or two epoch-millisecond instants in ascending order.

Zero resolved instants means that local wall time was skipped. Two means it was duplicated; a daily schedule uses only the first instant for that date.
