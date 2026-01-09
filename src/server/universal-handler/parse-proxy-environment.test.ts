import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { parseProxyEnvironment } from "./index.ts";

Deno.test("parseProxyEnvironment", async (t) => {
  await t.step("returns 'preview' for valid preview value", () => {
    assertEquals(parseProxyEnvironment("preview"), "preview");
  });

  await t.step("returns 'production' for valid production value", () => {
    assertEquals(parseProxyEnvironment("production"), "production");
  });

  await t.step("returns undefined for null", () => {
    assertEquals(parseProxyEnvironment(null), undefined);
  });

  await t.step("returns undefined for empty string", () => {
    assertEquals(parseProxyEnvironment(""), undefined);
  });

  await t.step("returns undefined for invalid value", () => {
    assertEquals(parseProxyEnvironment("staging"), undefined);
    assertEquals(parseProxyEnvironment("dev"), undefined);
    assertEquals(parseProxyEnvironment("PREVIEW"), undefined);
    assertEquals(parseProxyEnvironment("PRODUCTION"), undefined);
  });
});
