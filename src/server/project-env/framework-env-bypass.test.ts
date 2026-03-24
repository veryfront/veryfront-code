/**
 * Regression tests for framework-owned env reads under project overlays.
 *
 * When a remote project env overlay is active, getEnv() intentionally blocks
 * host env fallthrough. Framework-owned configuration (e.g. VERYFRONT_API_TOKEN,
 * VERYFRONT_DEBUG) must use getHostEnv() to bypass the overlay, otherwise
 * proxy mode breaks for framework operations.
 *
 * See: https://github.com/veryfront/veryfront-code/issues/635
 *
 * @module server/project-env/framework-env-bypass.test
 */

import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";

// Import storage to register globalThis hooks
import { runWithProjectEnv } from "./storage.ts";

describe("framework-owned env bypass under project overlay", () => {
  /**
   * Simulates proxy mode: a project env overlay is active with tenant-specific
   * vars, but framework-owned keys like VERYFRONT_API_TOKEN must still be
   * reachable via getHostEnv().
   */
  it("getHostEnv reads VERYFRONT_API_TOKEN from host env when overlay is active", () => {
    const envKey = "VERYFRONT_API_TOKEN";
    const original = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-framework-token");

    try {
      runWithProjectEnv({ TENANT_SECRET: "tenant-value" }, () => {
        // getEnv must NOT return the host token (overlay blocks it)
        assertEquals(getEnv(envKey), undefined);

        // getHostEnv must return the host token (bypasses overlay)
        assertEquals(getHostEnv(envKey), "host-framework-token");
      });
    } finally {
      if (original === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, original);
      }
    }
  });

  it("getHostEnv reads VERYFRONT_DEBUG from host env when overlay is active", () => {
    const envKey = "VERYFRONT_DEBUG";
    const original = Deno.env.get(envKey);
    Deno.env.set(envKey, "1");

    try {
      runWithProjectEnv({}, () => {
        assertEquals(getEnv(envKey), undefined);
        assertEquals(getHostEnv(envKey), "1");
      });
    } finally {
      if (original === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, original);
      }
    }
  });

  it("getHostEnv reads CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY from host env when overlay is active", () => {
    const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
    const original = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-public-key");

    try {
      runWithProjectEnv({}, () => {
        assertEquals(getEnv(envKey), undefined);
        assertEquals(getHostEnv(envKey), "host-public-key");
      });
    } finally {
      if (original === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, original);
      }
    }
  });

  it("tenant overlay vars are accessible via getEnv but NOT via host fallthrough for other keys", () => {
    runWithProjectEnv({ OPENAI_API_KEY: "tenant-openai-key" }, () => {
      // Tenant-scoped env is available through getEnv
      assertEquals(getEnv("OPENAI_API_KEY"), "tenant-openai-key");

      // Host env is blocked for non-framework keys
      assertEquals(getEnv("PATH"), undefined);
    });
  });

  it("without overlay, getEnv and getHostEnv return the same value", () => {
    const envKey = "VERYFRONT_API_TOKEN";
    const original = Deno.env.get(envKey);
    Deno.env.set(envKey, "test-token-no-overlay");

    try {
      // No overlay active — both should return the same value
      assertEquals(getEnv(envKey), "test-token-no-overlay");
      assertEquals(getHostEnv(envKey), "test-token-no-overlay");
    } finally {
      if (original === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, original);
      }
    }
  });

  it("overlay can provide its own VERYFRONT_API_TOKEN that shadows host via getEnv", () => {
    const envKey = "VERYFRONT_API_TOKEN";
    const original = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-token");

    try {
      runWithProjectEnv({ VERYFRONT_API_TOKEN: "overlay-token" }, () => {
        // getEnv returns the overlay value
        assertEquals(getEnv(envKey), "overlay-token");

        // getHostEnv still returns the host value
        assertEquals(getHostEnv(envKey), "host-token");
      });
    } finally {
      if (original === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, original);
      }
    }
  });

  it("empty overlay blocks getEnv but getHostEnv still works for framework keys", () => {
    const envKey = "VERYFRONT_API_TOKEN";
    const original = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-token-empty-overlay");

    try {
      runWithProjectEnv({}, () => {
        assertEquals(getEnv(envKey), undefined);
        assertEquals(getHostEnv(envKey), "host-token-empty-overlay");
      });
    } finally {
      if (original === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, original);
      }
    }
  });
});
