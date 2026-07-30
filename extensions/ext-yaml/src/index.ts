/**
 * Official @std/yaml implementation of the SkillDocumentParserProvider
 * extension contract.
 *
 * @module extensions/ext-yaml
 */

import type { ExtensionFactory } from "veryfront/extensions";
import { SkillDocumentParserProviderName } from "veryfront/extensions/parser";
import extensionPackage from "../deno.json" with { type: "json" };
import { createStdYamlSkillDocumentParserProvider } from "./adapter.ts";

const extYaml: ExtensionFactory = () => {
  const provider = createStdYamlSkillDocumentParserProvider();

  return {
    name: "ext-yaml",
    version: extensionPackage.version,
    contracts: {
      provides: [SkillDocumentParserProviderName],
    },
    capabilities: [],
    setup(ctx) {
      ctx.provide(SkillDocumentParserProviderName, provider);
      ctx.logger.debug(
        "[ext-yaml] SkillDocumentParserProvider registered",
      );
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extYaml;
export { createStdYamlSkillDocumentParserProvider } from "./adapter.ts";
