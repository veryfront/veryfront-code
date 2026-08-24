/**
 * The ComponentRegistry error fallback reads NODE_ENV at render time, so this
 * case mutates the process environment and lives here rather than beside the
 * unit tests, which have to stay hermetic.
 */

import "../../_helpers/contract-init.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { renderToString } from "react-dom/server";
import { ComponentRegistry } from "#veryfront/rendering/ssr/component-registry.ts";
import type { VirtualModuleSystem } from "#veryfront/rendering/virtual-module-system.ts";
import * as React from "react";

/** Registry whose single component always fails to load, so it falls back. */
async function createRegistryWithFailingComponent(
  errorMessage: string,
): Promise<{ registry: ComponentRegistry; snapshotKey: string }> {
  const adapter = createMockAdapter();
  adapter.fs.files.set(
    "/project/components/Button.tsx",
    "export default function Button() { return null; }",
  );
  const registry = new ComponentRegistry(
    { registerModule: () => Promise.resolve() } as unknown as VirtualModuleSystem,
    3001,
    adapter,
    undefined,
    undefined,
    "project-id",
    "branch:main",
    () => Promise.reject(new Error(errorMessage)),
  );

  await registry.loadFromDirectory("/project/components", true);
  const snapshotKey = await registry.prepareDependencySnapshot("off");
  return { registry, snapshotKey };
}

describe("ComponentRegistry error fallback", () => {
  it("reveals the loader error in the fallback only in development", async () => {
    const { registry, snapshotKey } = await createRegistryWithFailingComponent(
      "Module not found",
    );
    const Fallback = registry.getAllAsComponents(snapshotKey).Button;
    assertEquals(typeof Fallback, "function", "the fallback must be a renderable component");

    await withEnv({ NODE_ENV: "production" }, () => {
      assertEquals(
        renderToString(React.createElement(Fallback!)),
        "",
        "the fallback must render nothing outside development so loader errors never reach end users",
      );
      return Promise.resolve();
    });

    await withEnv({ NODE_ENV: "development" }, () => {
      const html = renderToString(React.createElement(Fallback!));
      assertStringIncludes(
        html,
        "Button",
        "the development fallback must name the failing component",
      );
      assertStringIncludes(
        html,
        "Module not found",
        "the development fallback must surface the loader error",
      );
      return Promise.resolve();
    });
  });
});
