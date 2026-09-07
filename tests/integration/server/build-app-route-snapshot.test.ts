import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import {
  createDependencySnapshotStoreHandle,
  type DependencySnapshotRecord,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { getProjectReact } from "#veryfront/react";
import { getReactDOMServer } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import { renderAppRouteToHTML } from "#veryfront/server/build-app-route-renderer.ts";
import { clearReactVersionCache } from "#veryfront/transforms/esm/package-registry.ts";

// Initialize React's process-lifetime scheduler before per-test resource checks.
await Promise.all([getProjectReact("19.2.4"), getReactDOMServer("19.2.4")]);

it("static App Router rendering preserves shared snapshots with configured React versions", async () => {
  const flags = ["VERYFRONT_DEPENDENCY_PINNING", "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT"];
  const previous = flags.map(getHostEnv);
  const projectDir = await makeTempDir({ prefix: "vf-static-snapshot-" });
  const records = new Map<string, DependencySnapshotRecord>();
  const adapter = {
    ...denoAdapter,
    dependencySnapshotStore: createDependencySnapshotStoreHandle({
      publish: (namespace, key, value, expiresAt) => {
        records.set(`${namespace}:${key}`, { value, expiresAt });
        return Promise.resolve();
      },
      read: (namespace, key) => Promise.resolve(records.get(`${namespace}:${key}`) ?? null),
    }),
  };
  try {
    setEnv(flags[0]!, "1");
    setEnv(flags[1]!, "100");
    clearReactVersionCache();
    await Deno.mkdir(join(projectDir, "app"));
    await Deno.writeTextFile(join(projectDir, "package.json"), '{"dependencies":{}}');
    await Deno.writeTextFile(
      join(projectDir, "app/layout.tsx"),
      `export default function Layout({ children }) {
        return <main id="shared-snapshot-layout">{children}</main>;
      }`,
    );
    const pageFile = join(projectDir, "app/page.tsx");
    await Deno.writeTextFile(
      pageFile,
      `"use client";
      export default function Page() {
        return <button id="shared-snapshot-page">Open</button>;
      }`,
    );

    const html = await renderAppRouteToHTML({
      adapter,
      projectDir,
      routePath: "/",
      pageFile,
      contentSourceId: "static-snapshot-test",
      config: { react: { version: "19.2.4" } },
    });

    assertEquals(records.size, 1, "the render must publish one shared snapshot");
    assertStringIncludes(html, 'id="shared-snapshot-page"', "the page must render");
    assertStringIncludes(html, 'id="shared-snapshot-layout"', "the layout must render");
    assertStringIncludes(html, 'id="veryfront-hydration-data"', "the page must remain hydratable");
  } finally {
    for (const [index, name] of flags.entries()) {
      const value = previous[index];
      if (value === undefined) deleteEnv(name);
      else setEnv(name, value);
    }
    clearReactVersionCache();
    try {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  }
});
