import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/plugins/__tests__/code-parser-setup.ts";
import { assert, assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { clearSSRModuleCache, SSRModuleLoader } from "./index.ts";
import { acquireTransformSlot, globalModuleCache, releaseTransformSlot } from "./cache/memory.ts";
import {
  getTransformAcquireTimeoutMs,
  TRANSFORM_ACQUIRE_TIMEOUT_DEV_MS,
  TRANSFORM_ACQUIRE_TIMEOUT_MS,
} from "./constants.ts";
import { buildSSRModuleCacheKey } from "../../../cache/keys.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { computeConfigHashSync } from "../../../cache/config-hash.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { injectNodePositions } from "#veryfront/transforms/plugins/babel-node-positions.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";

/**
 * Downstream proof for the SSR dev-mode gate. Every branch below used to take
 * the dev path on the hosted runtime because the render mode was discarded
 * before it reached SSRModuleLoader.
 */

const CONTENT_SOURCE_ID = "local-main";
const JSX_SOURCE = 'export default function Widget() { return <div id="w">hi</div>; }';

function moduleCacheKey(
  projectId: string,
  filePath: string,
  contentHash: string,
  dev: boolean,
): string {
  const configHash = computeConfigHashSync({ dev });
  return buildSSRModuleCacheKey(
    RUNTIME_VERSION,
    projectId,
    `${CONTENT_SOURCE_ID}:default:${configHash}:${filePath}:${contentHash}`,
  );
}

function relativePath(filePath: string, projectDir: string): string {
  return filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length).replace(/^\/+/, "")
    : filePath;
}

describe("SSRModuleLoader production gate", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  it("uses the 5s acquire deadline in production and the 30s deadline in dev", () => {
    assertEquals(getTransformAcquireTimeoutMs(false), TRANSFORM_ACQUIRE_TIMEOUT_MS);
    assertEquals(getTransformAcquireTimeoutMs(false), 5_000);
    assertEquals(getTransformAcquireTimeoutMs(true), TRANSFORM_ACQUIRE_TIMEOUT_DEV_MS);
    assertEquals(getTransformAcquireTimeoutMs(true), 30_000);
  });

  it("skips node position injection for production tsx transforms", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-prod-gate-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "Widget.tsx");
    const projectId = "prod-gate-positions";

    try {
      await mkdir(componentsDir, { recursive: true });
      await writeTextFile(filePath, JSX_SOURCE);

      const rel = relativePath(filePath, projectDir);
      const injected = injectNodePositions(JSX_SOURCE, { filePath: rel });
      assertNotEquals(
        injected,
        JSX_SOURCE,
        "the parser extension must be active for this assertion to mean anything",
      );

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId: CONTENT_SOURCE_ID,
        adapter: denoAdapter,
        dev: false,
      });
      await loader.loadRawModule(filePath, JSX_SOURCE);

      const rawKey = moduleCacheKey(projectId, filePath, hashCodeHex(JSX_SOURCE), false);
      const injectedKey = moduleCacheKey(projectId, filePath, hashCodeHex(injected), false);

      assertEquals(
        globalModuleCache.has(rawKey),
        true,
        "production must transform the untouched source",
      );
      assertEquals(
        globalModuleCache.has(injectedKey),
        false,
        "production must not run injectNodePositions on tsx",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("injects node positions for dev tsx transforms", async () => {
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-dev-gate-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "Widget.tsx");
    const projectId = "dev-gate-positions";

    try {
      await mkdir(componentsDir, { recursive: true });
      await writeTextFile(filePath, JSX_SOURCE);

      const rel = relativePath(filePath, projectDir);
      const injected = injectNodePositions(JSX_SOURCE, { filePath: rel });

      const loader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId: CONTENT_SOURCE_ID,
        adapter: denoAdapter,
        dev: true,
      });
      await loader.loadRawModule(filePath, JSX_SOURCE);

      const injectedKey = moduleCacheKey(projectId, filePath, hashCodeHex(injected), true);
      assertEquals(
        globalModuleCache.has(injectedKey),
        true,
        "dev must keep injecting node positions for Studio Navigator",
      );
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });

  it("applies the per-project transform cap in production and bypasses it in dev", async () => {
    const previousLimit = Deno.env.get("SSR_TRANSFORM_PER_PROJECT_LIMIT");
    Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", "1");
    clearSSRModuleCache();

    const projectDir = await makeTempDir({ prefix: "vf-ssr-cap-gate-" });
    const componentsDir = join(projectDir, "components");
    const filePath = join(componentsDir, "Capped.tsx");
    const source = "export default function Capped() { return null; }";
    const projectId = "prod-gate-capacity";
    let held = false;

    try {
      await mkdir(componentsDir, { recursive: true });
      await writeTextFile(filePath, source);

      // Occupy the only per-project slot for this project.
      held = acquireTransformSlot(projectId);
      assertEquals(held, true);

      const devLoader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId: CONTENT_SOURCE_ID,
        adapter: denoAdapter,
        dev: true,
      });
      // Dev bypasses the per-project cap, so this completes while the slot is held.
      const devModule = await devLoader.loadRawModule(filePath, source);
      assert(typeof devModule.default === "function");

      const prodLoader = new SSRModuleLoader({
        projectDir,
        projectId,
        contentSourceId: CONTENT_SOURCE_ID,
        adapter: denoAdapter,
        dev: false,
      });

      const startedAt = Date.now();
      await assertRejects(
        () => prodLoader.loadRawModule(filePath, source),
        Error,
        "at transform capacity",
      );
      const elapsed = Date.now() - startedAt;

      assert(
        elapsed >= TRANSFORM_ACQUIRE_TIMEOUT_MS - 500,
        `production should wait for the 5s deadline, waited ${elapsed}ms`,
      );
      assert(
        elapsed < TRANSFORM_ACQUIRE_TIMEOUT_DEV_MS / 2,
        `production must not use the 30s dev deadline, waited ${elapsed}ms`,
      );
    } finally {
      if (held) releaseTransformSlot(projectId);
      if (previousLimit === undefined) {
        Deno.env.delete("SSR_TRANSFORM_PER_PROJECT_LIMIT");
      } else {
        Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", previousLimit);
      }
      clearSSRModuleCache();
      await remove(projectDir, { recursive: true });
    }
  });
});
