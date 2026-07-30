import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  type ServerStyleCallbackDependencies,
  serverStyleCallbackInternals,
} from "./style-callbacks.ts";

type BuildOptions = Parameters<
  ServerStyleCallbackDependencies["buildPreparedCSSArtifactFromFiles"]
>[0];

function createDependencies(input: {
  loadConfig: ServerStyleCallbackDependencies["loadConfig"];
  onBuild?: (options: BuildOptions) => void;
}): ServerStyleCallbackDependencies {
  return {
    loadConfig: input.loadConfig,
    buildPreparedCSSArtifactFromFiles: async (options) => {
      input.onBuild?.(options);
      return {
        css: ".generated{}",
        hash: "tenant-style-hash",
        candidateCount: 1,
        fromCache: false,
        context: {} as never,
      };
    },
  };
}

describe("server style callbacks", () => {
  it("uses source-bound hosted config without re-entering the multi-project loader", async () => {
    const hostedConfig: VeryfrontConfig = {
      directories: { components: ["tenant-ui"] },
      styles: { stylesheet: "styles/tenant.css" },
    };
    let loaderCalls = 0;
    let buildOptions: BuildOptions | undefined;
    const callbacks = serverStyleCallbackInternals.createStyleCallbacks(
      createDependencies({
        loadConfig: () => {
          loaderCalls += 1;
          throw new Error("hosted config must not be loaded twice");
        },
        onBuild: (options) => {
          buildOptions = options;
        },
      }),
    );

    const result = await callbacks.pregenerateStyles?.(
      [
        {
          path: "styles/tenant.css",
          content: '@import "tailwindcss"; .tenant { color: red; }',
        },
        {
          path: "tenant-ui/card.tsx",
          content: 'export const Card = () => <div className="tenant" />;',
        },
      ],
      {
        projectSlug: "tenant-project",
        projectDir: "/projects/tenant-project",
        contentContext: {
          sourceType: "release",
          projectSlug: "tenant-project",
          releaseId: "release-123",
        },
        config: hostedConfig,
      },
    );

    assertEquals(loaderCalls, 0);
    assertEquals(buildOptions?.stylesheetPath, "styles/tenant.css");
    assertEquals(
      buildOptions?.stylesheet,
      '@import "tailwindcss"; .tenant { color: red; }',
    );
    assertEquals(
      buildOptions?.styleProfile.protectedRoots.includes("tenant-ui"),
      true,
    );
    assertEquals(result, {
      hash: "tenant-style-hash",
      assetPath: "/_vf/css/tenant-style-hash.css",
    });
  });

  it("propagates non-hosted config load failures instead of generating default styles", async () => {
    const loadFailure = new Error("config backend unavailable");
    let buildCalls = 0;
    const callbacks = serverStyleCallbackInternals.createStyleCallbacks(
      createDependencies({
        loadConfig: () => Promise.reject(loadFailure),
        onBuild: () => {
          buildCalls += 1;
        },
      }),
    );

    const error = await assertRejects(() =>
      callbacks.pregenerateStyles!(
        [{ path: "globals.css", content: '@import "tailwindcss";' }],
        {
          projectSlug: "local-project",
          projectDir: "/projects/local-project",
          contentContext: {
            sourceType: "branch",
            projectSlug: "local-project",
            branch: "main",
          },
        },
      )
    );

    assertEquals(error, loadFailure);
    assertEquals(buildCalls, 0);
  });
});
