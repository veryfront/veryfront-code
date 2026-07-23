/**
 * Minimal runtime surface used by observability configuration loaders.
 *
 * Full Veryfront runtime adapters satisfy this contract structurally. Keeping
 * the dependency narrow lets observability initialize in lightweight runtimes
 * and tests without coupling telemetry to filesystem or server capabilities.
 */
export interface ObservabilityRuntimeAdapter {
  /** Environment-variable access for the current runtime. */
  readonly env: {
    /** Return the value for `key`, or `undefined` when it is not set. */
    get(key: string): string | undefined;
  };
}
