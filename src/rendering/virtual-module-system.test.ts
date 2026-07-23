import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { VirtualModuleSystem } from "./virtual-module-system.ts";

describe("rendering/virtual-module-system", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("matches only the configured URL namespace boundary", () => {
    const system = new VirtualModuleSystem("/_veryfront/modules", createMockAdapter());
    assertEquals(
      system.handleRequest(new Request("http://localhost/_veryfront/modules-evil/component:x")),
      null,
    );
  });

  it("returns a controlled response for malformed identifiers and unsupported methods", () => {
    const system = new VirtualModuleSystem("/_veryfront/modules", createMockAdapter());
    assertEquals(
      system.handleRequest(new Request("http://localhost/_veryfront/modules/%E0%A4%A"))?.status,
      400,
    );
    assertEquals(
      system.handleRequest(
        new Request("http://localhost/_veryfront/modules/component:x", { method: "POST" }),
      )?.status,
      405,
    );
    assertEquals(
      system.handleRequest(
        new Request("http://localhost/_veryfront/modules/component:x", { method: "OPTIONS" }),
      )?.status,
      204,
    );
  });

  it("bounds retained modules and serves HEAD without a response body", async () => {
    const system = new VirtualModuleSystem("/_veryfront/modules", createMockAdapter(), {
      maxModules: 2,
    });
    await system.registerModule("component:first", "export default 1", "/project", "js");
    await system.registerModule("component:second", "export default 2", "/project", "js");
    await system.registerModule("component:third", "export default 3", "/project", "js");

    assertEquals(system.getModule("component:first"), undefined);
    const response = system.handleRequest(
      new Request("http://localhost/_veryfront/modules/component%3Athird", { method: "HEAD" }),
    );
    assertEquals(response?.status, 200);
    assertEquals(await response?.text(), "");
    assertEquals(response?.headers.get("access-control-allow-origin"), null);
  });

  it("uses the module lexer to rewrite nested static and dynamic relative imports", async () => {
    const system = new VirtualModuleSystem("/_veryfront/modules", createMockAdapter());
    await system.registerModule(
      "component:entry",
      'import Button from "./nested/Button.tsx"; export const load = () => import("../Card.jsx"); export default Button;',
      "/project",
      "tsx",
    );
    const transformed = system.getModule("component:entry")?.transformed ?? "";

    assertEquals(transformed.includes("/_veryfront/modules/component:Button"), true);
    assertEquals(transformed.includes("/_veryfront/modules/component:Card"), true);
  });

  it("rejects invalid IDs before compilation", async () => {
    const system = new VirtualModuleSystem("/_veryfront/modules", createMockAdapter());
    await assertRejects(
      () => system.registerModule("../outside", "export default 1", "/project", "js"),
      TypeError,
      "unsupported characters",
    );
  });
});
