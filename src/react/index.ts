/**
 * React Integration Module
 *
 * Provides React version compatibility, framework components, and SSR adapters.
 *
 * Structure:
 * - `components/` - Framework-provided React components (Link, Head, MDXProvider)
 * - `compat/` - React version compatibility layer (17, 18, 19)
 *
 * @module react
 */

// React version compatibility
export * from "./compat/index.ts";

// Framework components
export * from "./components/index.ts";
