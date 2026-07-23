/**
 * Core types for the Veryfront extension system.
 *
 * @module extensions/types
 */

/**
 * Declares a system capability an extension requires.
 * Object-based for extensibility -- scoping fields vary by type.
 */
export interface Capability {
  /** Stable capability identifier. */
  type: string;
  /** Capability-specific scope or configuration. */
  [key: string]: unknown;
}

/** Public API contract for extension contract metadata. */
export interface ExtensionContractMetadata {
  /** Contracts this extension registers dynamically during setup(). */
  provides?: string[];
  /** Contracts this extension needs before setup() runs. */
  requires?: string[];
}

/** Context for extension. */
export interface ExtensionContext {
  /** Return a registered contract implementation when available. */
  get<T>(contract: string): T | undefined;
  /** Return a registered contract implementation or throw when it is unavailable. */
  require<T>(contract: string): T;
  /** Register a contract implementation for this extension lifecycle. */
  provide<T>(contract: string, impl: T): void;
  /** Extension-specific configuration. */
  config: Record<string, unknown>;
  /** Lifecycle-safe extension logger. */
  logger: ExtensionLogger;
  /** Aborts when setup fails, times out, or the extension lifecycle stops. */
  readonly signal?: AbortSignal;
}

/** Public API contract for extension logger. */
export interface ExtensionLogger {
  /** Write a debug-level message. */
  debug(message: string, ...args: unknown[]): void;
  /** Write an informational message. */
  info(message: string, ...args: unknown[]): void;
  /** Write a warning message. */
  warn(message: string, ...args: unknown[]): void;
  /** Write an error message. */
  error(message: string, ...args: unknown[]): void;
}

/** Context passed to an extension while its resources are released. */
export interface ExtensionTeardownContext {
  /** Aborts when the teardown deadline expires or the teardown call ends. */
  readonly signal: AbortSignal;
  /** Lifecycle path that requested teardown. */
  readonly phase: "rollback" | "shutdown";
}

/** Public API contract for extension. */
export interface Extension {
  /** Stable extension name. */
  name: string;
  /** Extension version. */
  version: string;
  /** Runtime capabilities requested by the extension. */
  capabilities: Capability[];
  /** Contracts declared by the extension. */
  contracts?: ExtensionContractMetadata;
  /** Initialize the extension and register dynamic contracts. */
  setup?(ctx: ExtensionContext): Promise<void> | void;
  /**
   * Release resources acquired during setup.
   *
   * The loader supplies a context. It remains optional so callers and
   * extensions written against the original zero-argument hook stay valid.
   */
  teardown?(context?: ExtensionTeardownContext): Promise<void> | void;
  /** Static contract implementations registered before setup. */
  provides?: Record<string, unknown>;
  /** Preset extensions expanded before lifecycle ordering. */
  extends?: Extension[];
}

/** Public API contract for extension factory. */
export type ExtensionFactory = (config?: unknown) => Extension;

/** Entry shape for extension config. */
export type ExtensionConfigEntry =
  | Extension
  | { name: string; enabled: false };

/** Public API contract for extension source. */
export type ExtensionSource =
  | "config"
  | "package"
  | "project"
  | "local-file"
  | "builtin";

/** Public API contract for resolved extension. */
export interface ResolvedExtension {
  /** Loaded extension definition. */
  extension: Extension;
  /** Discovery source used to resolve priority. */
  source: ExtensionSource;
  /** Source location or package specifier used to load the extension. */
  origin: string;
}
