/**
 * The reserved error component is compiled through the real bundler over a real
 * project directory, so these render-mode threading cases cannot stay beside the
 * hermetic rendering units. The hermetic links live in
 * src/rendering/render-mode-threading.test.ts.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { validateVeryfrontConfig } from "#veryfront/config";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import { HTMLGenerator } from "#veryfront/rendering/orchestrator/html.ts";
import type { HTMLGenerationContext } from "#veryfront/rendering/orchestrator/html-types.ts";
import { globalModuleCache } from "#veryfront/modules/react-loader/ssr-module-loader/cache/memory.ts";

describe("rendering/orchestrator/html.ts render mode threading", () => {
  async function errorProject(): Promise<{ projectDir: string; errorFile: string }> {
    const projectDir = await makeTempDir({ prefix: "vf-render-mode-error-" });
    await mkdir(join(projectDir, "app"), { recursive: true });
    const errorFile = join(projectDir, "app", "error.tsx");
    await writeTextFile(
      errorFile,
      "export default function ErrorView() { return null; }\n",
    );
    return { projectDir, errorFile };
  }

  function errorContext(
    projectDir: string,
    environment?: "preview" | "production",
  ): HTMLGenerationContext {
    return {
      pageInfo: { entity: { path: join(projectDir, "app", "page.tsx"), slug: "" } },
      options: environment ? { environment } : {},
    } as HTMLGenerationContext;
  }

  /**
   * The SSR module cache stamps ":preview" onto the config identity that
   * immediately precedes the file path, so the keys written for error.tsx are
   * a faithful readout of the environment the reserved loader was handed.
   * The content-source identity of a release-less hosted render carries its
   * own "preview" token, hence the path-anchored marker.
   */
  function previewCompileMarker(errorFile: string): string {
    return `:preview:${errorFile}`;
  }

  function errorCompileKeys(errorFile: string): string[] {
    return [...globalModuleCache.keys()].filter((key) => key.includes(errorFile));
  }

  async function stopBundler(): Promise<void> {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  }

  it("compiles the reserved error component under the configured environment", async () => {
    const { projectDir, errorFile } = await errorProject();

    try {
      const generator = new HTMLGenerator({
        projectDir,
        adapter: denoAdapter,
        config: validateVeryfrontConfig({}),
        mode: "production",
        environment: "preview",
        isLocalProject: false,
      });

      const loaded = await generator.resolveErrorComponentPath(errorContext(projectDir));

      assertExists(loaded, "expected the app directory's error.tsx to resolve");
      assertEquals(loaded.path, errorFile, "the resolved path must be the project's error.tsx");
      const keys = errorCompileKeys(errorFile);
      assertEquals(keys.length > 0, true, "expected error.tsx to be compiled and cached");
      assertEquals(
        keys.every((key) => key.includes(previewCompileMarker(errorFile))),
        true,
        "a preview-configured generator must compile error.tsx with preview instrumentation",
      );
    } finally {
      await stopBundler();
      await remove(projectDir, { recursive: true });
    }
  });

  it("lets a request environment override the configured one for error.tsx", async () => {
    const { projectDir, errorFile } = await errorProject();

    try {
      const generator = new HTMLGenerator({
        projectDir,
        adapter: denoAdapter,
        config: validateVeryfrontConfig({}),
        mode: "production",
        environment: "preview",
        isLocalProject: false,
      });

      const loaded = await generator.resolveErrorComponentPath(
        errorContext(projectDir, "production"),
      );

      assertExists(loaded, "expected the app directory's error.tsx to resolve");
      const keys = errorCompileKeys(errorFile);
      assertEquals(keys.length > 0, true, "expected error.tsx to be compiled and cached");
      assertEquals(
        keys.some((key) => key.includes(previewCompileMarker(errorFile))),
        false,
        "a production request must not compile error.tsx with preview instrumentation",
      );
    } finally {
      await stopBundler();
      await remove(projectDir, { recursive: true });
    }
  });
});
