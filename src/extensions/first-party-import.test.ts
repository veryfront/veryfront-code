import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  firstPartyExtensionSourceSpecifiers,
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "./first-party-import.ts";

describe("first-party extension imports", () => {
  it("tries Deno source before generated npm source", () => {
    assertEquals(firstPartyExtensionSourceSpecifiers("ext-schema-zod"), [
      "../../extensions/ext-schema-zod/src/index.ts",
      "../../extensions/ext-schema-zod/src/index.js",
    ]);
  });

  it("builds validated workspace specifiers for an explicit source entry", () => {
    assertEquals(
      firstPartyExtensionSourceSpecifiers(
        "ext-parser-babel",
        "parser-only",
      ),
      [
        "../../extensions/ext-parser-babel/src/parser-only.ts",
        "../../extensions/ext-parser-babel/src/parser-only.js",
      ],
    );
    assertThrows(
      () =>
        firstPartyExtensionSourceSpecifiers(
          "ext-parser-babel",
          "../parser-only",
        ),
      TypeError,
    );
    for (
      const sourceDirectory of [
        "../ext-parser-babel",
        "ext-parser-babel/nested",
        "parser-babel",
        "ext_parser_babel",
      ]
    ) {
      assertThrows(
        () => firstPartyExtensionSourceSpecifiers(sourceDirectory),
        TypeError,
      );
    }
  });

  describe("isMissingFirstPartyExtensionModule", () => {
    it("matches missing-module errors without an anchor", () => {
      assertEquals(
        isMissingFirstPartyExtensionModule(
          new Error("Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js"),
        ),
        true,
      );
    });

    it("rejects unrelated errors", () => {
      assertEquals(
        isMissingFirstPartyExtensionModule(new Error("jwt secret is not configured")),
        false,
      );
    });

    it("anchors on the specifier the runtime reports as missing", () => {
      const ownError = new Error(
        "Cannot find module '/app/node_modules/veryfront/esm/extensions/ext-auth-jwt/src/index.ts' imported from /app/node_modules/veryfront/esm/src/extensions/first-party-import.js",
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(ownError, [
          "/app/node_modules/veryfront/esm/extensions/ext-auth-jwt/src/index.ts",
        ]),
        true,
      );

      const ownPackageError = new Error(
        "Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js",
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(ownPackageError, ["@veryfront/ext-auth-jwt"]),
        true,
      );
    });

    it("canonicalizes file URLs and absolute filesystem paths exactly", () => {
      const posixPathError = Object.assign(
        new Error("Cannot find module '/tmp/x.ts' imported from /app/loader.js"),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(posixPathError, [
          "file:///tmp/x.ts",
        ]),
        true,
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(posixPathError, [
          "file:///tmp/y.ts",
        ]),
        false,
      );

      const spacePathError = Object.assign(
        new Error(
          "Cannot find module '/tmp/module with spaces.ts' imported from /app/loader.js",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(spacePathError, [
          "file:///tmp/module%20with%20spaces.ts",
        ]),
        true,
      );

      const windowsPathError = Object.assign(
        new Error(
          String
            .raw`Cannot find module 'C:\repo\module with spaces.ts' imported from C:\repo\loader.js`,
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(windowsPathError, [
          "file:///C:/repo/module%20with%20spaces.ts",
        ]),
        true,
      );
    });

    it("does not misread a broken transitive dependency as a missing extension", () => {
      const transitiveError = new Error(
        "Cannot find package 'jose' imported from /app/node_modules/@veryfront/ext-auth-jwt/esm/src/index.js",
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(transitiveError, [
          "extensions/ext-auth-jwt/src/index",
          "@veryfront/ext-auth-jwt",
        ]),
        false,
      );
    });

    it("supports legacy source fragments only at path-segment boundaries", () => {
      const ownSourceError = Object.assign(
        new Error(
          "Cannot find module '/app/esm/extensions/ext-auth-jwt/src/index.ts' imported from /app/loader.js",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(ownSourceError, [
          "extensions/ext-auth-jwt/src/index",
        ]),
        true,
      );

      for (
        const reported of [
          "/app/esm/extensions/ext-auth-jwt/src/index-helper.ts",
          "/app/esm/extensions/ext-auth-jwt/src/index.ts.backup",
          "/app/esm/extensions/ext-auth-jwt/src/indexer.js",
        ]
      ) {
        assertEquals(
          isMissingFirstPartyExtensionModule(
            Object.assign(
              new Error(`Cannot find module '${reported}' imported from /app/loader.js`),
              { code: "ERR_MODULE_NOT_FOUND" },
            ),
            ["extensions/ext-auth-jwt/src/index"],
          ),
          false,
        );
      }
    });

    it("matches generic safe path fragments only at complete suffix boundaries", () => {
      const ownSourceError = Object.assign(
        new Error(
          "Cannot find module '/app/runtime/plugins/parser/entry.js' imported from /app/loader.js",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(ownSourceError, [
          "runtime/plugins/parser/entry",
        ]),
        true,
      );

      const collision = Object.assign(
        new Error(
          "Cannot find module '/app/runtime/plugins/parser/entrypoint.js' imported from /app/loader.js",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(collision, [
          "runtime/plugins/parser/entry",
        ]),
        false,
      );
    });

    it("distinguishes a missing requested subpath from its transitive failures", () => {
      const missingEntry = Object.assign(
        new Error(
          `Package subpath './parser-only' is not defined by "exports" in '/app/node_modules/@veryfront/ext-parser-babel/package.json'`,
        ),
        { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(missingEntry, [
          "@veryfront/ext-parser-babel/parser-only",
        ]),
        true,
      );

      const transitiveFailure = Object.assign(
        new Error(
          "Cannot find package 'missing-parser-helper' imported from /app/node_modules/@veryfront/ext-parser-babel/esm/parser-only.js",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(transitiveFailure, [
          "@veryfront/ext-parser-babel/parser-only",
          "@veryfront/ext-parser-babel",
        ]),
        false,
      );
    });

    it("parses exact Deno and Node package-subpath error shapes", () => {
      const denoPrefixed = Object.assign(
        new Error(
          `[ERR_PACKAGE_PATH_NOT_EXPORTED] Package subpath './parser-only' is not defined by "exports" in '/app/node_modules/@veryfront/ext-parser-babel/package.json'`,
        ),
        { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(denoPrefixed, [
          "@veryfront/ext-parser-babel/parser-only",
        ]),
        true,
      );

      const nodeUnquoted = Object.assign(
        new Error(
          `Package subpath './parser-only' is not defined by "exports" in /app/node_modules/@veryfront/ext-parser-babel/package.json imported from /app/loader.js`,
        ),
        { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(nodeUnquoted, [
          "@veryfront/ext-parser-babel/parser-only",
        ]),
        true,
      );

      const unknownPrefix = Object.assign(
        new Error(
          `[ERR_UNKNOWN_EXPORT_SHAPE] Package subpath './parser-only' is not defined by "exports" in '/app/node_modules/@veryfront/ext-parser-babel/package.json'`,
        ),
        { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(unknownPrefix, [
          "@veryfront/ext-parser-babel/parser-only",
        ]),
        false,
      );

      const moduleNotFoundPrefix = Object.assign(
        new Error(
          "[ERR_MODULE_NOT_FOUND] Cannot find module '/tmp/x.ts' imported from /app/loader.js",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(moduleNotFoundPrefix, [
          "file:///tmp/x.ts",
        ]),
        true,
      );

      const denoUnknownExport = Object.assign(
        new Error(
          `Unknown export './not-exported-review-fixture' for '@veryfront/ext-parser-babel'.
  Package exports:
 * .
 * ./parser-only`,
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(denoUnknownExport, [
          "@veryfront/ext-parser-babel/not-exported-review-fixture",
        ]),
        true,
      );
    });

    it("uses stable codes unanchored and parses exact resolver messages", () => {
      const nodeError = Object.assign(
        new Error("Unable to resolve '@veryfront/ext-auth-jwt' from /app/x.js"),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(isMissingFirstPartyExtensionModule(nodeError), true);
      assertEquals(
        isMissingFirstPartyExtensionModule(nodeError, ["@veryfront/ext-auth-jwt"]),
        true,
      );

      const unrelated = Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      });
      assertEquals(isMissingFirstPartyExtensionModule(unrelated), false);
    });

    it("requires a full recognized message when no stable code is present", () => {
      assertEquals(
        isMissingFirstPartyExtensionModule(
          new Error("Validation failed: Unknown export setting"),
        ),
        false,
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(
          new Error(
            "Validation failed: Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js",
          ),
        ),
        false,
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(
          new Error(
            "Import '@veryfront/ext-auth-jwt' failed: permission denied",
          ),
        ),
        false,
      );
    });

    it("supports the exact Node CJS missing-module shape", () => {
      const cjsError = Object.assign(
        new Error(
          "Cannot find module '@veryfront/ext-auth-jwt'\nRequire stack:\n- /app/index.cjs",
        ),
        { code: "MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(cjsError, [
          "@veryfront/ext-auth-jwt",
        ]),
        true,
      );
    });

    it("matches anchors exactly and ignores quoted importer paths", () => {
      const prefixCollision = Object.assign(
        new Error(
          "Cannot find package '@veryfront/ext-parser-babel-helper' imported from /app/x.js",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(prefixCollision, [
          "@veryfront/ext-parser-babel",
        ]),
        false,
      );

      const quotedImporter = Object.assign(
        new Error(
          "Cannot find package 'foo' imported from '/app/node_modules/@veryfront/ext-parser-babel/esm/parser-only.js'",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(quotedImporter, [
          "@veryfront/ext-parser-babel",
        ]),
        false,
      );

      const ambiguous = Object.assign(
        new Error("Module resolution failed"),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(ambiguous, [
          "@veryfront/ext-parser-babel",
        ]),
        false,
      );
    });

    it("walks the cause chain of wrapped errors", () => {
      const wrapped = new Error("Failed to initialize auth provider", {
        cause: Object.assign(
          new Error("Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js"),
          { code: "ERR_MODULE_NOT_FOUND" },
        ),
      });
      assertEquals(isMissingFirstPartyExtensionModule(wrapped), true);
      assertEquals(
        isMissingFirstPartyExtensionModule(wrapped, ["@veryfront/ext-auth-jwt"]),
        true,
      );

      const wrappedTransitive = new Error("Failed to initialize auth provider", {
        cause: Object.assign(
          new Error("Cannot find package 'jose' imported from /app/y.js"),
          { code: "ERR_MODULE_NOT_FOUND" },
        ),
      });
      assertEquals(
        isMissingFirstPartyExtensionModule(wrappedTransitive, [
          "@veryfront/ext-auth-jwt",
        ]),
        false,
      );

      const conflictingChain = Object.assign(
        new Error(
          "Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js",
          {
            cause: Object.assign(
              new Error("Cannot find package 'jose' imported from /app/y.js"),
              { code: "ERR_MODULE_NOT_FOUND" },
            ),
          },
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(conflictingChain, [
          "@veryfront/ext-auth-jwt",
        ]),
        false,
      );

      const allOwnChain = Object.assign(
        new Error(
          "Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js",
          {
            cause: Object.assign(
              new Error(
                "Unable to resolve '@veryfront/ext-auth-jwt' from /app/y.js",
              ),
              { code: "ERR_MODULE_NOT_FOUND" },
            ),
          },
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(allOwnChain, [
          "@veryfront/ext-auth-jwt",
        ]),
        true,
      );
    });

    it("fails closed on hostile error reflection", () => {
      const revocable = Proxy.revocable(
        new Error(
          "Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js",
        ),
        {},
      );
      revocable.revoke();
      assertEquals(
        isMissingFirstPartyExtensionModule(revocable.proxy, [
          "@veryfront/ext-auth-jwt",
        ]),
        false,
      );

      const throwingMessage = new Error();
      Object.defineProperty(throwingMessage, "message", {
        get() {
          throw new Error("not exposed");
        },
      });
      Object.defineProperty(throwingMessage, "code", {
        value: "ERR_MODULE_NOT_FOUND",
      });
      assertEquals(
        isMissingFirstPartyExtensionModule(throwingMessage, [
          "@veryfront/ext-auth-jwt",
        ]),
        false,
      );

      const throwingCause = new Error("ordinary failure");
      Object.defineProperty(throwingCause, "cause", {
        get() {
          throw new Error("not exposed");
        },
      });
      assertEquals(
        isMissingFirstPartyExtensionModule(throwingCause),
        false,
      );
    });
  });

  describe("importFirstPartyExtensionModule", () => {
    it("resolves an explicit parser-only workspace source entry", async () => {
      const module = await importFirstPartyExtensionModule<{
        BabelParseOnlyParser: new () => {
          parse(options: {
            code: string;
            filePath?: string;
          }): Promise<{ type: string }>;
        };
      }>(
        "ext-parser-babel",
        "@veryfront/ext-parser-babel",
        {
          sourceEntry: "parser-only",
          packageSubpath: "parser-only",
        },
      );

      const ast = await new module.BabelParseOnlyParser().parse({
        code: "export default {};",
        filePath: "veryfront.config.ts",
      });
      assertEquals(ast.type, "File");
    });

    it("names the installable package when neither source nor package resolves", async () => {
      const error = await assertRejects(() =>
        importFirstPartyExtensionModule(
          "ext-nonexistent-review-fixture",
          "@veryfront/ext-nonexistent-review-fixture",
        )
      );
      assertStringIncludes(
        error instanceof Error ? error.message : String(error),
        "install @veryfront/ext-nonexistent-review-fixture alongside veryfront",
      );
      assertEquals(error instanceof Error, true);
      assertEquals((error as Error).cause instanceof AggregateError, true);
      const [packageError, sourceError] = ((error as Error).cause as AggregateError).errors;
      Object.freeze(packageError);
      Object.freeze(sourceError);
      assertEquals(
        packageError instanceof Error &&
          packageError.message.includes("alongside veryfront"),
        false,
      );
    });

    it("ties a missing requested entry hint to the base package", async () => {
      const error = await assertRejects(() =>
        importFirstPartyExtensionModule(
          "ext-parser-babel",
          "@veryfront/ext-parser-babel",
          {
            sourceEntry: "not-exported-review-fixture",
            packageSubpath: "not-exported-review-fixture",
          },
        )
      );
      const message = error instanceof Error ? error.message : String(error);
      assertStringIncludes(
        message,
        "install or update @veryfront/ext-parser-babel alongside veryfront",
      );
      assertStringIncludes(
        message,
        '@veryfront/ext-parser-babel/not-exported-review-fixture"',
      );
    });

    it("requires matching source and package identities", async () => {
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-auth-jwt",
            "@veryfront/ext-parser-babel",
          ),
        TypeError,
      );
    });

    it("requires source and package entries to be aligned", async () => {
      for (
        const options of [
          { sourceEntry: "parser-only" },
          { packageSubpath: "parser-only" },
          { sourceEntry: "parser-only", packageSubpath: "index" },
        ]
      ) {
        await assertRejects(
          () =>
            importFirstPartyExtensionModule(
              "ext-parser-babel",
              "@veryfront/ext-parser-babel",
              options,
            ),
          TypeError,
        );
      }
    });

    it("normalizes explicitly undefined option fields to omission", async () => {
      for (
        const options of [
          { sourceEntry: undefined },
          { packageSubpath: undefined },
          { sourceEntry: undefined, packageSubpath: undefined },
        ]
      ) {
        const module = await importFirstPartyExtensionModule<{
          BabelCodeParser: new () => unknown;
        }>(
          "ext-parser-babel",
          "@veryfront/ext-parser-babel",
          options,
        );
        assertEquals(typeof module.BabelCodeParser, "function");
      }
    });

    it("descriptor-validates import options without invoking accessors", async () => {
      for (const options of [null, 42, "parser-only", [], () => undefined]) {
        await assertRejects(
          () =>
            importFirstPartyExtensionModule(
              "ext-parser-babel",
              "@veryfront/ext-parser-babel",
              options as never,
            ),
          TypeError,
        );
      }

      let getterCalls = 0;
      const accessorOptions = {};
      Object.defineProperty(accessorOptions, "sourceEntry", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "parser-only";
        },
      });
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            "@veryfront/ext-parser-babel",
            accessorOptions,
          ),
        TypeError,
      );
      assertEquals(getterCalls, 0);

      const nonEnumerableOptions = {};
      Object.defineProperty(nonEnumerableOptions, "sourceEntry", {
        value: "parser-only",
        enumerable: false,
      });
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            "@veryfront/ext-parser-babel",
            nonEnumerableOptions,
          ),
        TypeError,
      );

      for (
        const options of [
          { unknown: "parser-only" },
          { [Symbol("entry")]: "parser-only" },
          Object.create({ sourceEntry: "parser-only" }),
          new Proxy({}, {
            ownKeys() {
              throw new Error("not exposed");
            },
          }),
        ]
      ) {
        await assertRejects(
          () =>
            importFirstPartyExtensionModule(
              "ext-parser-babel",
              "@veryfront/ext-parser-babel",
              options as never,
            ),
          TypeError,
        );
      }

      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            "@veryfront/ext-parser-babel",
            revocable.proxy,
          ),
        TypeError,
      );
    });

    it("rejects non-primitive identifiers without coercing them", async () => {
      let coercions = 0;
      const stateful = {
        toString() {
          coercions += 1;
          return "ext-parser-babel";
        },
      };

      assertThrows(
        () => firstPartyExtensionSourceSpecifiers(stateful as never),
        TypeError,
      );
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            stateful as never,
            "@veryfront/ext-parser-babel",
          ),
        TypeError,
      );
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            stateful as never,
          ),
        TypeError,
      );
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            "@veryfront/ext-parser-babel",
            {
              sourceEntry: stateful as never,
              packageSubpath: stateful as never,
            },
          ),
        TypeError,
      );
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            "@veryfront/ext-parser-babel",
            {
              sourceEntry: stateful as never,
              packageSubpath: stateful as never,
            },
          ),
        TypeError,
      );
      assertEquals(coercions, 0);
    });

    it("rejects unsafe source entries and package subpaths", async () => {
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            "@veryfront/ext-parser-babel",
            { sourceEntry: "../index", packageSubpath: "../index" },
          ),
        TypeError,
      );
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-parser-babel",
            "@veryfront/ext-parser-babel",
            {
              sourceEntry: "/parser-only",
              packageSubpath: "/parser-only",
            },
          ),
        TypeError,
      );
      for (
        const [sourceDirectory, packageName] of [
          ["../ext-parser-babel", "@veryfront/ext-parser-babel"],
          ["ext-parser-babel/nested", "@veryfront/ext-parser-babel"],
          ["ext-parser-babel", "@veryfront/ext-parser-babel/parser-only"],
          ["ext-parser-babel", "https://example.com/ext-parser-babel"],
          ["ext-parser-babel", "@veryfront/ext-parser-babel?entry=parser"],
          ["ext-parser-babel", "@veryfront\\ext-parser-babel"],
        ] as const
      ) {
        await assertRejects(
          () =>
            importFirstPartyExtensionModule(
              sourceDirectory,
              packageName,
            ),
          TypeError,
        );
      }
    });
  });
});
