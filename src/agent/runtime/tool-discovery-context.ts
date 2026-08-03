/** Public API contract for tool catalog entry in the runtime discovery catalog. */
export type RuntimeToolCatalogEntry = {
  name: string;
  description: string;
  source: string;
  requiresGrant?: boolean;
};

/**
 * Per-run context bag for model-driven tool discovery and on-demand loading.
 *
 * Activation is run-scoped by definition. Keep this out of any project-scoped
 * registry so a loaded set never leaks across runs.
 */
export type RuntimeToolDiscoveryContext = {
  /**
   * The set of remote tool names that have been activated in this run.
   * Initialized lazily on first activation.
   */
  activatedRemoteToolNames?: Set<string>;

  /**
   * Optional callback invoked after successful atomic activation.
   * Receives only the *newly* activated names (duplicates excluded).
   * The host layer uses this to emit a durable CUSTOM conversation event.
   */
  onToolsActivated?: (names: string[]) => void;

  /**
   * Optional callback invoked when activation is rejected (validation or
   * budget overflow). Receives the rejected names and a per-name reason map.
   * The host layer uses this to emit a durable CUSTOM conversation event.
   */
  onToolsActivationRejected?: (
    names: string[],
    reasons: Record<string, string>,
  ) => void;
};
