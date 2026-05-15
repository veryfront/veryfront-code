/**
 * Core types for the veryfront extension system.
 *
 * @module extensions/types
 */

/**
 * Declares a system capability an extension requires.
 * Object-based for extensibility -- scoping fields vary by type.
 */
export interface Capability {
  type: string;
  [key: string]: unknown;
}

export interface ExtensionContractMetadata {
  /** Contracts this extension registers dynamically during setup(). */
  provides?: string[];
  /** Contracts this extension needs before setup() runs. */
  requires?: string[];
}

export type PackageContractMetadata = ExtensionContractMetadata;

export interface ExtensionContext {
  get<T>(contract: string): T | undefined;
  require<T>(contract: string): T;
  provide<T>(contract: string, impl: T): void;
  config: Record<string, unknown>;
  logger: ExtensionLogger;
}

export interface ExtensionLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface Extension {
  name: string;
  version: string;
  capabilities: Capability[];
  contracts?: ExtensionContractMetadata;
  setup?(ctx: ExtensionContext): Promise<void> | void;
  teardown?(): Promise<void> | void;
  provides?: Record<string, unknown>;
  extends?: Extension[];
}

export type ExtensionFactory = (config?: unknown) => Extension;

export type ExtensionConfigEntry =
  | Extension
  | { name: string; enabled: false };

export type ExtensionSource =
  | "config"
  | "package"
  | "project"
  | "local-file"
  | "builtin";

export interface ResolvedExtension {
  extension: Extension;
  source: ExtensionSource;
  origin: string;
}
