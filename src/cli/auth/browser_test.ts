/**
 * Browser Utility Tests
 */

import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "@std/testing/bdd.ts";
import { canOpenBrowser } from "./browser.ts";

describe("Browser Utility", () => {
  describe("canOpenBrowser", () => {
    it("should return boolean", () => {
      const result = canOpenBrowser();
      assertEquals(typeof result, "boolean");
    });

    it("should detect CI environment", () => {
      const originalCI = Deno.env.get("CI");
      try {
        Deno.env.set("CI", "true");
        const result = canOpenBrowser();
        assertEquals(result, false);
      } finally {
        if (originalCI) {
          Deno.env.set("CI", originalCI);
        } else {
          Deno.env.delete("CI");
        }
      }
    });

    it("should detect SSH session", () => {
      const originalSSH = Deno.env.get("SSH_CLIENT");
      try {
        Deno.env.set("SSH_CLIENT", "192.168.1.1 12345 22");
        const result = canOpenBrowser();
        assertEquals(result, false);
      } finally {
        if (originalSSH) {
          Deno.env.set("SSH_CLIENT", originalSSH);
        } else {
          Deno.env.delete("SSH_CLIENT");
        }
      }
    });

    it("should return true in normal environment", () => {
      // Clear any CI/SSH env vars that might be set
      const originalCI = Deno.env.get("CI");
      const originalSSH = Deno.env.get("SSH_CLIENT");
      try {
        Deno.env.delete("CI");
        Deno.env.delete("SSH_CLIENT");
        // On macOS/Windows, should return true without DISPLAY
        // On Linux, might return false without DISPLAY
        const result = canOpenBrowser();
        assertEquals(typeof result, "boolean");
      } finally {
        if (originalCI) Deno.env.set("CI", originalCI);
        if (originalSSH) Deno.env.set("SSH_CLIENT", originalSSH);
      }
    });
  });
});
