/**
 * Select the optional runner pool only for main pushes in this repository.
 * Merge groups and all other events stay on GitHub-hosted runners. Workflow
 * conditions do not replace the runner group's server-side access controls.
 */
export const RUNNER_TRUST_REPOSITORY = "veryfront/veryfront-code";

/** Return false for every event except a push to this repository's main. */
export async function decideRunnerTrust({ repository, eventName, ref }) {
  return repository === RUNNER_TRUST_REPOSITORY && eventName === "push" &&
    ref === "refs/heads/main";
}
