import { assert, assertEquals } from "@std/assert";
import rootConfig from "../../../deno.json" with { type: "json" };
import extensionConfig from "../deno.json" with { type: "json" };
import browserImportMap from "../scripts/browser-import-map.json" with { type: "json" };

const rootConfigUrl = new URL("../../../deno.json", import.meta.url);
const extensionConfigUrl = new URL("../deno.json", import.meta.url);

Deno.test("React Dev UI extension imports only public Veryfront package subpaths", () => {
  const rootExports = rootConfig.exports as Record<string, string>;
  const extensionImports = extensionConfig.imports as Record<string, string>;

  for (const [specifier, target] of Object.entries(extensionImports)) {
    if (!specifier.startsWith("veryfront/")) continue;
    const exportName = `./${specifier.slice("veryfront/".length)}`;
    const exportTarget = rootExports[exportName];
    assert(typeof exportTarget === "string", `${specifier} must be a public package export`);
    assertEquals(
      new URL(exportTarget, rootConfigUrl).href,
      new URL(target, extensionConfigUrl).href,
      `${specifier} must resolve to its public package export`,
    );
  }
});

Deno.test("React Dev UI browser build maps only the public protocol subpath", () => {
  assertEquals(
    browserImportMap.imports["veryfront/extensions/dev-ui/protocol"],
    "../../../src/extensions/dev-ui/protocol.ts",
  );
  assertEquals(
    Object.keys(browserImportMap.imports).filter((specifier) => specifier.startsWith("veryfront/")),
    ["veryfront/extensions/dev-ui/protocol"],
  );
  assertEquals(
    new URL(rootConfig.exports["./extensions/dev-ui/protocol"], rootConfigUrl)
      .href,
    new URL(
      browserImportMap.imports["veryfront/extensions/dev-ui/protocol"],
      new URL("../scripts/browser-import-map.json", import.meta.url),
    ).href,
  );
});

Deno.test("React Dev UI extension is auto-activated without runtime capabilities", () => {
  assertEquals(extensionConfig.veryfront.activation, "auto");
  assertEquals(extensionConfig.veryfront.capabilities, []);
  assertEquals(extensionConfig.veryfront.npm.runtimeVersionFromManifest, true);
});
