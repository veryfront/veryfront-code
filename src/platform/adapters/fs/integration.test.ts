import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  getFSAdapterType,
  isFSAdapterConfigured,
} from "./integration.ts";
import { denoAdapter } from "../deno.ts";

describe("integration.ts", () => {
  it("should export enhanceAdapterWithFS function", () => {
    assertExists(enhanceAdapterWithFS);
    assertEquals(typeof enhanceAdapterWithFS, "function");
  });

  it("should return original adapter for local type", async () => {
    const adapter = await enhanceAdapterWithFS(denoAdapter, { fs: { type: "local" } });
    assertEquals(adapter, denoAdapter);
  });

  it("should return original adapter when no fs config", async () => {
    const adapter = await enhanceAdapterWithFS(denoAdapter, {});
    assertEquals(adapter, denoAdapter);
  });

  it("should return original adapter when fs.type is not set", async () => {
    const adapter = await enhanceAdapterWithFS(denoAdapter, { fs: {} });
    assertEquals(adapter, denoAdapter);
  });

  it("snapshots the filesystem type once before selecting an adapter", async () => {
    const secret = "PRIVATE_FS_TYPE/project-357";
    let reads = 0;
    const fs = Object.create(null);
    Object.defineProperty(fs, "type", {
      get() {
        reads++;
        if (reads > 1) throw new Error(secret);
        return "local";
      },
    });

    const adapter = await enhanceAdapterWithFS(denoAdapter, { fs });
    assertEquals(adapter, denoAdapter);
    assertEquals(reads, 1);
  });

  it("rejects unreadable integration configuration without retaining trap data", async () => {
    const secret = "PRIVATE_FS_INTEGRATION/project-468";
    const config = Object.create(null);
    Object.defineProperty(config, "fs", {
      get() {
        throw new Error(secret);
      },
    });

    const error = await assertRejects(() => createFSAdapterFromConfig(config));
    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  it("should export createFSAdapterFromConfig function", () => {
    assertExists(createFSAdapterFromConfig);
    assertEquals(typeof createFSAdapterFromConfig, "function");
  });

  it("should return null for local type", async () => {
    const adapter = await createFSAdapterFromConfig({ fs: { type: "local" } });
    assertEquals(adapter, null);
  });

  it("should return null when no fs config", async () => {
    const adapter = await createFSAdapterFromConfig({});
    assertEquals(adapter, null);
  });

  it("should return null when fs.type is not set", async () => {
    const adapter = await createFSAdapterFromConfig({ fs: {} });
    assertEquals(adapter, null);
  });

  it("should export isFSAdapterConfigured function", () => {
    assertExists(isFSAdapterConfigured);
    assertEquals(typeof isFSAdapterConfigured, "function");
  });

  it("should return false for local type", () => {
    assertEquals(isFSAdapterConfigured({ fs: { type: "local" } }), false);
  });

  it("should return false when no fs config", () => {
    assertEquals(isFSAdapterConfigured({}), false);
  });

  it("should return false when fs.type is not set", () => {
    assertEquals(isFSAdapterConfigured({ fs: {} }), false);
  });

  it("should return true for veryfront-api type", () => {
    assertEquals(isFSAdapterConfigured({ fs: { type: "veryfront-api" } }), true);
  });

  it("should return true for github type", () => {
    assertEquals(isFSAdapterConfigured({ fs: { type: "github" } }), true);
  });

  it("should export getFSAdapterType function", () => {
    assertExists(getFSAdapterType);
    assertEquals(typeof getFSAdapterType, "function");
  });

  it("should return local as default", () => {
    assertEquals(getFSAdapterType({}), "local");
  });

  it("should return fs.type when set", () => {
    assertEquals(getFSAdapterType({ fs: { type: "veryfront-api" } }), "veryfront-api");
    assertEquals(getFSAdapterType({ fs: { type: "github" } }), "github");
  });

  it("should return local when fs.type is not set", () => {
    assertEquals(getFSAdapterType({ fs: {} }), "local");
  });

  it("fails safely when a synchronous type lookup is unreadable", () => {
    const secret = "PRIVATE_SYNC_FS_CONFIG/project-579";
    const config = Object.create(null);
    Object.defineProperty(config, "fs", {
      get() {
        throw new Error(secret);
      },
    });

    let error: unknown;
    try {
      getFSAdapterType(config);
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  describe("enhanceAdapterWithFS error propagation", () => {
    it("fails closed for an unsupported configured adapter", async () => {
      await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: { type: "unsupported-type" as any },
          }),
        Error,
        'FSAdapter type "unsupported-type" is not implemented',
      );
    });

    it("fails closed when a configured adapter is invalid", async () => {
      await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: { type: "github" },
          }),
        Error,
        "GitHub adapter requires github configuration",
      );
    });

    it("propagates adapter errors when projectDir is supplied", async () => {
      await assertRejects(
        () =>
          enhanceAdapterWithFS(
            denoAdapter,
            { fs: { type: "unknown-type" as any } },
            "/some/project/dir",
          ),
        Error,
        'FSAdapter type "unknown-type" is not implemented',
      );
    });
  });

  describe("createFSAdapterFromConfig error propagation", () => {
    it("should propagate error for unsupported type", async () => {
      await assertRejects(
        () => createFSAdapterFromConfig({ fs: { type: "unsupported" as any } }),
        Error,
        'FSAdapter type "unsupported" is not implemented',
      );
    });
  });
});
