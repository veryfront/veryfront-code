/**
 * Product-distribution default for the general YAML parser contract.
 *
 * Mirrors `skill-defaults.ts`: the first-party `ext-yaml` extension owns the
 * third-party parser, and core reaches it through a dynamic import so the root
 * package never statically depends on it. An installation without the
 * extension simply has no default, and the call site raises the registry's
 * missing-extension error.
 *
 * @module extensions/parser/yaml-defaults
 */

import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "#veryfront/extensions/first-party-import.ts";
import { snapshotYamlParserProvider, type YamlParserProvider } from "./yaml-parser.ts";

const DEFAULT_YAML_SOURCE_DIRECTORY = "ext-yaml";
const DEFAULT_YAML_EXTENSION_PACKAGE = "@veryfront/ext-yaml";
const DEFAULT_YAML_FACTORY_EXPORT = "createYamlParser";

interface YamlExtensionModule {
  readonly createYamlParser?: unknown;
}

function readProviderFactory(extensionModule: unknown): () => unknown {
  if (
    extensionModule === null ||
    (typeof extensionModule !== "object" && typeof extensionModule !== "function")
  ) {
    throw new TypeError(
      `Invalid ${DEFAULT_YAML_EXTENSION_PACKAGE} module: expected a module namespace`,
    );
  }

  let factory: unknown;
  try {
    factory = (extensionModule as YamlExtensionModule).createYamlParser;
  } catch (cause) {
    throw new TypeError(
      `Invalid ${DEFAULT_YAML_EXTENSION_PACKAGE} module: could not read export "${DEFAULT_YAML_FACTORY_EXPORT}"`,
      { cause },
    );
  }
  if (typeof factory !== "function") {
    throw new TypeError(
      `Invalid ${DEFAULT_YAML_EXTENSION_PACKAGE} module: export "${DEFAULT_YAML_FACTORY_EXPORT}" must be callable`,
    );
  }
  return factory as () => unknown;
}

/**
 * Load the product distribution's extension-owned default YAML parser.
 *
 * Returns undefined when the extension is not installed. A load failure
 * *inside* an installed extension is rethrown: that is a broken installation,
 * not an absent one, and hiding it would surface later as a confusing
 * "install @veryfront/ext-yaml" message for an extension that is present.
 */
export async function loadDefaultYamlParserProvider(): Promise<
  Readonly<YamlParserProvider> | undefined
> {
  let extensionModule: unknown;
  try {
    extensionModule = await importFirstPartyExtensionModule<unknown>(
      DEFAULT_YAML_SOURCE_DIRECTORY,
      DEFAULT_YAML_EXTENSION_PACKAGE,
    );
  } catch (error) {
    if (
      !isMissingFirstPartyExtensionModule(error, [
        "extensions/ext-yaml/src/index",
        DEFAULT_YAML_EXTENSION_PACKAGE,
      ])
    ) {
      throw error;
    }
    return undefined;
  }

  return snapshotYamlParserProvider(readProviderFactory(extensionModule)());
}
