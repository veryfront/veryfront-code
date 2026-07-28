import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { collectTailwindSourceFiles } from "./source-collector.ts";

describe("build/asset-pipeline/tailwind-processor/source-collector", () => {
  it("returns matching project sources in deterministic path order", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/z.tsx", '<div className="z-10" />');
    adapter.fs.files.set("/project/app/b.ts", 'const value = "b";');
    adapter.fs.files.set("/project/app/a.tsx", '<div className="a-10" />');
    adapter.fs.files.set("/project/app/ignored.css", ".ignored {}");

    const files = await collectTailwindSourceFiles({
      projectDir: "/project",
      patterns: ["**/*"],
      adapter,
    });

    assertEquals(files.map((file) => file.path), [
      "/project/app/a.tsx",
      "/project/app/b.ts",
      "/project/z.tsx",
    ]);
  });

  it("does not scan explicit build output directories", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", '<div className="flex" />');
    adapter.fs.files.set("/project/custom-output/generated.tsx", '<div className="hidden" />');

    const files = await collectTailwindSourceFiles({
      projectDir: "/project",
      patterns: ["**/*"],
      adapter,
      ignoredDirs: ["/project/custom-output", "/outside/project"],
    });

    assertEquals(files.map((file) => file.path), ["/project/app/page.tsx"]);
  });

  it("propagates source read failures instead of compiling incomplete CSS", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", '<div className="flex" />');
    const readFile = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = (path: string) => {
      if (path === "/project/app/page.tsx") {
        return Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));
      }
      return readFile(path);
    };

    await assertRejects(
      () =>
        collectTailwindSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      Error,
      "permission denied",
    );
  });

  it("rejects configuration that excludes the entire project", async () => {
    await assertRejects(
      () =>
        collectTailwindSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter: createMockAdapter(),
          ignoredDirs: ["/project"],
        }),
      TypeError,
      "cannot include the project root",
    );
  });

  it("rejects unbounded content-pattern input", async () => {
    await assertRejects(
      () =>
        collectTailwindSourceFiles({
          projectDir: "/project",
          patterns: Array.from({ length: 257 }, (_, index) => `src/${index}/**/*`),
          adapter: createMockAdapter(),
        }),
      TypeError,
      "cannot exceed 256 entries",
    );
  });
});
