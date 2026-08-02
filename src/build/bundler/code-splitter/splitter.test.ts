import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  makeTempDir,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { type BuildContext, stop } from "veryfront/extensions/bundler";
import { CodeSplitter, rebuildAndDispose } from "./splitter.ts";

async function readJsOutputs(dir: string): Promise<string> {
  let contents = "";

  for await (const entry of readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      contents += await readJsOutputs(path);
      continue;
    }

    if (entry.isFile && entry.name.endsWith(".js")) {
      contents += await readTextFile(path);
      contents += "\n";
    }
  }

  return contents;
}

describe("build/bundler/code-splitter/splitter", () => {
  describe("CodeSplitter constructor", () => {
    it("should create an instance with options", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept development mode", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "development",
        routes: [{ path: "/", file: "/project/src/index.tsx" }],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept routes with names", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [
          { path: "/", file: "/project/src/index.tsx", name: "index" },
          { path: "/about", file: "/project/src/about.tsx", name: "about" },
        ],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept optional external and shared config", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
        shared: ["react", "react-dom"],
        external: ["lodash"],
        moduleResolution: "bundled",
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });
  });

  describe("split method", () => {
    it("should have a split method", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
      });
      assertEquals(typeof splitter.split, "function");
    });

    it("disposes the build context when rebuild fails", async () => {
      const rebuildError = new Error("intentional rebuild failure");
      let disposed = false;
      const buildContext: BuildContext = {
        rebuild() {
          return Promise.reject(rebuildError);
        },
        dispose() {
          disposed = true;
          return Promise.resolve();
        },
      };

      const error = await assertRejects(
        () => rebuildAndDispose(buildContext),
        Error,
        "intentional rebuild failure",
      );

      assertEquals(error, rebuildError);
      assertEquals(disposed, true);
    });

    it("preserves both rebuild and disposal failures", async () => {
      const rebuildError = new Error("primary rebuild failure");
      const disposeError = new Error("secondary disposal failure");
      const buildContext: BuildContext = {
        rebuild() {
          return Promise.reject(rebuildError);
        },
        dispose() {
          return Promise.reject(disposeError);
        },
      };

      const error = await assertRejects(
        () => rebuildAndDispose(buildContext),
        AggregateError,
        "rebuild failed and context disposal also failed",
      );

      assertInstanceOf(error, AggregateError);
      assertEquals(error.errors, [rebuildError, disposeError]);
    });

    it("strips server-only page dependencies before building production browser chunks", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-splitter-project-" });
      const outDir = await makeTempDir({ prefix: "vf-splitter-out-" });
      const previousCodeParser = tryResolve<unknown>("CodeParser");
      unregister("CodeParser");

      try {
        await mkdir(join(projectDir, "app"), { recursive: true });
        const pagePath = join(projectDir, "app/page.tsx");
        await writeTextFile(
          pagePath,
          [
            `import { notFound } from "veryfront";`,
            `import { hashSecret } from "./server-helper.ts";`,
            `export async function getServerData() {`,
            `  if (!hashSecret("candidate")) notFound();`,
            `  return { props: { ok: true } };`,
            `}`,
            `export default function Page() { return "browser page"; }`,
          ].join("\n"),
        );
        await writeTextFile(
          join(projectDir, "app/server-helper.ts"),
          [
            `import { createHash } from "node:crypto";`,
            `export function hashSecret(value: string): string {`,
            `  return createHash("sha256").update(value).digest("hex");`,
            `}`,
          ].join("\n"),
        );

        const splitter = new CodeSplitter({
          projectDir,
          outDir,
          mode: "production",
          routes: [{ path: "/", file: pagePath, name: "index" }],
          moduleResolution: "bundled",
        });

        const splitResult = await splitter.split();
        assertEquals(tryResolve("CodeParser") !== undefined, true);
        assertEquals(splitResult.manifest.routes["/"]?.entry, "index.js");
        assertEquals(
          splitResult.entries.get("index.js") === splitResult.manifest.chunks["index.js"],
          true,
        );
        const browserOutputs = await readJsOutputs(outDir);

        assertEquals(browserOutputs.includes("browser page"), true);
        assertEquals(browserOutputs.includes("node:crypto"), false);
        assertEquals(browserOutputs.includes("createHash"), false);
        assertEquals(browserOutputs.includes("hashSecret"), false);
        assertEquals(browserOutputs.includes("notFound"), false);
        const outputNames = [];
        for await (const entry of readDir(outDir)) outputNames.push(entry.name);
        assertEquals(
          outputNames.some((name) => name.startsWith(".veryfront-shim-")),
          false,
        );
      } finally {
        await stop();
        if (previousCodeParser) register("CodeParser", previousCodeParser);
        else unregister("CodeParser");
        await remove(projectDir, { recursive: true });
        await remove(outDir, { recursive: true });
      }
    });

    it("builds shared chunks with external imports excluded from manifest assets", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-splitter-project-" });
      const outDir = await makeTempDir({ prefix: "vf-splitter-out-" });

      try {
        const sharedPath = join(projectDir, "shared.ts");
        const firstPath = join(projectDir, "first.ts");
        const secondPath = join(projectDir, "second.ts");
        await writeTextFile(sharedPath, `export const shared = "shared";`);
        await writeTextFile(
          firstPath,
          [
            `import React from "react";`,
            `import { shared } from "./shared.ts";`,
            `console.log(React, shared);`,
          ].join("\n"),
        );
        await writeTextFile(
          secondPath,
          [
            `import React from "react";`,
            `import { shared } from "./shared.ts";`,
            `console.log(React, shared);`,
          ].join("\n"),
        );

        const result = await new CodeSplitter({
          projectDir,
          outDir,
          mode: "production",
          routes: [
            { path: "/first", file: firstPath, name: "first" },
            { path: "/second", file: secondPath, name: "second" },
          ],
          moduleResolution: "bundled",
        }).split();

        assertEquals(result.entries.size, 2);
        assertEquals(result.shared.size, 1);
        const sharedChunk = result.manifest.shared[0];
        assertEquals(typeof sharedChunk, "string");
        assertEquals(result.manifest.routes["/first"]?.chunks, [sharedChunk]);
        assertEquals(result.manifest.routes["/second"]?.chunks, [sharedChunk]);
        assertEquals(
          result.shared.get(sharedChunk!) === result.manifest.chunks[sharedChunk!],
          true,
        );
        assertEquals(Object.hasOwn(result.manifest.chunks, "react"), false);
      } finally {
        await stop();
        await remove(projectDir, { recursive: true });
        await remove(outDir, { recursive: true });
      }
    });
  });
});
