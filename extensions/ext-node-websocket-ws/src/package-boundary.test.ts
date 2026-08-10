import { assertEquals } from "@std/assert";
import rootConfig from "../../../deno.json" with { type: "json" };
import * as rootExtensions from "../../../src/extensions/index.ts";
import extensionConfig from "../deno.json" with { type: "json" };

Deno.test("ws extension is auto-activated and owns every third-party dependency", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  );

  assertEquals(manifest.veryfront.activation, "auto");
  assertEquals(manifest.veryfront.contracts.provides, [
    "NodeWebSocketServerProvider",
  ]);
  assertEquals(manifest.veryfront.capabilities, [{
    type: "env:read",
    keys: ["WS_NO_BUFFER_UTIL", "WS_NO_UTF_8_VALIDATE"],
  }]);
  assertEquals(manifest.imports.ws, "npm:ws@8.21.1");
  assertEquals(manifest.imports["@types/ws"], "npm:@types/ws@8.18.1");
});

Deno.test("ws contracts stay behind the dedicated Node-only package subpath", () => {
  const rootExports = rootConfig.exports as Record<string, string>;
  const extensionImports = extensionConfig.imports as Record<string, string>;

  assertEquals(
    rootExports["./extensions/websocket"],
    "./src/extensions/websocket/index.ts",
  );
  assertEquals(
    extensionImports["veryfront/extensions/websocket"],
    "../../src/extensions/websocket/index.ts",
  );
  assertEquals("NodeWebSocketServerProviderName" in rootExtensions, false);
});
