import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "./safe-diagnostics.ts";
import {
  createErrorScope,
  safeFileRead,
  safeFileStat,
  safeReadDir,
  withErrorContext,
  withErrorContextSync,
} from "./error-context.ts";

describe("error-context", () => {
  describe("withErrorContext", () => {
    it("should return result on success", async () => {
      const result = await withErrorContext(
        () => Promise.resolve("success"),
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "success");
    });

    it("should return fallback on error", async () => {
      const result = await withErrorContext(
        () => Promise.reject(new Error("test error")),
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "fallback");
    });

    it("should handle null fallback", async () => {
      const result = await withErrorContext(
        () => Promise.reject(new Error("test error")),
        { operation: "test" },
        { fallback: null },
      );
      assertEquals(result, null);
    });

    it("should handle complex return types", async () => {
      const result = await withErrorContext(
        () => Promise.resolve({ data: [1, 2, 3] }),
        { operation: "test" },
        { fallback: { data: [] } },
      );
      assertEquals(result, { data: [1, 2, 3] });
    });

    it("should use fallback for complex types on error", async () => {
      const result = await withErrorContext(
        () => Promise.reject(new Error("test")),
        { operation: "test" },
        { fallback: { data: [] } },
      );
      assertEquals(result, { data: [] });
    });

    it("should fail closed for hostile runtime operation values", async () => {
      let coercions = 0;
      const hostileOperation = {
        [Symbol.toPrimitive](): never {
          coercions++;
          throw new Error("blocked");
        },
      } as unknown as string;

      const result = await withErrorContext(
        () => Promise.reject(new Error("operation failed")),
        { operation: hostileOperation },
        { fallback: "fallback" },
      );

      assertEquals(result, "fallback");
      assertEquals(coercions, 0);
    });

    it("should preserve the fallback when the error log sink throws", async () => {
      const resultPromise = (() => {
        const originalLogError = serverLogger.error;
        serverLogger.error = () => {
          throw new Error("log sink failed");
        };

        try {
          return withErrorContext(
            () => {
              throw new Error("operation failed");
            },
            { operation: "test" },
            { fallback: "fallback", logLevel: "error" },
          );
        } finally {
          serverLogger.error = originalLogError;
        }
      })();

      assertEquals(await resultPromise, "fallback");
    });

    it("should log redacted context details with the stack when requested", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      let result: string | null;
      try {
        result = await withErrorContext(
          () => Promise.reject(new Error("boom")),
          {
            operation: "read-config",
            path: "/p",
            slug: "config-not-found",
            details: { token: "sk-secret-123", ok: 1 },
          },
          { fallback: null, includeStack: true },
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(result, null, "silent failure must still return the fallback");
      assertEquals(captured.length, 1, "a silent failure must emit exactly one diagnostic");
      const entry = captured[0];
      assertExists(entry, "the diagnostic record must be captured");
      assertEquals(entry.data.token, "[REDACTED]", "sensitive detail keys must be redacted");
      assertEquals(
        JSON.stringify(entry.data).includes("sk-secret-123"),
        false,
        "the raw secret must never reach the log sink",
      );
      assertEquals(entry.data.ok, 1, "benign details must survive redaction");
      assertEquals(entry.data.path, "/p", "the context path must reach the log data");
      assertEquals(
        entry.data.slug,
        "config-not-found",
        "the context slug must reach the log data",
      );
      assertEquals(entry.data.errorMessage, "boom", "the error message must reach the log data");
      assertEquals(typeof entry.data.stack, "string", "includeStack must attach a stack trace");
      assertEquals(
        entry.message.includes("[read-config]"),
        true,
        "the diagnostic message must name the operation",
      );
      assertEquals(
        entry.message.includes("boom"),
        true,
        "the diagnostic message must carry the error message",
      );
    });

    it("should omit the stack when includeStack is not requested", async () => {
      const captured: Record<string, unknown>[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((_message: string, data: Record<string, unknown>) => {
        captured.push(data);
      }) as typeof serverLogger.debug;

      try {
        await withErrorContext(
          () => Promise.reject(new Error("boom")),
          { operation: "read-config" },
          { fallback: null },
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 1, "a silent failure must emit exactly one diagnostic");
      const data = captured[0];
      assertExists(data, "the diagnostic record must be captured");
      assertEquals(data.stack, undefined, "the stack must stay out of the log data by default");
    });

    it("should not invoke conversion hooks on a thrown object", async () => {
      let coercions = 0;
      const hostile = {
        [Symbol.toPrimitive](): never {
          coercions++;
          throw new Error("conversion hook must not run");
        },
      };

      const result = await withErrorContext(
        () => Promise.reject(hostile),
        { operation: "test" },
        { fallback: "fallback" },
      );

      assertEquals(result, "fallback");
      assertEquals(coercions, 0);
    });
  });

  describe("withErrorContextSync", () => {
    it("should return result on success", () => {
      const result = withErrorContextSync(
        () => "success",
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "success");
    });

    it("should return fallback on error", () => {
      const result = withErrorContextSync(
        () => {
          throw new Error("test error");
        },
        { operation: "test" },
        { fallback: "fallback" },
      );
      assertEquals(result, "fallback");
    });

    it("should handle number fallback", () => {
      const result = withErrorContextSync(
        () => {
          throw new Error("test");
        },
        { operation: "test" },
        { fallback: 0 },
      );
      assertEquals(result, 0);
    });

    it("should handle array fallback", () => {
      const result = withErrorContextSync(
        () => {
          throw new Error("test");
        },
        { operation: "test" },
        { fallback: [] as string[] },
      );
      assertEquals(result, []);
    });

    it("should fail closed for hostile runtime operation values", () => {
      let coercions = 0;
      const hostileOperation = {
        [Symbol.toPrimitive](): never {
          coercions++;
          throw new Error("blocked");
        },
      } as unknown as string;

      const result = withErrorContextSync(
        () => {
          throw new Error("operation failed");
        },
        { operation: hostileOperation },
        { fallback: "fallback" },
      );

      assertEquals(result, "fallback");
      assertEquals(coercions, 0);
    });

    it("should preserve the fallback when the error log sink throws", () => {
      const originalLogError = serverLogger.error;
      serverLogger.error = () => {
        throw new Error("log sink failed");
      };

      try {
        const result = withErrorContextSync(
          () => {
            throw new Error("operation failed");
          },
          { operation: "test" },
          { fallback: "fallback", logLevel: "error" },
        );

        assertEquals(result, "fallback");
      } finally {
        serverLogger.error = originalLogError;
      }
    });
  });

  describe("safeReadDir", () => {
    it("should return an empty list when both iteration and debug logging fail", async () => {
      const resultPromise = (() => {
        const originalLogDebug = serverLogger.debug;
        serverLogger.debug = () => {
          throw new Error("log sink failed");
        };

        try {
          return safeReadDir(
            {
              fs: {
                readDir(): AsyncIterable<string> {
                  throw new Error("directory iteration failed");
                },
              },
            },
            "/project",
            "read-directory",
          );
        } finally {
          serverLogger.debug = originalLogDebug;
        }
      })();

      assertEquals(await resultPromise, []);
    });

    it("bounds oversized adapter diagnostics in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;
      const oversizedMessage = "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS * 100);

      try {
        await safeFileRead(
          { fs: { readFile: () => Promise.reject(new Error(oversizedMessage)) } },
          "/private/read-file",
          "read-file",
        );
        await safeFileStat(
          { fs: { stat: () => Promise.reject(new Error(oversizedMessage)) } },
          "/private/stat-file",
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(new Error(oversizedMessage));
              },
            },
          },
          "/private/read-directory",
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(errorMessage.length, ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
        assertEquals(errorMessage.endsWith("...[truncated]"), true);
      }
    });

    it("redacts normalized and truncated absolute paths from safe filesystem diagnostics", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const readPath = "C:\\workspace\\project\\read-secret.txt";
      const readDiagnosticPath = "c:/WORKSPACE/PROJECT/read-secret.txt";
      const statPath = "\\\\example.invalid\\share\\project\\stat-secret.txt";
      const statDiagnosticPath = "//EXAMPLE.INVALID/share/project/stat-secret.txt";
      const directoryPath = `/workspace/project/${"segment/".repeat(400)}dir-secret`;
      let readResult: string | null;
      let statResult: { isFile: boolean; isDirectory: boolean } | null;
      let directoryResult: string[];
      try {
        readResult = await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error(`read failed for ${readDiagnosticPath}`)),
            },
          },
          readPath,
          "read-file",
        );
        statResult = await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error(`stat failed for ${statDiagnosticPath}`)),
            },
          },
          statPath,
          "stat-file",
        );
        directoryResult = await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(new Error(`read directory failed for ${directoryPath}`));
              },
            },
          },
          directoryPath,
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(readResult, null);
      assertEquals(statResult, null);
      assertEquals(directoryResult, []);
      assertEquals(captured.length, 3);
      for (
        const [index, path, diagnosticPath] of [
          [0, readPath, readDiagnosticPath],
          [1, statPath, statDiagnosticPath],
          [2, directoryPath, directoryPath],
        ] as const
      ) {
        const diagnostic = captured[index];
        assertExists(diagnostic);
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(diagnostic.message.includes("<absolute-path>"), true);
        assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
        assertEquals(JSON.stringify(diagnostic).includes(path), false);
        assertEquals(JSON.stringify(diagnostic).includes(diagnosticPath), false);
      }
    });

    it("redacts a dot-segment-normalized absolute path from a file diagnostic", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const requestedPath = "/audit-root/project/../private-source-marker";
      const normalizedPath = "/audit-root/private-source-marker";
      let result: string | null;
      try {
        result = await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error(`read failed for ${normalizedPath}`)),
            },
          },
          requestedPath,
          "read-file",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(result, null);
      const diagnostic = captured[0];
      assertExists(diagnostic);
      assertEquals(diagnostic.data.path, "<absolute-path>");
      assertEquals(String(diagnostic.data.errorMessage).includes(normalizedPath), false);
      assertEquals(diagnostic.message.includes(normalizedPath), false);
      assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
    });

    it("redacts a dot-segment-normalized file URL from a file diagnostic", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const requestedPath = "file:///audit-root/project/../private-source-marker";
      const normalizedPath = "file:///audit-root/private-source-marker";
      let result: string | null;
      try {
        result = await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error(`read failed for ${normalizedPath}`)),
            },
          },
          requestedPath,
          "read-file",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(result, null);
      const diagnostic = captured[0];
      assertExists(diagnostic);
      assertEquals(diagnostic.data.path, "<absolute-path>");
      assertEquals(String(diagnostic.data.errorMessage).includes(normalizedPath), false);
      assertEquals(diagnostic.message.includes(normalizedPath), false);
      assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
    });

    it("redacts whitespace-prefixed file URLs and their native path diagnostics", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const requestedPath = " \tfile:///private-source-marker/nope\r\n";
      const nativePath = "/private-source-marker/nope";
      let result: string | null;
      try {
        result = await safeFileRead(
          {
            fs: {
              readFile: () =>
                Promise.reject(
                  new Error(`read failed for ${requestedPath} as ${nativePath}`),
                ),
            },
          },
          requestedPath,
          "read-file",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(result, null);
      const diagnostic = captured[0];
      assertExists(diagnostic);
      assertEquals(diagnostic.data.path, "<absolute-path>");
      assertEquals(JSON.stringify(diagnostic).includes(requestedPath), false);
      assertEquals(JSON.stringify(diagnostic).includes(nativePath), false);
      assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
    });

    it("redacts host file URL aliases with scheme controls and repeated separators", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        ["fi\nle:///private//read-marker/nope", "/private//read-marker/nope"],
        ["fi\tle:///private//stat-marker/nope", "/private//stat-marker/nope"],
        ["fi\rle:///private//directory-marker/nope", "/private//directory-marker/nope"],
      ] as const;
      try {
        await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error(`read failed for ${cases[0][1]}`)),
            },
          },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error(`stat failed for ${cases[1][1]}`)),
            },
          },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error(`directory read failed for ${cases[2][1]}`),
                );
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (let index = 0; index < cases.length; index++) {
        const diagnostic = captured[index];
        assertExists(diagnostic);
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(JSON.stringify(diagnostic).includes(cases[index]![0]), false);
        assertEquals(JSON.stringify(diagnostic).includes(cases[index]![1]), false);
        assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
      }
    });

    it("redacts POSIX vertical-bar aliases in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        ["file:///c%7C/private-read-marker/nope", "/c|/private-read-marker/nope"],
        ["file:///d%7C/private-stat-marker/nope", "/d|/private-stat-marker/nope"],
        ["file:///e%7C/private-directory-marker/nope", "/e|/private-directory-marker/nope"],
      ] as const;
      try {
        await safeFileRead(
          { fs: { readFile: () => Promise.reject(new Error(`read failed for ${cases[0][1]}`)) } },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          { fs: { stat: () => Promise.reject(new Error(`stat failed for ${cases[1][1]}`)) } },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error(`directory read failed for ${cases[2][1]}`),
                );
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (let index = 0; index < cases.length; index++) {
        const diagnostic = captured[index];
        assertExists(diagnostic);
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(JSON.stringify(diagnostic).includes(cases[index]![1]), false);
        assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
      }
    });

    it("redacts Unicode UNC aliases for IDN file authorities in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        [
          "file://xn--bcher-kva.example/share/private-read-marker",
          "\\\\bücher.example\\share\\private-read-marker",
        ],
        [
          "file://xn--bcher-kva.example/share/private-stat-marker",
          "\\\\bücher.example\\share\\private-stat-marker",
        ],
        [
          "file://xn--bcher-kva.example/share/private-directory-marker",
          "\\\\bücher.example\\share\\private-directory-marker",
        ],
      ] as const;
      try {
        await safeFileRead(
          { fs: { readFile: () => Promise.reject(new Error(`read failed for ${cases[0][1]}`)) } },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          { fs: { stat: () => Promise.reject(new Error(`stat failed for ${cases[1][1]}`)) } },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error(`directory read failed for ${cases[2][1]}`),
                );
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (let index = 0; index < cases.length; index++) {
        const diagnostic = captured[index];
        assertExists(diagnostic);
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(JSON.stringify(diagnostic).includes(cases[index]![1]), false);
        assertEquals(String(diagnostic.data.errorMessage).includes("private-"), false);
        assertEquals(String(diagnostic.data.errorMessage).includes("<absolute-path>"), true);
      }
    });

    it("redacts JSON-escaped Windows paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const paths = [
        "C:\\private-read-marker\\nope",
        "D:\\private-stat-marker\\nope",
        "E:\\private-directory-marker\\nope",
      ] as const;
      try {
        await safeFileRead(
          {
            fs: {
              readFile: () =>
                Promise.reject(new Error(`read failed for ${JSON.stringify(paths[0])}`)),
            },
          },
          paths[0],
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error(`stat failed for ${JSON.stringify(paths[1])}`)),
            },
          },
          paths[1],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error(`directory read failed for ${JSON.stringify(paths[2])}`),
                );
              },
            },
          },
          paths[2],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (let index = 0; index < paths.length; index++) {
        const diagnostic = captured[index];
        assertExists(diagnostic);
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(errorMessage.includes(JSON.stringify(paths[index])), false);
        assertEquals(errorMessage.includes("private-"), false);
        assertEquals(errorMessage.includes("<absolute-path>"), true);
      }
    });

    it("redacts single-quoted escaped Windows paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        ["C:\\private-read-marker\\nope", "'C:\\\\private-read-marker\\\\nope'"],
        ["D:\\private-stat-marker\\nope", "'D:\\\\private-stat-marker\\\\nope'"],
        ["E:\\private-directory-marker\\nope", "'E:\\\\private-directory-marker\\\\nope'"],
      ] as const;
      try {
        await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error(`read failed for ${cases[0][1]}`)),
            },
          },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error(`stat failed for ${cases[1][1]}`)),
            },
          },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error(`directory read failed for ${cases[2][1]}`),
                );
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (let index = 0; index < cases.length; index++) {
        const diagnostic = captured[index];
        assertExists(diagnostic);
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(errorMessage.includes(cases[index]![1]), false);
        assertEquals(errorMessage.includes("private-"), false);
        assertEquals(errorMessage.includes("<absolute-path>"), true);
      }
    });

    it("redacts inspected control-character paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        ["C:\\private-read\x01marker\\nope", "'C:\\\\private-read\\x01marker\\\\nope'"],
        ["D:\\private-stat\x01marker\\nope", "'D:\\\\private-stat\\x01marker\\\\nope'"],
        ["E:\\private-directory\x01marker\\nope", "'E:\\\\private-directory\\x01marker\\\\nope'"],
      ] as const;
      try {
        await safeFileRead(
          { fs: { readFile: () => Promise.reject(new Error(`read failed ${cases[0][1]}`)) } },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          { fs: { stat: () => Promise.reject(new Error(`stat failed ${cases[1][1]}`)) } },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(new Error(`directory failed ${cases[2][1]}`));
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertExists(diagnostic);
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(errorMessage.includes("private-"), false);
        assertEquals(errorMessage.includes("<absolute-path>"), true);
      }
    });

    it("redacts inspected paths containing every quote delimiter", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        ["/private-read/'\"`/secret", "'/private-read/\\'\"`/secret'"],
        ["/private-stat/'\"`/secret", "'/private-stat/\\'\"`/secret'"],
        ["/private-directory/'\"`/secret", "'/private-directory/\\'\"`/secret'"],
      ] as const;
      try {
        await safeFileRead(
          { fs: { readFile: () => Promise.reject(new Error(`read failed ${cases[0][1]}`)) } },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          { fs: { stat: () => Promise.reject(new Error(`stat failed ${cases[1][1]}`)) } },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(new Error(`directory failed ${cases[2][1]}`));
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertExists(diagnostic);
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(errorMessage.includes("private-"), false);
        assertEquals(errorMessage.includes("<absolute-path>"), true);
      }
    });

    it("redacts URI-encoded paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        ["/a b/private-read-marker", "/a%20b/private-read-marker"],
        ["/c d/private-stat-marker", "/c%20d/private-stat-marker"],
        ["/e f/private-directory-marker", "/e%20f/private-directory-marker"],
      ] as const;
      try {
        await safeFileRead(
          { fs: { readFile: () => Promise.reject(new Error(`read failed ${cases[0][1]}`)) } },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          { fs: { stat: () => Promise.reject(new Error(`stat failed ${cases[1][1]}`)) } },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(new Error(`directory failed ${cases[2][1]}`));
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertExists(diagnostic);
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(errorMessage.includes("private-"), false);
        assertEquals(errorMessage.includes("<absolute-path>"), true);
      }
    });

    it("redacts component-encoded paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const paths = [
        "/definitely-private-read-marker/secret",
        "/definitely-private-stat-marker/secret file",
        "/definitely-private-directory-marker/secret",
      ] as const;
      try {
        await safeFileRead(
          {
            fs: {
              readFile: () =>
                Promise.reject(new Error(`read failed ${encodeURIComponent(paths[0])}`)),
            },
          },
          paths[0],
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () =>
                Promise.reject(
                  new Error(`stat failed ${new URLSearchParams({ path: paths[1] }).toString()}`),
                ),
            },
          },
          paths[1],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error(`directory failed ${encodeURIComponent(paths[2])}`),
                );
              },
            },
          },
          paths[2],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertExists(diagnostic);
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(errorMessage.includes("private-"), false);
        assertEquals(errorMessage.includes("<absolute-path>"), true);
      }
    });

    it("fails closed when adapters resolve relative paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const resolvedPaths = [
        "/workspace/project/config/private-read.json",
        "/workspace/project/config/private-stat.json",
        "/workspace/project/config/private-directory",
      ] as const;
      try {
        await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error(`read failed ${resolvedPaths[0]}`)),
            },
          },
          "config/private-read.json",
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error(`stat failed ${resolvedPaths[1]}`)),
            },
          },
          "config/private-stat.json",
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(new Error(`directory failed ${resolvedPaths[2]}`));
              },
            },
          },
          "config/private-directory",
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertExists(diagnostic);
        assertEquals(String(diagnostic.data.path).startsWith("config/"), true);
        assertEquals(
          diagnostic.data.errorMessage,
          "Filesystem operation failed for <absolute-path>",
        );
      }
    });

    it("redacts Node null-byte path aliases in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const cases = [
        ["/private-read\0marker/nope", "/private-read\\x00marker/nope"],
        ["C:\\private-stat\0marker\\nope", "C:\\private-stat\\x00marker\\nope"],
        ["/private-directory\0marker/nope", "/private-directory\\x00marker/nope"],
      ] as const;
      try {
        await safeFileRead(
          { fs: { readFile: () => Promise.reject(new Error(`read failed for ${cases[0][1]}`)) } },
          cases[0][0],
          "read-file",
        );
        await safeFileStat(
          { fs: { stat: () => Promise.reject(new Error(`stat failed for ${cases[1][1]}`)) } },
          cases[1][0],
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error(`directory read failed for ${cases[2][1]}`),
                );
              },
            },
          },
          cases[2][0],
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (let index = 0; index < cases.length; index++) {
        const diagnostic = captured[index];
        assertExists(diagnostic);
        const errorMessage = String(diagnostic.data.errorMessage);
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(errorMessage.includes(cases[index]![1]), false);
        assertEquals(errorMessage.includes("private-"), false);
        assertEquals(errorMessage.includes("<absolute-path>"), true);
      }
    });

    it("fails closed for truncated single-segment paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      try {
        await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error("read failed for /private-read-mar")),
            },
          },
          "/private-read-marker",
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error("stat failed for c:/private-stat-mar")),
            },
          },
          "C:\\private-stat-marker",
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error("directory read failed for /private-directory-mar"),
                );
              },
            },
          },
          "file:///private-directory-marker",
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(
          diagnostic.data.errorMessage,
          "Filesystem operation failed for <absolute-path>",
        );
        assertEquals(diagnostic.message.includes("private"), false);
      }
    });

    it("fails closed for ellipsis-suffixed paths in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      try {
        await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error("read failed for /private-read-mar...")),
            },
          },
          "/private-read-marker/secret",
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error("stat failed for c:/private-stat-mar...")),
            },
          },
          "C:\\private-stat-marker\\secret",
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error("directory read failed for /private-directory-mar..."),
                );
              },
            },
          },
          "file:///private-directory-marker/secret",
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(
          diagnostic.data.errorMessage,
          "Filesystem operation failed for <absolute-path>",
        );
        assertEquals(diagnostic.message.includes("private"), false);
      }
    });

    it("fails closed for first-segment truncation in every filesystem helper", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      try {
        await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error("read failed for //private-read-control")),
            },
          },
          "//private-read-control-plane.example/share/file",
          "read-file",
        );
        await safeFileStat(
          {
            fs: {
              stat: () => Promise.reject(new Error("stat failed for c:/private-stat-mar")),
            },
          },
          "C:\\private-stat-marker\\share\\file",
          "stat-file",
        );
        await safeReadDir<string>(
          {
            fs: {
              async *readDir(): AsyncIterable<string> {
                yield await Promise.reject(
                  new Error("directory read failed for /private-directory-mar"),
                );
              },
            },
          },
          "file:///private-directory-marker/share/file",
          "read-directory",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(captured.length, 3);
      for (const diagnostic of captured) {
        assertEquals(diagnostic.data.path, "<absolute-path>");
        assertEquals(
          diagnostic.data.errorMessage,
          "Filesystem operation failed for <absolute-path>",
        );
        assertEquals(diagnostic.message.includes("private"), false);
      }
    });

    it("fails closed when a file diagnostic contains only a truncated absolute-path prefix", async () => {
      const captured: { message: string; data: Record<string, unknown> }[] = [];
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured.push({ message, data });
      }) as typeof serverLogger.debug;

      const requestedPath = `/audit-root/${"segment/".repeat(400)}private-source-marker`;
      const truncatedPath = requestedPath.slice(0, 1_200);
      let result: string | null;
      try {
        result = await safeFileRead(
          {
            fs: {
              readFile: () => Promise.reject(new Error(`read failed for ${truncatedPath}`)),
            },
          },
          requestedPath,
          "read-file",
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(result, null);
      const diagnostic = captured[0];
      assertExists(diagnostic);
      assertEquals(diagnostic.data.path, "<absolute-path>");
      assertEquals(diagnostic.data.errorMessage, "Filesystem operation failed for <absolute-path>");
      assertEquals(diagnostic.message.includes(truncatedPath), false);
    });
  });

  describe("createErrorScope", () => {
    it("should create a scoped error handler", async () => {
      const scope = createErrorScope("TestScope");
      const result = await scope.run(() => Promise.resolve("success"), {}, "fallback");
      assertEquals(result, "success");
    });

    it("should use fallback on error in scoped handler", async () => {
      const scope = createErrorScope("TestScope");
      const result = await scope.run(
        () => Promise.reject(new Error("scoped error")),
        {},
        "fallback",
      );
      assertEquals(result, "fallback");
    });

    it("should handle runSync operations", () => {
      const scope = createErrorScope("TestScope");
      const result = scope.runSync(() => "sync success", {}, "fallback");
      assertEquals(result, "sync success");
    });

    it("should handle runSync errors", () => {
      const scope = createErrorScope("TestScope");
      const result = scope.runSync(
        () => {
          throw new Error("sync error");
        },
        {},
        "sync fallback",
      );
      assertEquals(result, "sync fallback");
    });

    it("should pass details to context", async () => {
      const scope = createErrorScope("FileOps");
      let captured: { message: string; data: Record<string, unknown> } | undefined;
      const originalLogDebug = serverLogger.debug;
      serverLogger.debug = ((message: string, data: Record<string, unknown>) => {
        captured = { message, data };
      }) as typeof serverLogger.debug;

      let result: string | null;
      try {
        result = await scope.run(
          () => Promise.reject(new Error("scoped failure")),
          { path: "/test/path", slug: "test-slug", details: { attempt: 2 } },
          null,
        );
      } finally {
        serverLogger.debug = originalLogDebug;
      }

      assertEquals(result, null, "scoped run must return the fallback on failure");
      assertEquals(captured?.data.path, "/test/path", "scoped path must reach the error context");
      assertEquals(captured?.data.slug, "test-slug", "scoped slug must reach the error context");
      assertEquals(captured?.data.attempt, 2, "scoped details must be merged into the log data");
      assertEquals(
        captured?.message.startsWith("[FileOps] Silent failure:"),
        true,
        "scope name must prefix the diagnostic message",
      );
    });

    it("should handle different log levels", async () => {
      const scope = createErrorScope("TestScope");
      let errorCalls = 0;
      let warnCalls = 0;
      let debugCalls = 0;

      const originalLogError = serverLogger.error;
      const originalLogWarn = serverLogger.warn;
      const originalLogDebug = serverLogger.debug;
      serverLogger.error = (() => {
        errorCalls++;
      }) as typeof serverLogger.error;
      serverLogger.warn = (() => {
        warnCalls++;
      }) as typeof serverLogger.warn;
      serverLogger.debug = (() => {
        debugCalls++;
      }) as typeof serverLogger.debug;

      try {
        const result1 = await scope.run(
          () => Promise.reject(new Error("error level")),
          {},
          "fallback",
          "error",
        );
        assertEquals(result1, "fallback", "the fallback is returned at error level");
        assertEquals(
          [errorCalls, warnCalls, debugCalls],
          [1, 0, 0],
          "logLevel error must reach serverLogger.error only",
        );

        const result2 = await scope.run(
          () => Promise.reject(new Error("warn level")),
          {},
          "fallback",
          "warn",
        );
        assertEquals(result2, "fallback", "the fallback is returned at warn level");
        assertEquals(
          [errorCalls, warnCalls, debugCalls],
          [1, 1, 0],
          "logLevel warn must reach serverLogger.warn only",
        );

        const result3 = await scope.run(
          () => Promise.reject(new Error("default level")),
          {},
          "fallback",
        );
        assertEquals(result3, "fallback", "the fallback is returned at the default level");
        assertEquals(
          [errorCalls, warnCalls, debugCalls],
          [1, 1, 1],
          "default logLevel must route to serverLogger.debug",
        );
      } finally {
        serverLogger.error = originalLogError;
        serverLogger.warn = originalLogWarn;
        serverLogger.debug = originalLogDebug;
      }
    });

    it("should preserve the fallback when scoped context getters throw", async () => {
      const scope = createErrorScope("SafeScope");
      const details = Object.defineProperty({}, "path", {
        enumerable: true,
        get(): never {
          throw new Error("blocked");
        },
      }) as Parameters<typeof scope.run>[1];

      const result = await scope.run(
        () => Promise.reject(new Error("operation failed")),
        details,
        "fallback",
      );

      assertEquals(result, "fallback");
    });
  });
});
