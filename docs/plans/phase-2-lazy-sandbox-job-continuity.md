# Phase 2 lazy sandbox job continuity

This batch closes the next framework gap that blocks a larger hosted-agent sandbox cleanup.

## Add now
- command-job endpoint tracking inside framework `LazySandbox`
- heartbeat preservation while async command jobs are active
- lazy default `projectReference` propagation from `getProjectId()` when callers do not supply one explicitly

## Lock now
- active command jobs keep their original endpoint reachable even if the current session heartbeat fails
- lazy heartbeats pause while async jobs are active and resume when the tracked set returns to zero
- `executeStream()` and `startCommandJob()` forward `projectReference` from lazy project context by default

## Keep for later
- full hosted-agent replacement of the local `LazySandbox` owner
- hosted-agent-specific knowledge-ingest routing and runtime endpoint rewrite policy
