import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { getRecommendation } from "#veryfront/extensions/recommendations.ts";
import {
  createYamlParserProvider,
  type YamlParseOptions,
  YamlParserProviderName,
} from "#veryfront/extensions/parser/yaml-parser.ts";
import { parse } from "./yaml.ts";

function withRegisteredProvider(
  parseYaml: (source: string, options?: YamlParseOptions) => unknown,
  body: () => void,
): void {
  register(YamlParserProviderName, createYamlParserProvider(parseYaml));
  try {
    body();
  } finally {
    unregister(YamlParserProviderName);
  }
}

describe("platform/compat/std/yaml", () => {
  it("should decode YAML through the extension-owned default parser", () => {
    assertEquals(parse("title: Typed\ncount: 42"), {
      title: "Typed",
      count: 42,
    });
  });

  it("should surface a malformed document as SyntaxError", () => {
    assertThrows(() => parse("name: first\nname: second"), SyntaxError);
  });

  it("should forward decoding options to the provider unchanged", () => {
    const seen: Array<[string, YamlParseOptions | undefined]> = [];
    withRegisteredProvider((source, options) => {
      seen.push([source, options]);
      return { decoded: true };
    }, () => {
      assertEquals(parse("a: 1", { allowDuplicateKeys: false, schema: "json" }), {
        decoded: true,
      });
    });

    assertEquals(seen, [["a: 1", { allowDuplicateKeys: false, schema: "json" }]]);
  });

  it("should prefer an app-registered provider over the built-in default", () => {
    withRegisteredProvider(() => "from-registered-provider", () => {
      assertEquals(parse("count: 42"), "from-registered-provider");
    });

    // The registration is scoped: the default is back once it is withdrawn.
    assertEquals(parse("count: 42"), { count: 42 });
  });

  it("should name the installable extension when the contract is unbound", () => {
    assertEquals(getRecommendation(YamlParserProviderName), "@veryfront/ext-yaml");
  });
});
