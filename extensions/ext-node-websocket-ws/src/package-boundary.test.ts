import { assertEquals } from "@std/assert";

Deno.test("ws extension is explicit and owns every third-party dependency", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  );

  assertEquals(manifest.veryfront.activation, "explicit");
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
