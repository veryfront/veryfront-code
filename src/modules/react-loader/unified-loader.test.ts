import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import {
  _resolveUnifiedTransformOptionsForTest,
  _transformAllComponentsForTest,
} from "./unified-loader.ts";

describe("loadComponentsUnified dependency snapshots", () => {
  it("passes one immutable caller snapshot to every parallel transform", async () => {
    const callerDependencies = { lodash: "1.0.0" };
    const dependencyPinningCacheKey = `on:${hashString(JSON.stringify([["lodash", "1.0.0"]]))}`;
    const transformOptions = await _resolveUnifiedTransformOptionsForTest(
      "/project",
      {
        projectId: "project-id",
        dev: false,
        moduleServerOrigin: "https://preview.example",
        dependencyPinningCacheKey,
        dependencyPinningDependencies: callerDependencies,
      },
    );
    callerDependencies.lodash = "2.0.0";

    const observedOptions: TransformOptions[] = [];
    const components = Array.from({ length: 8 }, (_, index) => ({
      name: `Component${index}`,
      source: `export default function Component${index}() { return null; }`,
      filePath: `/project/components/Component${index}.tsx`,
    }));
    const transformed = await _transformAllComponentsForTest(
      components,
      "/project",
      createMockAdapter(),
      transformOptions,
      ((_source, filePath, _projectDir, _adapter, options) => {
        observedOptions.push(options ?? {});
        return Promise.resolve(`export const filePath = ${JSON.stringify(filePath)};`);
      }) as Parameters<typeof _transformAllComponentsForTest>[4],
    );

    assertEquals(transformed.length, components.length);
    assertEquals(observedOptions.length, components.length);
    assertEquals(observedOptions.every((options) => options === transformOptions), true);
    assertEquals(
      observedOptions.every(
        (options) =>
          options.dependencyPinningCacheKey === dependencyPinningCacheKey &&
          options.dependencyPinningDependencies?.lodash === "1.0.0",
      ),
      true,
    );
    assertEquals(Object.isFrozen(transformOptions.dependencyPinningDependencies), true);
    assertEquals(transformOptions.moduleServerOrigin, "https://preview.example");
  });

  it("does not vary flag-off transform options by request origin", async () => {
    const options = await _resolveUnifiedTransformOptionsForTest("/project", {
      dev: false,
      moduleServerOrigin: "https://preview.example",
      dependencyPinningCacheKey: "off",
    });

    assertEquals(options.moduleServerOrigin, undefined);
  });

  it("threads the caller's render mode into the transform options", async () => {
    for (const dev of [true, false]) {
      const options = await _resolveUnifiedTransformOptionsForTest("/project", {
        dev,
        dependencyPinningCacheKey: "off",
      });

      assertEquals(options.dev, dev);
    }
  });
});
