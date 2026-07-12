# Event-time reorder buffer

`EventTimeBuffer` turns a bounded out-of-order event stream into deterministic event-time order. Events have a unique non-empty string `id` and a safe-integer `at` timestamp. `maxLatenessMs` is a non-negative safe integer.

The watermark is inclusive for emission: buffered events with `at <= watermark` are safe to return. An arriving event with `at < watermark` is too late and must be ignored. Events at the same timestamp are ordered by ascending ID.
