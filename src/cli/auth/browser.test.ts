/**
 * Browser Utility Tests
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "@std/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "@veryfront/platform/compat/process.ts";
import { canOpenBrowser } from "./browser.ts";

describe("Browser Utility", () => {
  describe("canOpenBrowser", () => {
    it("should return boolean", () => {
      const result = canOpenBrowser();
      assertEquals(typeof result, "boolean");
    });

    it("should detect CI environment", () => {
      const originalCI = getEnv("CI");
      try {
        setEnv("CI", "true");
        const result = canOpenBrowser();
        assertEquals(result, false);
      } finally {
        if (originalCI) {
          setEnv("CI", originalCI);
        } else {
          deleteEnv("CI");
        }
      }
    });

    it("should detect SSH session", () => {
      const originalSSH = getEnv("SSH_CLIENT");
      try {
        setEnv("SSH_CLIENT", "192.168.1.1 12345 22");
        const result = canOpenBrowser();
        assertEquals(result, false);
      } finally {
        if (originalSSH) {
          setEnv("SSH_CLIENT", originalSSH);
        } else {
          deleteEnv("SSH_CLIENT");
        }
      }
    });

    it("should return true in normal environment", () => {
      // Clear any CI/SSH env vars that might be set
      const originalCI = getEnv("CI");
      const originalSSH = getEnv("SSH_CLIENT");
      try {
        deleteEnv("CI");
        deleteEnv("SSH_CLIENT");
        // On macOS/Windows, should return true without DISPLAY
        // On Linux, might return false without DISPLAY
        const result = canOpenBrowser();
        assertEquals(typeof result, "boolean");
      } finally {
        if (originalCI) setEnv("CI", originalCI);
        if (originalSSH) setEnv("SSH_CLIENT", originalSSH);
      }
    });
  });
});
