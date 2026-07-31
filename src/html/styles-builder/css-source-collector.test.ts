import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { MAX_CSS_FILE_BYTES } from "#veryfront/utils/constants/css.ts";
import { collectCSSCandidateSourceFiles } from "./css-source-collector.ts";

describe("styles-builder/css-source-collector", () => {
  it("returns matching project sources in deterministic path order", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/z.tsx", '<div className="z-10" />');
    adapter.fs.files.set("/project/app/b.ts", 'const value = "b";');
    adapter.fs.files.set("/project/app/a.tsx", '<div className="a-10" />');
    adapter.fs.files.set("/project/app/ignored.css", ".ignored {}");

    const files = await collectCSSCandidateSourceFiles({
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

  it("applies globstar and extension alternatives without crossing segment wildcards", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", '<div className="page" />');
    adapter.fs.files.set("/project/app/nested/layout.ts", 'const value = "layout";');
    adapter.fs.files.set("/project/app/nested/deep/page.jsx", '<div className="jsx" />');
    adapter.fs.files.set("/project/pages/index.tsx", '<div className="pages" />');

    const files = await collectCSSCandidateSourceFiles({
      projectDir: "/project",
      patterns: ["app/**/*.{ts,tsx}"],
      adapter,
    });

    assertEquals(files.map((file) => file.path), [
      "/project/app/nested/layout.ts",
      "/project/app/page.tsx",
    ]);
  });

  it("does not scan explicit build output directories", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", '<div className="flex" />');
    adapter.fs.files.set("/project/custom-output/generated.tsx", '<div className="hidden" />');

    const files = await collectCSSCandidateSourceFiles({
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
    const readFileBytesWithinLimit = adapter.fs.readFileBytesWithinLimit!.bind(adapter.fs);
    adapter.fs.readFileBytesWithinLimit = (path: string, byteLimit: number) => {
      if (path === "/project/app/page.tsx") {
        return Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));
      }
      return readFileBytesWithinLimit(path, byteLimit);
    };

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
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
        collectCSSCandidateSourceFiles({
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
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: Array.from({ length: 257 }, (_, index) => `src/${index}/**/*`),
          adapter: createMockAdapter(),
        }),
      TypeError,
      "cannot exceed 256 entries",
    );
  });

  it("rejects malformed content globs before scanning", async () => {
    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["app/**/*.{ts,tsx"],
          adapter: createMockAdapter(),
        }),
      TypeError,
      "Invalid path glob",
    );
  });

  it("admits a source file at the 16 MiB UTF-8 boundary", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", "é".repeat(8 * 1024 * 1024));

    const files = await collectCSSCandidateSourceFiles({
      projectDir: "/project",
      patterns: ["**/*"],
      adapter,
    });

    assertEquals(files.length, 1);
  });

  it("rejects a source file whose actual UTF-8 content exceeds 16 MiB", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", "é".repeat(8 * 1024 * 1024 + 1));

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      TypeError,
      "16777216 bytes",
    );
  });

  it("uses a bounded byte read when a source grows after stat", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", "small");
    let unboundedReads = 0;
    let requestedLimit = 0;
    adapter.fs.readFile = () => {
      unboundedReads++;
      throw new Error("unbounded text read must not be invoked");
    };
    adapter.fs.readFileBytesWithinLimit = (_path, byteLimit) => {
      requestedLimit = byteLimit;
      return Promise.reject(new RangeError(`File exceeds byte limit of ${byteLimit} bytes`));
    };

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      TypeError,
      `${MAX_CSS_FILE_BYTES} bytes`,
    );
    assertEquals(requestedLimit, MAX_CSS_FILE_BYTES);
    assertEquals(unboundedReads, 0);
  });

  it("fails closed before an unbounded read when bounded bytes are unavailable", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/app/page.tsx", "export default null;");
    let unboundedReads = 0;
    adapter.fs.readFileBytesWithinLimit = undefined;
    adapter.fs.readFile = () => {
      unboundedReads++;
      return Promise.resolve("export default null;");
    };

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      TypeError,
      "bounded byte reader",
    );
    assertEquals(unboundedReads, 0);
  });

  it("rejects malformed UTF-8 source bytes deterministically", async () => {
    const adapter = createMockAdapter();
    adapter.fs.byteFiles.set(
      "/project/app/page.tsx",
      new Uint8Array([0xc3, 0x28]),
    );

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      TypeError,
      "valid UTF-8",
    );
  });

  it("rejects more than 10,000 selected source files", async () => {
    const adapter = createMockAdapter();
    for (let index = 0; index <= 10_000; index++) {
      adapter.fs.files.set(`/project/app/source-${index}.ts`, "");
    }

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      TypeError,
      "10000 files",
    );
  });

  it("rejects source trees deeper than 64 directories", async () => {
    const adapter = createMockAdapter();
    const nestedPath = Array.from({ length: 65 }, (_, index) => `level-${index}`).join("/");
    adapter.fs.files.set(`/project/${nestedPath}/page.tsx`, "export default null;");

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      TypeError,
      "64 directory levels",
    );
  });

  it("rejects source trees with more than 100,000 directory entries", async () => {
    const adapter = createMockAdapter();
    adapter.fs.readDir = async function* () {
      for (let index = 0; index <= 100_000; index++) {
        yield {
          name: `entry-${index}`,
          isDirectory: false,
          isFile: false,
          isSymlink: false,
        };
      }
    };

    await assertRejects(
      () =>
        collectCSSCandidateSourceFiles({
          projectDir: "/project",
          patterns: ["**/*"],
          adapter,
        }),
      TypeError,
      "100000 entries",
    );
  });
});
