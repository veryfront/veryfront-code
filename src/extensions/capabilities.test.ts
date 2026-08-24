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
      assertEquals(lines[0], '"fs:read" ("paths": ["./src"])');
      assertEquals(lines[1], '"net:outbound" ("hosts": ["api.example.com"])');
      assertEquals(lines[2], '"custom:metadata" ("name": "diagnostic")');
    });

    it("should handle capabilities with no extra fields", () => {
      const caps: Capability[] = [{ type: "native:ffi" }];
      const lines = formatCapabilities(caps);
      assertEquals(lines, ['"native:ffi"']);
    });

    it("should return empty array for empty input", () => {
      assertEquals(formatCapabilities([]), []);
    });

    it("rejects cyclic and bigint metadata before startup audit", () => {
      const metadata: Record<string, unknown> = { count: 1n };
      metadata.self = metadata;

      assertThrows(
        () => formatCapabilities([{ type: "custom:metadata", metadata }]),
        TypeError,
        "must contain only JSON-safe values",
      );
    });

    it("rejects capability metadata getters without invoking them", () => {
      const capability = { type: "custom:metadata" } as Capability;
      let getterCalls = 0;
      Object.defineProperty(capability, "secret", {
        enumerable: true,
        get() {
          getterCalls++;
          throw new Error("metadata blocked");
        },
      });

      assertThrows(
        () => formatCapabilities([capability]),
        TypeError,
        "must be an enumerable own data property",
      );
      assertEquals(getterCalls, 0);
    });
  });

  describe("mapToDenoPermissions()", () => {
    it("should map fs:read to --allow-read with paths", () => {
      const caps: Capability[] = [{ type: "fs:read", paths: ["./src", "./public"] }];
      const perms = mapToDenoPermissions(caps);
      assertEquals(perms, ["--allow-read=./src,./public"]);
    });

    it("maps fs:write to a scoped --allow-write and keeps read and write flags separate", () => {
      assertEquals(
        mapToDenoPermissions([{ type: "fs:write", paths: ["./dist", "./cache"] }]),
        ["--allow-write=./dist,./cache"],
        "fs:write must emit a path-scoped --allow-write",
      );
      assertEquals(
        mapToDenoPermissions([
          { type: "fs:read", paths: ["./src"] },
          { type: "fs:write", paths: ["./dist"] },
        ]),
        ["--allow-read=./src", "--allow-write=./dist"],
        "fs:read and fs:write scopes must not merge into one flag",
      );
      assertEquals(
        mapToDenoPermissions([{ type: "fs:write" }]),
        ["--allow-write"],
        "an unscoped fs:write stays unscoped",
      );
    });

    it("maps native:ffi to exactly --allow-ffi", () => {
      assertEquals(
        mapToDenoPermissions([{ type: "native:ffi" }]),
        ["--allow-ffi"],
        "native:ffi must map to --allow-ffi and nothing broader",
      );
      assertEquals(
        mapToDenoPermissions([{ type: "native:ffi" }, { type: "env:read", keys: ["A"] }]),
        ["--allow-ffi", "--allow-env=A"],
        "an unscoped ffi flag must aggregate alongside scoped flags, not replace them",
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

    it("maps scoped system reads without granting unrestricted system access", () => {
      const caps: Capability[] = [{ type: "system:read", apis: ["cpus"] }];
      assertEquals(mapToDenoPermissions(caps), ["--allow-sys=cpus"]);
    });

    it("requires system:read scopes instead of emitting bare --allow-sys", () => {
      assertThrows(
        () => mapToDenoPermissions([{ type: "system:read" }]),
        TypeError,
        "capabilities[0].apis must be a non-empty array",
      );
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

    it("aggregates repeated and shared Deno permission flags", () => {
      assertEquals(
        mapToDenoPermissions([
          { type: "env:read", keys: ["A"] },
          { type: "env:read", keys: ["B", "A"] },
        ]),
        ["--allow-env=A,B"],
      );
      assertEquals(
        mapToDenoPermissions([
          { type: "net:outbound", hosts: ["api.example.com:443"] },
          { type: "net:listen", ports: [3000] },
        ]),
        ["--allow-net=api.example.com:443,localhost:3000"],
      );
    });

    it("lets an explicit unscoped permission subsume narrower duplicates", () => {
      assertEquals(
        mapToDenoPermissions([
          { type: "fs:read", paths: ["./src"] },
          { type: "fs:read" },
          { type: "fs:read", paths: ["./public"] },
        ]),
        ["--allow-read"],
      );
      assertEquals(
        mapToDenoPermissions([
          { type: "net:outbound", hosts: ["*"] },
          { type: "net:listen", ports: [3000] },
        ]),
        ["--allow-net"],
      );
    });

    it("serializes the supported network host grammar", () => {
      assertEquals(
        mapToDenoPermissions([
          {
            type: "net:outbound",
            hosts: [
              "example.com",
              "*.hf.co:443",
              "127.0.0.1:8080",
              "[::1]",
              "[2001:db8::1]:8443",
            ],
          },
          { type: "net:listen", host: "[::1]", ports: [3000, "8080"] },
        ]),
        [
          "--allow-net=example.com,*.hf.co:443,127.0.0.1:8080,[::1],[2001:db8::1]:8443,[::1]:3000,[::1]:8080",
        ],
      );
    });

    it("snapshots scope data once before serialization", () => {
      const scopes = new Proxy(["safe"], {
        get(target, property, receiver) {
          if (property === "0") return "safe,/";
          return Reflect.get(target, property, receiver);
        },
      });

      assertEquals(
        mapToDenoPermissions([{ type: "fs:read", paths: scopes }]),
        ["--allow-read=safe"],
      );
    });

    it("ignores unknown capability names without prototype lookup", () => {
      assertEquals(
        mapToDenoPermissions([
          { type: "constructor" },
          { type: "toString" },
          { type: "custom:metadata", value: "diagnostic" },
        ]),
        [],
      );
    });

    it("requires unknown capability metadata to remain bounded JSON data", () => {
      const cyclic: Record<string, unknown> = { type: "custom:metadata" };
      cyclic.self = cyclic;
      assertThrows(
        () => mapToDenoPermissions([cyclic as Capability]),
        TypeError,
        "unshared acyclic JSON tree",
      );

      const withSymbol = { type: "custom:metadata" } as Capability;
      Object.defineProperty(withSymbol, Symbol("secret"), {
        enumerable: true,
        value: true,
      });
      assertThrows(
        () => mapToDenoPermissions([withSymbol]),
        TypeError,
        "must not contain symbol properties",
      );

      const withAccessor = { type: "custom:metadata" } as Capability;
      Object.defineProperty(withAccessor, "secret", {
        enumerable: true,
        get() {
          throw new Error("must not run");
        },
      });
      assertThrows(
        () => mapToDenoPermissions([withAccessor]),
        TypeError,
        "secret must be an enumerable own data property",
      );
    });

    it("bounds the runtime capability inventory before inspection", () => {
      const oversized = Array.from(
        { length: 257 },
        () => ({ type: "custom:metadata" }),
      );
      assertThrows(
        () => mapToDenoPermissions(oversized),
        TypeError,
        "capabilities must contain at most 256 entries",
      );
    });

    it("rejects malformed scope fields with a contract-specific error", () => {
      assertThrows(
        () =>
          mapToDenoPermissions([
            { type: "fs:read", paths: "./src" } as Capability,
          ]),
        TypeError,
        "capabilities[0].paths must be a non-empty array",
      );
    });

    it("rejects present-but-empty scopes instead of broadening permissions", () => {
      for (
        const [capability, field] of [
          [{ type: "fs:read", paths: [] }, "paths"],
          [{ type: "fs:write", paths: [] }, "paths"],
          [{ type: "net:outbound", hosts: [] }, "hosts"],
          [{ type: "env:read", keys: [] }, "keys"],
          [{ type: "process:spawn", commands: [] }, "commands"],
          [{ type: "system:read", apis: [] }, "apis"],
          [{ type: "sandbox:execute", tools: [] }, "tools"],
        ] as const
      ) {
        assertThrows(
          () => mapToDenoPermissions([capability]),
          TypeError,
          `capabilities[0].${field} must be a non-empty array`,
        );
      }
    });

    it("rejects comma and control-character scope injection", () => {
      for (
        const [capability, field] of [
          [{ type: "fs:read", paths: ["./safe,/"] }, "paths"],
          [{ type: "env:read", keys: ["SAFE,SECRET"] }, "keys"],
          [{ type: "net:outbound", hosts: ["example.com,*"] }, "hosts"],
          [{ type: "process:spawn", commands: ["safe,sh"] }, "commands"],
          [{ type: "sandbox:execute", tools: ["safe\u0000shell"] }, "tools"],
        ] as const
      ) {
        assertThrows(
          () => mapToDenoPermissions([capability]),
          TypeError,
          `capabilities[0].${field}[0] must not contain`,
        );
      }
    });

    it("rejects ill-formed Unicode and line-forging scope characters", () => {
      for (
        const capability of [
          { type: "env:read", keys: ["SAFE\uD800KEY"] },
          { type: "fs:read", paths: ["./safe\uDC00path"] },
          { type: "env:read", keys: ["SAFE\u0085SECRET"] },
          { type: "fs:write", paths: ["./safe\u2028forged"] },
        ] as Capability[]
      ) {
        assertThrows(
          () => mapToDenoPermissions([capability]),
          TypeError,
        );
      }
    });

    it("bounds aggregate serialized Deno permission flags", () => {
      const keys = ["A", "B", "C"].map((prefix) => `${prefix}_${"x".repeat(3_000)}`);
      assertThrows(
        () => mapToDenoPermissions([{ type: "env:read", keys }]),
        TypeError,
        "serialized Deno permission flags exceed the cross-platform budget",
      );
    });

    it("rejects unsafe capability types before audit formatting", () => {
      for (const type of ["custom\uD800type", "custom\u0085type", "custom\u2029type"]) {
        assertThrows(
          () => formatCapabilities([{ type }]),
          TypeError,
        );
      }
    });

    it("rejects audit-forging custom capability metadata", () => {
      for (
        const capability of [
          { type: "custom", details: "value\u0085FORGED" },
          { type: "custom", details: "value\u2028FORGED" },
          { type: "custom", details: "value\uD800FORGED" },
          { type: "custom", ["key\u2029FORGED"]: "value" },
        ] as Capability[]
      ) {
        assertThrows(() => formatCapabilities([capability]), TypeError);
      }
    });

    it("quotes extensible types and keys in audit output", () => {
      assertEquals(
        formatCapabilities([{
          type: 'native:ffi, env:read (keys: ["SECRET"])',
          ["safe: false), native:ffi ("]: true,
        }]),
        [
          '"native:ffi, env:read (keys: [\\"SECRET\\"])" ("safe: false), native:ffi (": true)',
        ],
      );
    });

    it("bounds aggregate capability metadata before audit formatting", () => {
      assertThrows(
        () =>
          formatCapabilities([{
            type: "custom",
            details: Array.from({ length: 5 }, () => "x".repeat(7_000)),
          }]),
        TypeError,
        "capabilities exceed 32768 aggregate UTF-8 bytes",
      );
    });

    it("bounds escaped capability audit output independently", () => {
      assertThrows(
        () =>
          formatCapabilities([{
            type: "custom",
            first: "\\".repeat(7_000),
            second: "\\".repeat(7_000),
            third: "\\".repeat(7_000),
            fourth: "\\".repeat(7_000),
          }]),
        TypeError,
        "formatted capability audit exceeds 49152 UTF-8 bytes",
      );
    });

    it("rejects known-capability typos before they become unscoped flags", () => {
      for (
        const capability of [
          { type: "fs:read", path: ["./safe"] },
          { type: "env:read", key: ["SAFE"] },
          { type: "net:outbound", host: ["example.com"] },
          { type: "process:spawn", command: ["safe"] },
          { type: "system:read", api: ["cpus"] },
          { type: "native:ffi", libraries: ["safe"] },
        ] as Capability[]
      ) {
        assertThrows(
          () => mapToDenoPermissions([capability]),
          TypeError,
          "contains unexpected field",
        );
      }
    });

    it("rejects unsupported Deno system API scopes", () => {
      for (
        const api of ["foobar", "cpus=all", "node:os.cpus", "1cpus", "cpus-"]
      ) {
        assertThrows(
          () => mapToDenoPermissions([{ type: "system:read", apis: [api] }]),
          TypeError,
          "must be a supported read-only Deno 2.7.7 system API name",
        );
      }
    });

    it("rejects Deno's mutating setPriority kind from system:read", () => {
      assertThrows(
        () =>
          mapToDenoPermissions([{
            type: "system:read",
            apis: ["setPriority"],
          }]),
        TypeError,
        "must be a supported read-only Deno 2.7.7 system API name",
      );
    });

    it("rejects inherited and accessor-backed scope state", () => {
      const inherited = Object.assign(
        Object.create({ paths: ["./safe"] }),
        { type: "fs:read" },
      ) as Capability;
      assertThrows(
        () => mapToDenoPermissions([inherited]),
        TypeError,
        "capabilities[0] must be a plain object",
      );

      const accessor = { type: "env:read" } as Capability;
      Object.defineProperty(accessor, "keys", {
        enumerable: true,
        get: () => ["SAFE"],
      });
      assertThrows(
        () => mapToDenoPermissions([accessor]),
        TypeError,
        "capabilities[0].keys must be an enumerable own data property",
      );
    });

    it("rejects listen scopes that could broaden or inject network access", () => {
      assertThrows(
        () => mapToDenoPermissions([{ type: "net:listen", ports: [] }]),
        TypeError,
        "capabilities[0].ports must be a non-empty array",
      );
      assertThrows(
        () => mapToDenoPermissions([{ type: "net:listen", host: "localhost" }]),
        TypeError,
        "capabilities[0].host requires a non-empty ports array",
      );
      assertThrows(
        () =>
          mapToDenoPermissions([
            { type: "net:listen", host: "localhost,*", ports: [3000] },
          ]),
        TypeError,
        "capabilities[0].host must not contain commas or control characters",
      );
    });

    it("rejects scopes that Deno cannot interpret as declared", () => {
      assertThrows(
        () => mapToDenoPermissions([{ type: "env:read", keys: ["A=B"] }]),
        TypeError,
        "capabilities[0].keys[0] must not contain =",
      );
      for (
        const host of [
          "https://example.com",
          "example.com/path",
          "::1",
          "999.1.1.1",
          "01.2.3.4",
        ]
      ) {
        assertThrows(
          () => mapToDenoPermissions([{ type: "net:outbound", hosts: [host] }]),
          TypeError,
        );
      }
      assertThrows(
        () =>
          mapToDenoPermissions([
            { type: "net:outbound", hosts: ["*", "example.com"] },
          ]),
        TypeError,
        'hosts must contain only "*"',
      );
    });

    it("rejects invalid listen ports instead of emitting malformed flags", () => {
      assertThrows(
        () =>
          mapToDenoPermissions([
            { type: "net:listen", ports: [0, 65_536] } as Capability,
          ]),
        TypeError,
        "capabilities[0].ports[0] must be an integer from 1 through 65535",
      );
    });
  });
});
