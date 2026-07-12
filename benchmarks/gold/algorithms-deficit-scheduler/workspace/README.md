# Deficit scheduler

`DeficitScheduler` serves FIFO jobs from fixed lanes. A lane is `{ id, quantum }`; a job is `{ id, cost, ...data }`. Lane IDs and job IDs are unique non-empty strings, while quantum and cost are positive safe integers.

Deficit belongs to a lane and survives visits. A lane keeps serving while its head fits its remaining credit. An empty lane resets its deficit to zero. This allows expensive jobs to accumulate credit without blocking ready work in other lanes.
