import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractFrameworkBundlePaths,
  findMissingFrameworkBundlePaths,
} from "./framework-bundle-paths.ts";

describe("transforms/shared/framework-bundle-paths", () => {
  describe("extractFrameworkBundlePaths", () => {
    it("extracts a single framework bundle path", () => {
      const code = `import "file:///cache/framework/vfmod-abc123.mjs";`;
      assertEquals(extractFrameworkBundlePaths(code), ["/cache/framework/vfmod-abc123.mjs"]);
    });

    it("extracts multiple framework bundle paths", () => {
      const code = `
        import "file:///cache/framework/vfmod-abc.mjs";
        import "file:///cache/framework/vfmod-def.mjs";
      `;
      const result = extractFrameworkBundlePaths(code);
      assertEquals(result.length, 2);
      assertEquals(result.includes("/cache/framework/vfmod-abc.mjs"), true);
      assertEquals(result.includes("/cache/framework/vfmod-def.mjs"), true);
    });

    it("deduplicates identical paths", () => {
      const code = `
        import "file:///cache/framework/vfmod-abc.mjs";
        import "file:///cache/framework/vfmod-abc.mjs";
      `;
      assertEquals(extractFrameworkBundlePaths(code), ["/cache/framework/vfmod-abc.mjs"]);
    });

    it("returns empty array for code with no framework bundles", () => {
      const code = `import "react";`;
      assertEquals(extractFrameworkBundlePaths(code), []);
    });

    it("returns empty array for empty string", () => {
      assertEquals(extractFrameworkBundlePaths(""), []);
    });

    it("ignores non-framework file:// paths", () => {
      const code = `import "file:///cache/other/module.mjs";`;
      assertEquals(extractFrameworkBundlePaths(code), []);
    });

    it("strips the file:// prefix", () => {
      const code = `import "file:///home/user/.cache/framework/vfmod-test.mjs";`;
      const result = extractFrameworkBundlePaths(code);
      assertEquals(result[0]!.startsWith("file://"), false);
      assertEquals(result[0], "/home/user/.cache/framework/vfmod-test.mjs");
    });
  });

  describe("findMissingFrameworkBundlePaths", () => {
    it("returns only referenced framework bundle paths that do not exist", async () => {
      const existingPath = "/cache/framework/vfmod-existing.mjs";
      const missingPath = "/cache/framework/vfmod-missing.mjs";
      const code = `
        import "file://${existingPath}";
        import "file://${missingPath}";
        import "file://${missingPath}";
      `;

      const result = await findMissingFrameworkBundlePaths(
        code,
        (path) => Promise.resolve(path === existingPath),
      );

      assertEquals(result, [missingPath]);
    });

    it("treats canonical not-found failures as missing framework bundles", async () => {
      const path = "/cache/framework/vfmod-missing-after-probe.mjs";
      const missingError = Object.assign(new Error("bundle disappeared"), {
        code: "ENOENT",
      });
      let observedPath: string | undefined;
      let observedError: unknown;

      const result = await findMissingFrameworkBundlePaths(
        `import "file://${path}";`,
        () => Promise.reject(missingError),
        {
          onError: (errorPath, error) => {
            observedPath = errorPath;
            observedError = error;
          },
        },
      );

      assertEquals(result, [path]);
      assertEquals(observedPath, path);
      assertStrictEquals(observedError, missingError);
    });

    for (
      const [label, failure] of [
        ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
        [
          "a native Error with a plain ENOENT-shaped cause",
          new Error("wrapped bundle lookup failure", {
            cause: Object.freeze({ code: "ENOENT" }),
          }),
        ],
      ] as const
    ) {
      it(`propagates ${label} instead of reporting a missing framework bundle`, async () => {
        const path = "/cache/framework/vfmod-untrusted-missing-shape.mjs";
        let probeCalls = 0;
        let observedPath: string | undefined;
        let observedError: unknown;

        const error = await assertRejects(() =>
          findMissingFrameworkBundlePaths(
            `import "file://${path}";`,
            () => {
              probeCalls++;
              return Promise.reject(failure);
            },
            {
              onError: (errorPath, caughtError) => {
                observedPath = errorPath;
                observedError = caughtError;
              },
            },
          )
        );

        assertStrictEquals(error, failure);
        assertEquals(probeCalls, 1);
        assertEquals(observedPath, path);
        assertStrictEquals(observedError, failure);
      });
    }

    it("propagates operational existence check failures with exact identity", async () => {
      const path = "/cache/framework/vfmod-unreadable.mjs";
      const permissionError = Object.assign(new Error("framework bundle lookup denied"), {
        code: "EACCES",
      });
      let observedPath: string | undefined;
      let observedError: unknown;

      const error = await assertRejects(
        () =>
          findMissingFrameworkBundlePaths(
            `import "file://${path}";`,
            () => Promise.reject(permissionError),
            {
              onError: (errorPath, caughtError) => {
                observedPath = errorPath;
                observedError = caughtError;
              },
            },
          ),
        Error,
        "framework bundle lookup denied",
      );

      assertStrictEquals(error, permissionError);
      assertEquals(observedPath, path);
      assertStrictEquals(observedError, permissionError);
    });

    it("checks independent framework bundle paths concurrently", async () => {
      const firstPath = "/cache/framework/vfmod-first.mjs";
      const secondPath = "/cache/framework/vfmod-second.mjs";
      const started: string[] = [];
      let resolveFirst!: (exists: boolean) => void;

      const resultPromise = findMissingFrameworkBundlePaths(
        `
          import "file://${firstPath}";
          import "file://${secondPath}";
        `,
        (path) => {
          started.push(path);
          if (path === firstPath) {
            return new Promise<boolean>((resolve) => {
              resolveFirst = resolve;
            });
          }
          return Promise.resolve(false);
        },
      );

      await Promise.resolve();
      try {
        assertEquals(started, [firstPath, secondPath]);
      } finally {
        resolveFirst(true);
      }

      assertEquals(await resultPromise, [secondPath]);
    });

    it("does not call the existence check when code has no framework bundles", async () => {
      let calls = 0;

      const result = await findMissingFrameworkBundlePaths(
        `import "file:///cache/other/module.mjs";`,
        () => {
          calls++;
          return Promise.resolve(false);
        },
      );

      assertEquals(result, []);
      assertEquals(calls, 0);
    });
  });
});
