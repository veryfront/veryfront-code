/**
 * Type definitions for SSR module.
 * @module
 */

import type * as React from "react";

/**
 * Options for rendering MDX content.
 */
export interface MDXRenderOptions {
  /** Optional frontmatter data to pass to the MDX component */
  frontmatter?: Record<string, unknown>;
  /** Custom React components to use in MDX rendering */
  components?: Record<string, React.ComponentType<unknown>>;
  /** Global variables accessible in MDX scope */
  globals?: Record<string, unknown>;
  /** Page-level configuration options */
  pageConfig?: Record<string, unknown>;
}

/**
 * Represents a loaded MDX module with optional default export.
 */
export interface MDXModule {
  /** Default export of the MDX module */
  default?: React.ComponentType<unknown>;
  /** Named MDXContent export */
  MDXContent?: React.ComponentType<unknown>;
  /** Optional frontmatter exported by MDX compiler */
  frontmatter?: Record<string, unknown>;
}
