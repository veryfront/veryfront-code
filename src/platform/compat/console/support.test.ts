import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { supportsColor } from "./support.ts";

function nodeHost(
  env: unknown,
  isTTY = true,
): Record<string, unknown> {
  return {
    process: {
      cwd: () => ".",
      env,
      release: { name: "node" },
      stdout: { isTTY },
      versions: { node: "22.0.0" },
    },
  };
}

describe("platform/compat/console/support", () => {
  it("fails closed when Node environment access is unavailable", () => {
    const inaccessibleEnvironment = new Proxy<Record<string, string>>({}, {
      get() {
        throw new Error("environment access denied");
      },
    });

    assertEquals(supportsColor(nodeHost(inaccessibleEnvironment)), false);
  });

  it("does not throw when runtime properties are hostile", () => {
    const hostileHost = new Proxy({}, {
      get() {
        throw new Error("property access denied");
      },
    });

    assertEquals(supportsColor(hostileHost), false);
  });

  it("lets forced color override redirected Node output", () => {
    assertEquals(supportsColor(nodeHost({ FORCE_COLOR: "1" }, false)), true);
  });

  it("does not style a Cloudflare runtime with a Node process shim", () => {
    const host = {
      caches: {},
      navigator: { userAgent: "Cloudflare-Workers" },
      process: (nodeHost({}, true) as { process: unknown }).process,
      WebSocketPair: class {},
    };

    assertEquals(supportsColor(host), false);
  });
});
