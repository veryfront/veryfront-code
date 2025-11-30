/**
 * Type definitions for init command
 * @module
 */

/**
 * Available project templates
 */
export type InitTemplate =
  | "blog"
  | "docs"
  | "app"
  | "minimal"
  | "ai"
  | "pages-router"
  | "app-router"
  | "app-router-api"
  | "rsc-demo";

export type CacheBackend = "memory" | "filesystem" | "kv" | "redis";

/**
 * Options for initializing a new project
 */
export interface InitOptions {
  /**
   * Project name or path (relative or absolute).
   * If omitted, scaffolds into CWD.
   */
  name?: string;

  /**
   * Template name. Defaults to "pages-router".
   */
  template?: InitTemplate;

  /**
   * Deprecated alias for app-router template.
   * Kept for backward compatibility.
   * @deprecated Use template: 'app-router' instead
   */
  appRouter?: boolean;

  /**
   * Desired cache backend (overrides interactive prompt).
   */
  cacheBackend?: CacheBackend;
}
