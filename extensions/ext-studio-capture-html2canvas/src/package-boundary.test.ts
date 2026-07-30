import { assert, assertEquals } from "@std/assert";
import rootConfig from "../../../deno.json" with { type: "json" };
import extensionConfig from "../deno.json" with { type: "json" };

const rootConfigUrl = new URL("../../../deno.json", import.meta.url);
const extensionConfigUrl = new URL("../deno.json", import.meta.url);

Deno.test("html2canvas Studio extension imports public Veryfront package subpaths", () => {
  const rootExports = rootConfig.exports as Record<string, string>;
  const extensionImports = extensionConfig.imports as Record<string, string>;

  for (const [specifier, target] of Object.entries(extensionImports)) {
    if (!specifier.startsWith("veryfront/")) continue;

    const exportName = `./${specifier.slice("veryfront/".length)}`;
    const exportTarget = rootExports[exportName];
    assert(
      typeof exportTarget === "string",
      `${specifier} must be a public root package export`,
    );
    assertEquals(
      new URL(exportTarget, rootConfigUrl).href,
      new URL(target, extensionConfigUrl).href,
      `${specifier} must resolve to its public root package export`,
    );
  }
});

Deno.test("html2canvas Studio extension requires explicit project configuration", () => {
  assertEquals(extensionConfig.veryfront.activation, "explicit");
});
