# Optional main runner pool

`CI_RUNNER_TRUSTED=veryfront-ci` enables the optional pool for the listed test
and gate jobs on pushes to `main`. Merge groups, pull requests, manual dispatches,
release jobs and npm artifact builds use GitHub-hosted runners. Unset the variable
to restore hosted routing. An unavailable pool queues jobs; there is no automatic
fallback after a job selects that pool.

Before enabling the variable, the runner owner must configure one-job ephemeral
runners and server-side runner-group restrictions that deny access from queued
or pull-request-controlled workflow revisions. A label, author association or
condition inside event-controlled YAML cannot enforce this access boundary.
Keep the variable unset until those restrictions are verified. This PR does not
change or attest to organization runner configuration.

Queue routing stays disabled. Any future queue pool requires a main-pinned
reusable workflow and a runner group restricted to that exact trusted workflow.
The mutable caller must not have direct access to the runner group.

`tests/integration/ci/workflow-runners.test.ts` pins the job list and evaluates
routing across events, refs, repositories, flag values and trust outputs.
