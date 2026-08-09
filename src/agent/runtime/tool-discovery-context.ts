/**
 * Per-run context bag for run-scoped tool activation.
 *
 * Activation is run-scoped by definition. Keep this out of any project-scoped
 * registry so an activated set never leaks across runs.
 */
export type RuntimeToolDiscoveryContext = {
  /**
   * Remote tool names activated in this run. When present, this Set is used
   * (by reference) as the execution gate for every remote tool source, so a
   * host that grows the Set widens the catalog without re-creating sources.
   */
  activatedRemoteToolNames?: Set<string>;
};
