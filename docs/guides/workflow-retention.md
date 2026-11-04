---
title: "Remove old workflow runs"
description: "Configure a retention process for terminal workflow runs and verify deletion boundaries."
order: 380
---

Remove old execution records from a persistent workflow backend after the retention period you choose.

## Before you start

Use an existing persistent backend shared with your workflow workers. Plan the initial maintenance window described below before starting the retention process.

## Remove old terminal workflow runs

Use `reapTerminalRuns` from a periodic maintenance process to delete old
completed, failed, and cancelled workflow runs. Waiting and active runs are
never eligible. The cutoff is exclusive, and each call deletes at most `limit`
runs. The sweep does not modify workflow definitions, schedules, tasks,
webhooks, or prompts.

Run the scheduler as one long-lived maintenance process. Before its first
start, stop every workflow worker. Restart the workers only after the initial
repair finishes, and keep this process running so every scheduled sweep reuses
the same backend.

```ts
import { reapTerminalRuns, RedisBackend } from "veryfront/workflow";

const redisUrl = Deno.env.get("REDIS_URL");
if (!redisUrl) throw new Error("Set REDIS_URL before running workflow retention");

const backend = new RedisBackend({ url: redisUrl });
const retentionAgeMs = 30 * 24 * 60 * 60 * 1000;
const sweepIntervalMs = 24 * 60 * 60 * 1000;

async function runSweep(): Promise<void> {
  const completedBefore = new Date(Date.now() - retentionAgeMs);
  while (true) {
    const result = await reapTerminalRuns(backend, {
      completedBefore,
      limit: 100,
    });
    if (!result.supported) {
      throw new Error("The configured workflow backend does not support terminal-run retention");
    }
    if (!result.hasMore) break;
  }
}

async function runScheduler(): Promise<never> {
  while (true) {
    await runSweep();
    await new Promise<void>((resolve) => setTimeout(resolve, sweepIntervalMs));
  }
}

try {
  await runScheduler();
} finally {
  await backend.destroy();
}
```

The backend verifies the run identity, terminal status, completion time, and
mutation revision in the same operation that deletes its state. A failed run
that starts retrying, or receives another state patch after the sweep reads it,
is retained. A failed run with accepted retry work still queued or pending is
not selected. In that case, or when Redis must resume bounded queue cleanup,
`hasMore` is `false` so the loop does not immediately reselect the refreshed
run. The next scheduled maintenance invocation can retry it. After deletion,
reads return the existing not-found result; this retention API does not create
tombstones.

Redis stores a completion-time index and reads at most `limit + 1` candidate
records per sweep without hydrating run input, output, or context. Completion
times use numeric Redis scores, so ordering stays chronological for every valid
JavaScript `Date`. One deletion script cleans at most 100 indexed stream
messages for a run, then defers final deletion if more remain. Each call
requests one run-key `SCAN` page with `COUNT 100` and reads at most 100 queue
entries during repair. Redis completes both repair cycles before
returning candidates. Once both finish, that backend instance queries the
completed index directly and does not restart repair between deletion batches.
A new backend instance performs its own bounded repair. The queue cycle uses a
fixed stream high-water mark, so current queue traffic does not keep the
one-time repair open forever.

Before a new Redis maintenance backend starts its first retention sweep,
stop every workflow worker. Run the repair until `hasMore` becomes `false`, then
restart workers on the version that provides retention and keep the maintenance
backend long-lived. Repeat this drain if you replace the maintenance backend.
The repair requeues Redis pending deliveries that the maintenance process does
not own, so running it beside active workers can duplicate their work. During
repair, `hasMore` can be `true` even when one sweep examines no eligible runs.

## Verify the sweep

Check that an old terminal run is no longer readable while recent, waiting, and active runs remain available. Inspect the sweep result for backend support and whether more batches remain.

## Related

- [Define and execute workflows](./workflows.md): Application behavior and execution.
