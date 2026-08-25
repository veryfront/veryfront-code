/**
 * Portable `@std/yaml/parse` shim.
 *
 * `jsr:@std/yaml` only resolves under Deno, so importing it from core made
 * every Node and Bun test that transitively touched YAML unresolvable. A
 * third-party parser cannot move into core either. Core may depend on the
 * Deno standard library and nothing else. So core keeps the call sites and the
 * `YamlParserProvider` contract, and the first-party `ext-yaml` extension
 * keeps the parser.
 *
 * @module platform/compat/std/yaml
 */

import { resolve, tryResolve } from "#veryfront/extensions/contracts.ts";
import { loadDefaultYamlParserProvider } from "#veryfront/extensions/parser/yaml-defaults.ts";
import {
  type YamlParseOptions,
  type YamlParserProvider,
  YamlParserProviderName,
} from "#veryfront/extensions/parser/yaml-parser.ts";

/**
 * Every framework call site for this module is synchronous. Front matter
 * extraction runs inside synchronous render and build paths, so the
 * extension-owned parser must be available before `parse` is first callable.
 * Top-level await is the same mechanism `src/agent/runtime/skill-metadata.ts`
 * uses to load this extension's Skill parser for its own synchronous callers.
 */
const defaultProvider = await loadDefaultYamlParserProvider();

function requireProvider(): YamlParserProvider {
  // Extension orchestration owns the binding when an app configured one; the
  // product distribution's default only fills the gap.
  const registered = tryResolve<YamlParserProvider>(YamlParserProviderName);
  if (registered !== undefined) return registered;
  if (defaultProvider !== undefined) return defaultProvider;
  // Raises the registry's missing-extension error, whose detail names the
  // package to install. Never a bare throw.
  return resolve<YamlParserProvider>(YamlParserProviderName);
}

/** Decode one YAML document. */
export function parse(source: string, options?: YamlParseOptions): unknown {
  return requireProvider().parseYaml(source, options);
}

export type { YamlParseOptions };
