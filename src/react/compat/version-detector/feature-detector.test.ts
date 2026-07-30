import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  detectFeatures,
  detectReactVersion,
  detectReactVersionFromProject,
} from "./feature-detector.ts";

const OVERSIZED_PACKAGE_JSON_BYTES = 1_048_577;

async function withProjectPackageJson(
  packageJson: string | undefined,
  run: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-react-version-" });
  try {
    if (packageJson !== undefined) {
      await Deno.writeTextFile(`${projectDir}/package.json`, packageJson);
    }
    await run(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("feature-detector", () => {
  describe("detectFeatures", () => {
    it("disables React 18+ features for React 17", () => {
      const features = detectFeatures(17, 0);

      assertEquals(features.suspense, false);
      assertEquals(features.streaming, false);
      assertEquals(features.automaticBatching, false);
      assertEquals(features.transitions, false);
      assertEquals(features.serverComponents, false);
      assertEquals(features.useFormStatus, false);
      assertEquals(features.useOptimistic, false);
      assertEquals(features.renderToPipeableStream, false);
      assertEquals(features.renderToReadableStream, false);

      // Basic SSR methods remain available.
      assertEquals(features.renderToString, true);
      assertEquals(features.renderToStaticMarkup, true);
      assertEquals(features.renderToNodeStream, true);
    });

    it("enables React 18 features for major=18", () => {
      const features = detectFeatures(18, 2);

      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.automaticBatching, true);
      assertEquals(features.transitions, true);
      assertEquals(features.renderToPipeableStream, true);
      assertEquals(features.renderToReadableStream, true);
      assertEquals(features.renderToNodeStream, true);

      // React 19 features still off
      assertEquals(features.useFormStatus, false);
      assertEquals(features.serverActions, false);
    });

    it("enables server components for React 18.3+", () => {
      assertEquals(detectFeatures(18, 3).serverComponents, true);
      assertEquals(detectFeatures(18, 2).serverComponents, false);
      assertEquals(detectFeatures(18, 0).serverComponents, false);
      assertEquals(detectFeatures(19, 0).serverComponents, true);
      assertEquals(detectFeatures(20, 0).serverComponents, true);
    });

    it("enables React 19 features when the version has React 19 capabilities", () => {
      const features = detectFeatures(19, 0);

      assertEquals(features.useFormStatus, true);
      assertEquals(features.useOptimistic, true);
      assertEquals(features.serverActions, true);
      assertEquals(features.improvedSuspense, true);
      assertEquals(features.enhancedStreaming, true);

      // Also has React 18+ features
      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.renderToNodeStream, false);
      assertEquals(detectFeatures(18, 3).renderToNodeStream, true);
    });

    it("treats major >= 18 as React 18+ for base features", () => {
      const features = detectFeatures(20, 0);

      assertEquals(features.suspense, true);
      assertEquals(features.streaming, true);
      assertEquals(features.serverComponents, true);
      assertEquals(features.useFormStatus, true);
      assertEquals(features.renderToNodeStream, false);
    });
  });

  describe("detectReactVersionFromProject", () => {
    it("uses the bundled version only when package.json is absent", async () => {
      await withProjectPackageJson(undefined, async (projectDir) => {
        assertEquals(
          (await detectReactVersionFromProject(projectDir)).version,
          detectReactVersion().version,
        );
      });
    });

    it("uses the bundled version when the manifest declares no React dependency", async () => {
      await withProjectPackageJson('{"name":"example"}', async (projectDir) => {
        assertEquals(
          (await detectReactVersionFromProject(projectDir)).version,
          detectReactVersion().version,
        );
      });
    });

    it("selects the declared dependency scope deterministically", async () => {
      await withProjectPackageJson(
        JSON.stringify({
          dependencies: { react: "^18.2.0" },
          devDependencies: { react: "19.1.0" },
          peerDependencies: { react: ">=17.0.2" },
        }),
        async (projectDir) => {
          const info = await detectReactVersionFromProject(projectDir);
          assertEquals(info.version, "18.2.0");
          assertEquals(info.isReact18, true);
        },
      );
    });

    it("does not enable React 19 features for a React 18 release candidate", async () => {
      await withProjectPackageJson(
        JSON.stringify({ dependencies: { react: "18.3.0-rc.1" } }),
        async (projectDir) => {
          const info = await detectReactVersionFromProject(projectDir);
          assertEquals(info.isReact18, true);
          assertEquals(info.isReact19, false);
          assertEquals(info.features.useFormStatus, false);
          assertEquals(info.features.useOptimistic, false);
        },
      );
    });

    it("rejects malformed package.json instead of silently using bundled React", async () => {
      await withProjectPackageJson("{", async (projectDir) => {
        await assertRejects(
          () => detectReactVersionFromProject(projectDir),
          Error,
          "Project package.json must contain valid JSON",
        );
      });
    });

    it("rejects package.json with invalid UTF-8", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-react-version-" });
      try {
        await Deno.writeFile(
          `${projectDir}/package.json`,
          new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]),
        );
        await assertRejects(
          () => detectReactVersionFromProject(projectDir),
          Error,
          "Project package.json must use valid UTF-8",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects invalid React dependency values and ambiguous ranges", async () => {
      for (const react of [19, "latest", "^18.2.0 || ^19.0.0"]) {
        await withProjectPackageJson(
          JSON.stringify({ dependencies: { react } }),
          async (projectDir) => {
            await assertRejects(
              () => detectReactVersionFromProject(projectDir),
              Error,
              "React dependency",
            );
          },
        );
      }
    });

    it("rejects oversized package.json before parsing it", async () => {
      const packageJson = `{"name":"example"}${" ".repeat(OVERSIZED_PACKAGE_JSON_BYTES)}`;
      await withProjectPackageJson(packageJson, async (projectDir) => {
        await assertRejects(
          () => detectReactVersionFromProject(projectDir),
          Error,
          "exceeds the 1 MiB limit",
        );
      });
    });
  });
});
