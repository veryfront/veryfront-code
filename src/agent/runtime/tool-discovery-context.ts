/** Public API contract for a tool catalog entry in the runtime discovery catalog. */
export type RuntimeToolCatalogEntry = {
  name: string;
  description: string;
  source: string;
  requiresGrant?: boolean;
};

/**
 * Per-run context bag for run-scoped tool activation.
 *
 * The framework never creates this context. A caller that supplies one owns its
 * lifetime and must create a fresh `Set` for every run: a `Set` reused across
 * runs carries the earlier run's tool names into the later one and overrides
 * that run's `allowedToolNames`.
 *
 * @deprecated Use `tool_search` deferred loading. See
 * `docs/architecture/28-model-driven-tool-discovery.md`. This type is retained
 * because it is reachable from the public
 * `PrepareHostedChatRuntimeToolAssemblyInput.toolDiscoveryContext` field.
 */
export type RuntimeToolDiscoveryContext = {
  /**
   * Remote tool names activated in this run. When present, this Set is used by
   * reference as the execution gate for every remote tool source, so growing it
   * widens the catalog without re-creating sources.
   *
   * `null` disables name filtering entirely and overrides `allowedToolNames`.
   * Omit the property to keep `allowedToolNames` as the gate.
   */
  activatedRemoteToolNames?: Set<string>;

  /**
   * Invoked after a successful activation with the newly activated names.
   *
   * @deprecated Never invoked. Its only caller was the `load_tools` tool, which
   * was never exported, so no external caller could make this fire. Retained as
   * an optional declaration so callers that still construct this context keep
   * compiling.
   */
  onToolsActivated?: (names: string[]) => void;

  /**
   * Invoked when an activation is rejected, with the rejected names and a
   * per-name reason.
   *
   * @deprecated Never invoked. See `onToolsActivated`.
   */
  onToolsActivationRejected?: (
    names: string[],
    reasons: Record<string, string>,
  ) => void;
};
