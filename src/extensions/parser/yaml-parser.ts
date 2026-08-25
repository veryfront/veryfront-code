/**
 * Extension boundary for general-purpose YAML decoding.
 *
 * Core owns front matter framing, mapping policy, and every call site's
 * downstream validation. Implementations own only YAML decoding, which is the
 * one part that needs a third-party parser and therefore may not live in core.
 *
 * This is a sibling of `SkillDocumentParserProvider`, not an extension of it,
 * for two reasons. First, `snapshotSkillDocumentParserProvider` enforces that
 * a provider has exactly one own key named `parseFrontmatter`; adding a second
 * method would mean weakening an invariant that guards an untrusted Skill
 * document trust boundary. Second, general YAML decoding needs the decoding
 * options (`schema`, `allowDuplicateKeys`) that the Skill contract
 * deliberately withholds so that core, not the extension, fixes Skill policy.
 *
 * @module extensions/parser/yaml-parser
 */

import { isNativePromiseWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

/** Stable runtime identifier for the general YAML parser contract. */
export const YamlParserProviderName = "YamlParserProvider" as const;

/**
 * Decoding options, named after the `@std/yaml` options the framework's call
 * sites already pass so that repointing a call site is a specifier change.
 */
export interface YamlParseOptions {
  /**
   * Accept a mapping that repeats a key. Defaults to false: a repeated key is
   * a source defect, and picking a winner silently hides it.
   */
  readonly allowDuplicateKeys?: boolean;
  /**
   * `"json"` restricts resolution to JSON-representable types. Use it at
   * trust boundaries where a timestamp, a binary blob, or any other
   * implementation-specific tag must not appear in the decoded value.
   */
  readonly schema?: "core" | "json";
}

/** Dependency-free contract implemented by YAML parser extensions. */
export interface YamlParserProvider {
  /**
   * Decode one YAML document.
   *
   * Implementations must be synchronous, must reject a source holding more
   * than one document, and must raise `SyntaxError` for malformed input. The
   * returned value is untrusted; core validates it at each call site.
   */
  readonly parseYaml: (source: string, options?: YamlParseOptions) => unknown;
}

function providerInspectionError(): TypeError {
  return new TypeError(
    "YAML parser provider must be an object with a callable parseYaml property",
  );
}

/**
 * Capture one immutable provider generation.
 *
 * The captured facade re-checks the synchronous contract on every call: an
 * implementation that returns a Promise would otherwise hand a pending value
 * to synchronous call sites that cannot await it, and the resulting `[object
 * Promise]` front matter is far harder to diagnose than a thrown TypeError.
 */
export function snapshotYamlParserProvider(
  value: unknown,
): Readonly<YamlParserProvider> {
  if (typeof value !== "object" || value === null) throw providerInspectionError();
  const descriptor = Object.getOwnPropertyDescriptor(value, "parseYaml");
  // An accessor descriptor has no own `value`, so a plain `descriptor.value`
  // read would return whatever a poisoned `Object.prototype.value` supplies.
  // Requiring the own property keeps an accessor-backed registration out.
  if (
    descriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
    typeof descriptor.value !== "function"
  ) {
    throw providerInspectionError();
  }

  const parseYaml = descriptor.value as YamlParserProvider["parseYaml"];
  const facade: YamlParserProvider = {
    parseYaml(source: string, options?: YamlParseOptions): unknown {
      if (typeof source !== "string") {
        throw new TypeError("YAML source must be a string");
      }
      const parsed = Reflect.apply(parseYaml, undefined, [source, options]);
      if (isNativePromiseWithoutHooks(parsed)) {
        throw new TypeError("YAML parser provider must be synchronous");
      }
      return parsed;
    },
  };
  return Object.freeze(facade);
}

/** Create immutable provider registration metadata from a standalone parser. */
export function createYamlParserProvider(
  parseYaml: YamlParserProvider["parseYaml"],
): Readonly<YamlParserProvider> {
  return snapshotYamlParserProvider({ parseYaml });
}
