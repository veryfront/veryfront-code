import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext } from "veryfront/extensions";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  type YamlParserProvider,
  YamlParserProviderName,
} from "veryfront/extensions/parser";
import manifest from "../deno.json" with { type: "json" };
import extYaml from "./index.ts";

describe("ext-yaml", () => {
  it("declares the parser contract without framework capabilities", () => {
    const extension = extYaml();

    assertEquals(extension.name, "ext-yaml");
    assertEquals(extension.version, manifest.version);
    assertEquals(extension.contracts?.provides, [
      SkillDocumentParserProviderName,
      YamlParserProviderName,
    ]);
    assertEquals(extension.capabilities, []);
    assertEquals(manifest.veryfront.contracts.provides, [
      SkillDocumentParserProviderName,
      YamlParserProviderName,
    ]);
    assertEquals(manifest.veryfront.capabilities, []);
    assertEquals(manifest.veryfront.activation, "auto");
    // The parser is the extension's whole reason to exist and the only place
    // in the repository allowed to depend on it; pin it here so a version
    // bump is a deliberate edit to this test.
    assertEquals(manifest.imports["yaml"], "npm:yaml@2.9.0");
  });

  it("provides a working synchronous parser through the extension context", async () => {
    let providedParser: SkillDocumentParserProvider | undefined;
    let providedYamlParser: YamlParserProvider | undefined;
    const ctx: ExtensionContext = {
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      get: () => undefined,
      require: () => {
        throw new Error("require is unused");
      },
      provide: (contract, implementation) => {
        if (contract === SkillDocumentParserProviderName) {
          providedParser = implementation as SkillDocumentParserProvider;
        }
        if (contract === YamlParserProviderName) {
          providedYamlParser = implementation as YamlParserProvider;
        }
      },
    };

    const extension = extYaml();
    await extension.setup?.(ctx);

    assert(providedParser);
    assertEquals(providedParser.parseFrontmatter("name: demo"), {
      name: "demo",
    });
    assertEquals(Object.isFrozen(providedParser), true);

    assert(providedYamlParser);
    assertEquals(providedYamlParser.parseYaml("name: demo"), { name: "demo" });
    assertEquals(Object.isFrozen(providedYamlParser), true);
  });
});
