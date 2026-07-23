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

  it("rejects unsafe source-directory input before constructing specifiers", () => {
    assertThrows(
      () => firstPartyExtensionSourceSpecifiers("../private-extension"),
      TypeError,
      "source directory is invalid",
    );
    assertThrows(
      () => firstPartyExtensionSourceSpecifiers(null as unknown as string),
      TypeError,
      "source directory is invalid",
    );
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
        isMissingFirstPartyExtensionModule(ownError, ["extensions/ext-auth-jwt/src/index"]),
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

      const lookalikeError = new Error(
        "Cannot find package '@veryfront/ext-auth-jwt-malicious' imported from /app/x.js",
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(lookalikeError, ["@veryfront/ext-auth-jwt"]),
        false,
      );
    });

    it("classifies by the stable Node error code, not just message text", () => {
      // Node attaches ERR_MODULE_NOT_FOUND; the message wording is not stable
      // across releases, so the code must be sufficient on its own.
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

    it("fails closed when an anchored missing-module error has no specifier", () => {
      const ambiguous = Object.assign(new Error("Module resolution failed"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
      assertEquals(
        isMissingFirstPartyExtensionModule(ambiguous, ["@veryfront/ext-auth-jwt"]),
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
    });

    it("fails closed for malformed or hostile anchor collections", () => {
      const missing = new Error(
        "Cannot find package '@veryfront/ext-auth-jwt' imported from /app/x.js",
      );
      const hostile = new Proxy([], {
        get() {
          throw new Error("private-anchor-state");
        },
      });

      assertEquals(
        isMissingFirstPartyExtensionModule(missing, hostile as string[]),
        false,
      );
      assertEquals(
        isMissingFirstPartyExtensionModule(
          missing,
          Array.from({ length: 129 }, () => "@veryfront/ext-auth-jwt"),
        ),
        false,
      );

      let lengthReads = 0;
      const stateful = new Proxy(["@veryfront/ext-auth-jwt"], {
        get(target, property, receiver) {
          if (property === "length") {
            lengthReads += 1;
            if (lengthReads > 1) throw new Error("private-second-anchor-length-read");
          }
          return Reflect.get(target, property, receiver);
        },
      });
      assertEquals(isMissingFirstPartyExtensionModule(missing, stateful), true);
      assertEquals(lengthReads, 1);
    });

    it("fails closed for a revoked error proxy", () => {
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();

      assertEquals(
        isMissingFirstPartyExtensionModule(revoked.proxy),
        false,
      );
    });
  });

  describe("importFirstPartyExtensionModule", () => {
    it("rejects malformed package names at the import boundary", async () => {
      await assertRejects(
        () =>
          importFirstPartyExtensionModule(
            "ext-auth-jwt",
            null as unknown as string,
          ),
        TypeError,
        "package name is invalid",
      );
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
        "Install @veryfront/ext-nonexistent-review-fixture alongside Veryfront",
      );
      assertEquals((error as { slug?: string }).slug, "missing-extension");
      assertEquals((error as { cause?: unknown }).cause, undefined);
      assertEquals(String(error).includes("../../extensions/"), false);
    });
  });
});
