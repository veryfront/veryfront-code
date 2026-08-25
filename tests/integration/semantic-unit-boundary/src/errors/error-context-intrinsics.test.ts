import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { safeFileRead, safeFileStat, safeReadDir } from "#veryfront/errors/error-context.ts";

describe("error-context intrinsic hardening", () => {
  it("preserves filesystem fallbacks when absolute-path classification is poisoned", async () => {
    const originalRegExpTest = RegExp.prototype.test;
    let readResult: string | null;
    let statResult: { isFile: boolean; isDirectory: boolean } | null;
    let directoryResult: string[];
    try {
      RegExp.prototype.test = () => {
        throw new Error("poisoned RegExp.prototype.test");
      };
      readResult = await safeFileRead(
        {
          fs: {
            readFile: () => Promise.reject(new Error("read failed")),
          },
        },
        "/private/read-secret.txt",
        "read-file",
      );
      statResult = await safeFileStat(
        {
          fs: {
            stat: () => Promise.reject(new Error("stat failed")),
          },
        },
        "/private/stat-secret.txt",
        "stat-file",
      );
      directoryResult = await safeReadDir<string>(
        {
          fs: {
            readDir(): AsyncIterable<string> {
              throw new Error("directory read failed");
            },
          },
        },
        "/private/directory",
        "read-directory",
      );
    } finally {
      RegExp.prototype.test = originalRegExpTest;
    }

    assertEquals(readResult, null);
    assertEquals(statResult, null);
    assertEquals(directoryResult, []);
  });

  it("redacts canonical file paths after relevant live intrinsics are poisoned", async () => {
    const captured: { message: string; data: Record<string, unknown> }[] = [];
    const originalLogDebug = serverLogger.debug;
    const originalDecodeURIComponent = globalThis.decodeURIComponent;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalSlice = String.prototype.slice;
    const originalSplit = String.prototype.split;
    const originalToLowerCase = String.prototype.toLowerCase;
    const originalToUpperCase = String.prototype.toUpperCase;
    const originalJoin = Array.prototype.join;
    const originalPop = Array.prototype.pop;
    const originalPush = Array.prototype.push;
    serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
      Reflect.apply(originalPush, captured, [{ message, data }]);
    }) as typeof serverLogger.debug;

    const fileRequestedPath = "file://%6cocalhost/audit-root/project/../private-source-marker";
    const fileNormalizedPath = "file:///audit-root/private-source-marker";
    const windowsRequestedPath = "c:/audit-root/project/../private-windows-marker";
    const windowsNormalizedPath = "C:/audit-root/private-windows-marker";
    let fileResult: string | null;
    let windowsResult: string | null;
    try {
      globalThis.decodeURIComponent = () => "not-localhost";
      String.prototype.charCodeAt = () => 0;
      String.prototype.slice = () => "";
      String.prototype.split = () => [];
      String.prototype.toLowerCase = () => "not-file";
      String.prototype.toUpperCase = () => "x";
      Array.prototype.join = () => "";
      Array.prototype.pop = () => undefined;
      Array.prototype.push = () => 0;
      fileResult = await safeFileRead(
        {
          fs: {
            readFile: () => Promise.reject(new Error(`read failed for ${fileNormalizedPath}`)),
          },
        },
        fileRequestedPath,
        "read-file",
      );
      windowsResult = await safeFileRead(
        {
          fs: {
            readFile: () => Promise.reject(new Error(`read failed for ${windowsNormalizedPath}`)),
          },
        },
        windowsRequestedPath,
        "read-file",
      );
    } finally {
      Array.prototype.push = originalPush;
      Array.prototype.pop = originalPop;
      Array.prototype.join = originalJoin;
      String.prototype.toUpperCase = originalToUpperCase;
      String.prototype.toLowerCase = originalToLowerCase;
      String.prototype.split = originalSplit;
      String.prototype.slice = originalSlice;
      String.prototype.charCodeAt = originalCharCodeAt;
      globalThis.decodeURIComponent = originalDecodeURIComponent;
      serverLogger.debug = originalLogDebug;
    }

    assertEquals(fileResult, null);
    assertEquals(windowsResult, null);
    assertEquals(captured.length, 2);
    for (
      const [index, normalizedPath] of [
        [0, fileNormalizedPath],
        [1, windowsNormalizedPath],
      ] as const
    ) {
      const diagnostic = captured[index];
      assertExists(diagnostic);
      assertEquals(diagnostic.data.path, "<absolute-path>");
      assertEquals(String(diagnostic.data.errorMessage).includes(normalizedPath), false);
      assertEquals(diagnostic.message.includes(normalizedPath), false);
      assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
    }
  });
});
