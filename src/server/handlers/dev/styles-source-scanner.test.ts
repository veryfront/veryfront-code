import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "../types.ts";
import { MAX_STYLE_SOURCE_FILE_BYTES } from "#veryfront/html/styles-builder/resource-limits.ts";
import { collectStyleSourceFiles } from "./styles-source-scanner.ts";

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

function makeContext(
  adapter: ReturnType<typeof createMockAdapter>,
  getAllSourceFiles?: () => Promise<Array<{ path: string; content?: string }>>,
): HandlerContext {
  const fs = getAllSourceFiles
    ? {
      ...adapter.fs,
      getUnderlyingAdapter: () => ({ getAllSourceFiles }),
    }
    : adapter.fs;
  return {
    projectDir: "/project",
    projectSlug: "scanner-test",
    adapter: { ...adapter, fs } as HandlerContext["adapter"],
    securityConfig: null,
    cspUserHeader: null,
  };
}

describe("server/handlers/dev/styles-source-scanner", () => {
  it("rejects oversized adapter-provided source before candidate or import parsing", async () => {
    const adapter = createMockAdapter();
    const ctx = makeContext(adapter, () =>
      Promise.resolve([{
        path: "/project/app/page.tsx",
        content: "x".repeat(MAX_STYLE_SOURCE_FILE_BYTES + 1),
      }]));

    await assertRejects(
      () => collectStyleSourceFiles(ctx, { extensions: SOURCE_EXTENSIONS }),
      TypeError,
      "size limit",
    );
  });

  it("ignores adapter-provided paths outside the project root", async () => {
    const adapter = createMockAdapter();
    const ctx = makeContext(adapter, () =>
      Promise.resolve([{
        path: "/project-sibling/private.tsx",
        content: '<div className="outside-project" />',
      }]));

    const files = await collectStyleSourceFiles(ctx, { extensions: SOURCE_EXTENSIONS });
    assertEquals(files, []);
  });

  it("propagates operational source read failures", async () => {
    const adapter = createMockAdapter();
    const privateDetail = "private-source-read-detail";
    adapter.fs.stat = () =>
      Promise.resolve({
        size: 12,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: new Date(),
      });
    adapter.fs.readFile = () =>
      Promise.reject(Object.assign(new Error(privateDetail), { code: "EACCES" }));
    const ctx = makeContext(adapter, () => Promise.resolve([{ path: "/project/app/page.tsx" }]));

    await assertRejects(
      () => collectStyleSourceFiles(ctx, { extensions: SOURCE_EXTENSIONS }),
      Error,
      privateDetail,
    );
  });

  it("treats only a missing source file as an optional absence", async () => {
    const adapter = createMockAdapter();
    const ctx = makeContext(adapter, () => Promise.resolve([{ path: "/project/app/missing.tsx" }]));

    assertEquals(
      await collectStyleSourceFiles(ctx, { extensions: SOURCE_EXTENSIONS }),
      [],
    );
  });

  it("does not traverse local symbolic-link entries", async () => {
    const adapter = createMockAdapter();
    let statCalls = 0;
    let readCalls = 0;
    adapter.fs.readDir = async function* () {
      yield {
        name: "outside",
        isFile: false,
        isDirectory: true,
        isSymlink: true,
      };
    };
    adapter.fs.stat = (path) => {
      statCalls++;
      return Promise.reject(new Error(`Unexpected stat: ${path}`));
    };
    adapter.fs.readFile = (path) => {
      readCalls++;
      return Promise.reject(new Error(`Unexpected read: ${path}`));
    };

    const files = await collectStyleSourceFiles(makeContext(adapter), {
      extensions: SOURCE_EXTENSIONS,
    });
    assertEquals(files, []);
    assertEquals(statCalls, 0);
    assertEquals(readCalls, 0);
  });
});
