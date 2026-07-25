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

    it("formats cyclic and bigint metadata without crashing startup audit", () => {
      const metadata: Record<string, unknown> = { count: 1n };
      metadata.self = metadata;

      assertEquals(
        formatCapabilities([{ type: "custom:metadata", metadata }]),
        [
          'custom:metadata (metadata: {"count":"1n","self":"[Circular]"})',
        ],
      );
    });

    it("isolates capability metadata getters that throw", () => {
      const capability = { type: "custom:metadata" } as Capability;
      Object.defineProperty(capability, "secret", {
        enumerable: true,
        get() {
          throw new Error("metadata blocked");
        },
      });

      assertEquals(
        formatCapabilities([capability]),
        ["custom:metadata (secret: [unavailable: metadata blocked])"],
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

    it("rejects malformed scope fields with a contract-specific error", () => {
      assertThrows(
        () =>
          mapToDenoPermissions([
            { type: "fs:read", paths: "./src" } as Capability,
          ]),
        TypeError,
        "capabilities[0].paths must be an array of non-empty strings",
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
