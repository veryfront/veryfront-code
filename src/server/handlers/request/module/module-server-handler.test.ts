import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import type { HandlerContext, HandlerResult } from "../../types.ts";
import { handleModuleServer } from "./module-server-handler.ts";
import { RSCHandler } from "../rsc/index.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe(
  "server/handlers/request/module/module-server-handler",
  () => {
    afterEach(async () => {
      clearReactVersionCache();
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    });

    it("resolves document snapshot A after B through branch-only module and RSC contexts", async () => {
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const projectDir = "/branch-only-project";
      const adapter = createMockAdapter();
      let revision = 1;
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => ({
        ...await stat(path),
        mtime: new Date(revision),
      });
      adapter.fs.files.set(
        `${projectDir}/app/page.ts`,
        [
          '"use client";',
          'import React from "react";',
          'import value from "snapshot-package";',
          "export default [React, value];",
        ].join("\n"),
      );
      const ctx = {
        projectDir,
        projectId: "project-a",
        adapter,
        isLocalProject: false,
        requestContext: {
          token: "",
          slug: "project-a",
          branch: "feature-a",
          mode: "preview",
        },
        securityConfig: null,
        config: {},
      } satisfies HandlerContext;

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        adapter.fs.files.set(
          `${projectDir}/package.json`,
          JSON.stringify({
            dependencies: {
              react: "18.3.1",
              "snapshot-package": "1.0.0",
            },
          }),
        );
        const snapshotA = await getDependencyPinningSnapshot(
          createHandlerDependencyPinningSource(ctx),
        );

        revision++;
        adapter.fs.files.set(
          `${projectDir}/package.json`,
          JSON.stringify({
            dependencies: {
              react: "19.2.4",
              "snapshot-package": "2.0.0",
            },
          }),
        );
        const snapshotB = await getDependencyPinningSnapshot(
          createHandlerDependencyPinningSource(ctx),
        );
        assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);

        const result = await handleModuleServer(
          new Request(
            `http://localhost/_vf_modules/app/page.js?pins=${
              encodeURIComponent(snapshotA.cacheKey)
            }`,
          ),
          ctx,
          () => new ResponseBuilder(),
          (response): HandlerResult => ({ response, continue: false }),
          () => {},
          (error) => error instanceof Error ? error.message : String(error),
        );

        assertEquals(result.response?.status, 200);
        const source = await result.response!.text();
        assertStringIncludes(source, "snapshot-package@1.0.0");
        assertStringIncludes(source, "react@18.3.1");

        const rscResult = await new RSCHandler().handle(
          new Request(
            `http://localhost/_veryfront/rsc/module?rel=app%2Fpage.ts&pins=${
              encodeURIComponent(snapshotA.cacheKey)
            }`,
          ),
          ctx,
        );
        const rscSource = await rscResult.response!.text();
        assertEquals(rscResult.response?.status, 200, rscSource);
        assertStringIncludes(rscSource, "snapshot-package@1.0.0");
        assertEquals(rscSource.includes("snapshot-package@2.0.0"), false);
      } finally {
        restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      }
    });
  },
);
