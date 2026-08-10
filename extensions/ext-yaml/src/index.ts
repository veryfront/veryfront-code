/**
 * Official `yaml` (eemeli, YAML 1.2) implementation of the framework's YAML
 * extension contracts.
 *
 * Provides both the narrow `SkillDocumentParserProvider` used at the Skill
 * document trust boundary and the general `YamlParserProvider` the framework's
 * `#std/yaml/parse` compatibility shim resolves.
 *
 * @module extensions/ext-yaml
 */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  SkillDocumentParserProviderName,
  YamlParserProviderName,
} from "veryfront/extensions/parser";
import extensionPackage from "../deno.json" with { type: "json" };
import { createStdYamlSkillDocumentParserProvider, createYamlParser } from "./adapter.ts";

const extYaml: ExtensionFactory = () => {
  const skillParser = createStdYamlSkillDocumentParserProvider();
  const yamlParser = createYamlParser();

  return {
    name: "ext-yaml",
    version: extensionPackage.version,
    contracts: {
      provides: [SkillDocumentParserProviderName, YamlParserProviderName],
    },
    capabilities: [],
    setup(ctx) {
      ctx.provide(SkillDocumentParserProviderName, skillParser);
      ctx.provide(YamlParserProviderName, yamlParser);
      ctx.logger.debug(
        "[ext-yaml] SkillDocumentParserProvider and YamlParserProvider registered",
      );
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extYaml;
export {
  createStdYamlSkillDocumentParserProvider,
  createYamlParser,
  parseYamlSource,
} from "./adapter.ts";
