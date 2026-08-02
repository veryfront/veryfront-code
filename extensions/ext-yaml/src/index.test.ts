import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext } from "veryfront/extensions";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
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
    ]);
    assertEquals(extension.capabilities, []);
    assertEquals(manifest.veryfront.contracts.provides, [
      SkillDocumentParserProviderName,
    ]);
    assertEquals(manifest.veryfront.capabilities, []);
    assertEquals(
      manifest.imports["@std/yaml/parse"],
      "jsr:@std/yaml@1.1.0/parse",
    );
  });

  it("provides a working synchronous parser through the extension context", async () => {
    let providedParser: SkillDocumentParserProvider | undefined;
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
      },
    };

    const extension = extYaml();
    await extension.setup?.(ctx);

    assert(providedParser);
    assertEquals(providedParser.parseFrontmatter("name: demo"), {
      name: "demo",
    });
    assertEquals(Object.isFrozen(providedParser), true);
  });
});
