# Registry gate watchdog

The scheduled workflow checks every 10 minutes for an RC registry gate queued
for more than 15 minutes without starting. It cancels and reruns only that
unstarted job when every other job finished without failure, no other registry
gate holds or queues the dispatch lock, and no newer main gate dispatched. The
existing RC tag, Sonar, environment, and dispatch checks run unchanged. API
errors never authorize recovery. A failed inspection is reported while the scan
continues with other runs; any error fails the watchdog after writing its
summary. A queued gate must have no execution steps, because GitHub can populate
`started_at` before execution. After verified cancellation, a newly active
holder can queue the rerun. A newer successful dispatch suppresses that obsolete
rerun and is reported on the merged PR.

Use **Registry gate watchdog** in Actions with `dry_run: true` and a run id to
inspect a live run. An empty run id scans active main runs. Scheduled runs
enable recovery. Manual recovery runs only from `main`.

For a local live dry-run, supply a read-only GitHub token through `GH_TOKEN`:

```sh
GITHUB_REPOSITORY=veryfront/veryfront-code deno run --no-config \
  --allow-net=api.github.com --allow-env=GITHUB_REPOSITORY,GH_TOKEN,GITHUB_STEP_SUMMARY \
  scripts/ci/registry-gate-watchdog.ts --dry-run --run-id=<RUN_ID>
```

A completed historical run reports `healthy, no action`. To reproduce an
incident that GitHub has since cancelled, use a saved JSON snapshot with
`candidate` (`run` and `jobs`), `others` (other run/job inspections), and `now`
(an ISO timestamp). Label reconstructed snapshots with their evidence source; do
not present them as live API data. Snapshots support dry-run only:

```sh
deno run --no-config --allow-read=<SNAPSHOT_FILE> --allow-env=GITHUB_STEP_SUMMARY \
  scripts/ci/registry-gate-watchdog.ts --dry-run --snapshot=<SNAPSHOT_FILE>
```

The 15-minute threshold and 10-minute schedule give a nominal detection window
of 15 to 25 minutes after the gate enters its queue. GitHub schedule delays and
the subsequent gate and deployment execution can extend the time to a server
pin.
