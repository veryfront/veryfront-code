import "#veryfront/schemas/_test-setup.ts";
/**
 * Capability audit and permission mapping tests.
 *
 * @module extensions/capabilities.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { auditCapabilities, formatCapabilities, mapToDenoPermissions } from "./capabilities.ts";
import type { Capability } from "./types.ts";

describe("capabilities", () => {
  describe("formatCapabilities()", () => {
    it("should format a list of capabilities as human-readable strings", () => {
      const caps: Capability[] = [
        { type: "fs:read", paths: ["./src"] },
        { type: "net:outbound", hosts: ["api.example.com"] },
        { type: "custom:metadata", name: "diagnostic" },
      ];
      const lines = formatCapabilities(caps);
      assertEquals(lines.length, 3);
      assertEquals(lines[0], 'fs:read (paths: ["./src"])');
      assertEquals(lines[1], 'net:outbound (hosts: ["api.example.com"])');
      assertEquals(lines[2], 'custom:metadata (name: "diagnostic")');
    });

    it("should handle capabilities with no extra fields", () => {
      const caps: Capability[] = [{ type: "native:ffi" }];
      const lines = formatCapabilities(caps);
      assertEquals(lines, ["native:ffi"]);
    });

    it("should return empty array for empty input", () => {
      assertEquals(formatCapabilities([]), []);
    });

    it("bounds and safely formats cyclic and non-JSON metadata", () => {
      const metadata: Record<string, unknown> = { count: 1n };
      metadata.self = metadata;

      assertEquals(
        formatCapabilities([{ type: "custom:metadata", metadata }]),
        ['custom:metadata (metadata: {"count":"1n","self":"[circular]"})'],
      );
    });

    it("contains hostile metadata access", () => {
      const capability = { type: "custom:metadata" } as Capability;
      Object.defineProperty(capability, "secret", {
        enumerable: true,
        get() {
          throw new Error("private-capability-value");
        },
      });

      assertEquals(
        formatCapabilities([capability]),
        ['custom:metadata (secret: "[unavailable]")'],
      );
    });

    it("rejects control-character types and escapes unsafe property labels", () => {
      assertThrows(
        () => formatCapabilities([{ type: "fs:read\nforged" }]),
        TypeError,
      );
      assertEquals(
        formatCapabilities([{ type: "custom:metadata", "unsafe\nlabel": true }]),
        ['custom:metadata ("unsafe\\nlabel": true)'],
      );
    });

    it("contains hostile capability collection access", () => {
      const canary = "private-capability-collection";
      const hostile = new Proxy([{ type: "fs:read" }], {
        get(target, property, receiver) {
          if (property === "0") throw new Error(canary);
          return Reflect.get(target, property, receiver);
        },
      });

      let error: unknown;
      try {
        formatCapabilities(hostile);
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof TypeError, true);
      assertEquals(String(error).includes(canary), false);

      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      assertThrows(
        () => formatCapabilities([revoked.proxy as Capability]),
        TypeError,
        "capability must be an object",
      );
    });
  });

  describe("mapToDenoPermissions()", () => {
    it("should map fs:read to --allow-read with paths", () => {
      const caps: Capability[] = [{ type: "fs:read", paths: ["./src", "./public"] }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-read=./src,./public"]);
    });

    it("should map net:outbound to --allow-net with hosts", () => {
      const caps: Capability[] = [{ type: "net:outbound", hosts: ["api.example.com"] }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-net=api.example.com"]);
    });

    it("should map env:read to --allow-env with keys", () => {
      const caps: Capability[] = [{ type: "env:read", keys: ["DATABASE_URL"] }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-env=DATABASE_URL"]);
    });

    it("should map process:spawn to --allow-run with commands", () => {
      const caps: Capability[] = [{ type: "process:spawn", commands: ["esbuild"] }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-run=esbuild"]);
    });

    it("should map net:listen ports to localhost:port by default", () => {
      const caps: Capability[] = [{ type: "net:listen", ports: [3000, 8080] }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-net=localhost:3000,localhost:8080"]);
    });

    it("should map net:listen with explicit host", () => {
      const caps: Capability[] = [{ type: "net:listen", ports: [3000], host: "0.0.0.0" }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-net=0.0.0.0:3000"]);
    });

    it("should map fs:read without paths to unscoped --allow-read", () => {
      const caps: Capability[] = [{ type: "fs:read" }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-read"]);
    });

    it("should skip capabilities without a Deno permission mapping", () => {
      const caps: Capability[] = [
        { type: "custom:metadata", name: "diagnostic" },
        { type: "__proto__" },
        { type: "toString" },
      ];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, []);
    });

    it("should deduplicate permission flags", () => {
      const caps: Capability[] = [
        { type: "fs:read", paths: ["./src"] },
        { type: "fs:read", paths: ["./src"] },
      ];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-read=./src"]);
    });

    it("rejects malformed or ambiguous permission scopes", () => {
      for (
        const capability of [
          { type: "fs:read", paths: "./src" },
          { type: "fs:read", paths: ["one,two"] },
          { type: "env:read", keys: [""] },
          { type: "net:listen", ports: [0] },
          { type: "net:listen", ports: [65_536] },
          { type: "net:listen", ports: [3_000], host: "host\nname" },
          { type: "fs:read\nforged", paths: ["./src"] },
        ]
      ) {
        assertThrows(
          () => mapToDenoPermissions([capability as Capability]),
          TypeError,
        );
      }

      const hostile = { type: "fs:read" } as Capability;
      Object.defineProperty(hostile, "paths", {
        get() {
          throw new Error("private-permission-scope");
        },
      });
      let error: unknown;
      try {
        mapToDenoPermissions([hostile]);
      } catch (caught) {
        error = caught;
      }
      assertEquals(error instanceof TypeError, true);
      assertEquals(String(error).includes("private-permission-scope"), false);
    });

    it("contains hostile capability and scope collection access", () => {
      const canary = "private-permission-collection";
      const hostileCapabilities = new Proxy([{ type: "fs:read" }], {
        get(target, property, receiver) {
          if (property === "0") throw new Error(canary);
          return Reflect.get(target, property, receiver);
        },
      });
      const hostileScopes = new Proxy(["./src"], {
        get(target, property, receiver) {
          if (property === "0") throw new Error(canary);
          return Reflect.get(target, property, receiver);
        },
      });
      const revokedCapability = Proxy.revocable({}, {});
      revokedCapability.revoke();

      for (
        const operation of [
          () => mapToDenoPermissions(hostileCapabilities),
          () => mapToDenoPermissions([{ type: "fs:read", paths: hostileScopes }]),
          () => mapToDenoPermissions([revokedCapability.proxy as Capability]),
        ]
      ) {
        let error: unknown;
        try {
          operation();
        } catch (caught) {
          error = caught;
        }
        assertEquals(error instanceof TypeError, true);
        assertEquals(String(error).includes(canary), false);
      }
    });
  });

  describe("auditCapabilities()", () => {
    it("does not emit capability scopes or let logger failures escape", () => {
      const canary = "/private/customer/canary";
      const messages: string[] = [];
      auditCapabilities(
        "safe-extension",
        [{ type: "fs:read", paths: [canary] }],
        {
          debug: () => {},
          info: (message, ...args) => messages.push(message, ...args.map(String)),
          warn: () => {},
          error: () => {},
        },
      );
      assertEquals(messages.join(" ").includes(canary), false);

      auditCapabilities("safe-extension", [{ type: "fs:read" }], {
        debug: () => {
          throw new Error("logger failed");
        },
        info: () => {
          throw new Error("logger failed");
        },
        warn: () => {
          throw new Error("logger failed");
        },
        error: () => {
          throw new Error("logger failed");
        },
      });
    });

    it("contains malformed inputs and hostile logger access", () => {
      const hostileLogger = new Proxy({}, {
        get() {
          throw new Error("private-logger-state");
        },
      });

      auditCapabilities("safe-extension", null as unknown as Capability[], hostileLogger as never);
      auditCapabilities(
        "safe-extension",
        Array.from({ length: 129 }, () => ({ type: "fs:read" })),
        hostileLogger as never,
      );
      auditCapabilities("safe-extension", [{ type: "fs:read" }], hostileLogger as never);
    });
  });
});
