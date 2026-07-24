import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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

  describe("enhanceAdapterWithFS error propagation", () => {
    it("should reject rather than use local files for an unsupported remote type", async () => {
      await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: { type: "unsupported-type" as any },
          }),
        Error,
        'FSAdapter type "unsupported-type" is not implemented',
      );
    });

    it("should reject rather than use local files when remote configuration is invalid", async () => {
      await assertRejects(
        () =>
          enhanceAdapterWithFS(denoAdapter, {
            fs: { type: "github" },
          }),
        Error,
        "GitHub adapter requires github configuration",
      );
    });

    it("should preserve initialization failures when projectDir is provided", async () => {
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
