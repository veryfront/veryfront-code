import "#veryfront/schemas/_test-setup.ts";
/**
 * Capability audit and permission mapping tests.
 *
 * @module extensions/capabilities.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
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
  });
});
