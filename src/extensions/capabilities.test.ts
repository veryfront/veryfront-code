import "#veryfront/schemas/_test-setup.ts";
/**
 * Capability audit and permission mapping tests.
 *
 * @module extensions/capabilities.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatCapabilities, mapToDenoPermissions } from "./capabilities.ts";
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
  });

  describe("mapToDenoPermissions()", () => {
    it("should map fs:read to --allow-read with paths", () => {
      const caps: Capability[] = [{ type: "fs:read", paths: ["./src", "./public"] }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-read=./src,./public"]);
    });

    it("rejects malformed scalar filesystem scopes", () => {
      assertThrows(
        () =>
          mapToDenoPermissions([{
            type: "fs:read",
            paths: "./src",
          } as unknown as Capability]),
        TypeError,
        "string array",
      );
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

    it("maps declared read-only system APIs without broadening access", () => {
      const caps: Capability[] = [{
        type: "system:read",
        apis: ["cpus", "getPriority", "cpus"],
      }];
      assertEquals(
        mapToDenoPermissions(caps),
        ["--allow-sys=cpus,getPriority"],
      );
    });

    it("requires an explicit, dense system API scope", () => {
      assertThrows(
        () => mapToDenoPermissions([{ type: "system:read" }]),
        TypeError,
        "system:read.apis must be an enumerable own data property",
      );
      assertThrows(
        () => mapToDenoPermissions([{ type: "system:read", apis: [] }]),
        TypeError,
        "must contain between 1 and",
      );

      const sparse = new Array<string>(1);
      assertThrows(
        () => mapToDenoPermissions([{ type: "system:read", apis: sparse }]),
        TypeError,
        "system:read.apis[0] must be an enumerable own data property",
      );
    });

    it("rejects unsupported and mutating system APIs", () => {
      for (const api of ["setPriority", "foobar", "cpus=all", "node:os.cpus"]) {
        assertThrows(
          () => mapToDenoPermissions([{ type: "system:read", apis: [api] }]),
          TypeError,
          "supported read-only Deno system API name",
        );
      }
    });

    it("does not invoke system scope accessors or custom iterators", () => {
      let accessorReads = 0;
      const accessorCapability = { type: "system:read" } as Capability;
      Object.defineProperty(accessorCapability, "apis", {
        enumerable: true,
        get() {
          accessorReads++;
          return ["cpus"];
        },
      });
      assertThrows(
        () => mapToDenoPermissions([accessorCapability]),
        TypeError,
        "own data property",
      );
      assertEquals(accessorReads, 0);

      let iteratorReads = 0;
      const apis = ["cpus"];
      Object.defineProperty(apis, Symbol.iterator, {
        get() {
          iteratorReads++;
          throw new Error("iterator must not be read");
        },
      });
      assertEquals(
        mapToDenoPermissions([{ type: "system:read", apis }]),
        ["--allow-sys=cpus"],
      );
      assertEquals(iteratorReads, 0);
    });

    it("rejects inherited scopes and hostile proxy inspection", () => {
      const inherited = Object.assign(
        Object.create({ apis: ["cpus"] }),
        { type: "system:read" },
      ) as Capability;
      assertThrows(
        () => mapToDenoPermissions([inherited]),
        TypeError,
        "own data property",
      );

      const proxy = new Proxy(
        { type: "system:read", apis: ["cpus"] },
        {
          getOwnPropertyDescriptor(target, property) {
            if (property === "apis") throw new Error("blocked");
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
        },
      );
      assertThrows(
        () => mapToDenoPermissions([proxy]),
        TypeError,
        "could not be inspected",
      );
    });

    it("cannot be broadened by poisoned Set operations", () => {
      const originalHas = Set.prototype.has;
      let rejected: unknown;
      let allowed: string[] | undefined;
      try {
        Set.prototype.has = () => true;
        try {
          mapToDenoPermissions([{
            type: "system:read",
            apis: ["setPriority"],
          }]);
        } catch (error) {
          rejected = error;
        }
        allowed = mapToDenoPermissions([{
          type: "system:read",
          apis: ["cpus"],
        }]);
      } finally {
        Set.prototype.has = originalHas;
      }

      assertEquals(rejected instanceof TypeError, true);
      assertEquals(allowed, ["--allow-sys=cpus"]);
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
      const caps: Capability[] = [{ type: "custom:metadata", name: "diagnostic" }];
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
  });
});
