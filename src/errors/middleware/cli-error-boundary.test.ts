import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for CLI Error Boundary Middleware
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assert, assertEquals, assertMatch } from "#veryfront/testing/assert";
import { formatCLIError } from "./cli-error-boundary.ts";
import { VeryfrontError } from "../types.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";
import { ERROR_OUTPUT_MAX_LENGTH_CHARS } from "../safe-diagnostics.ts";

describe("cli-error-boundary", () => {
  describe("formatCLIError", () => {
    it("shows an actionable default without diagnostic metadata", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing veryfront.config.ts in project root",
      });

      const output = formatCLIError(error, { color: false });

      assertMatch(output, /✗ Missing veryfront\.config\.ts in project root/);
      assertMatch(output, /Missing veryfront.config.ts/);
      assertMatch(output, /Create veryfront\.config\.(?:js|ts|mjs)/);
      assertEquals(output.includes("[config-not-found]"), false);
      assertEquals(output.includes("Docs:"), false);
      assertEquals(output.includes("Stack trace:"), false);
      assertEquals(output.includes("💡"), false);
      assertEquals(output.includes("📚"), false);
    });

    it("uses the original message for plain errors", () => {
      const error = new Error("Something went wrong");

      const output = formatCLIError(error, { color: false });

      assertEquals(output, "\n✗ Something went wrong\n  Run with --verbose for details\n");
      assertEquals(output.includes("Check logs for more details"), false);
    });

    it("includes diagnostics only in verbose output", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing veryfront.config.ts in project root",
        cause: new Error("Original failure"),
      });
      Object.defineProperty(error, "stack", {
        configurable: true,
        value: "VeryfrontError: failure\n    at command.ts:1:1",
        writable: true,
      });

      const output = formatCLIError(error, { color: false, verbose: true });

      assertMatch(output, /Code: config-not-found/);
      assertMatch(output, /Docs: https:\/\/veryfront\.com\/docs\/errors\/config-not-found/);
      assertMatch(output, /Stack trace:/);
    });

    it("falls back to the error title when detail is absent", () => {
      const error = new VeryfrontError("Test", {
        slug: "test",
        category: "GENERAL",
        status: 500,
        title: "Test title",
      });

      assertEquals(formatCLIError(error, { color: false }), "\n✗ Test title\n");
    });

    it("honors explicit color control", () => {
      const plain = formatCLIError(new Error("Failure"), { color: false });
      const colored = formatCLIError(new Error("Failure"), { color: true });

      assertEquals(plain.includes("\x1b["), false);
      assertEquals(colored.includes("\x1b["), true);
    });

    it("honors NO_COLOR when color control is implicit", () => {
      const originalNoColor = Deno.env.get("NO_COLOR");
      const originalForceColor = Deno.env.get("FORCE_COLOR");
      const originalIsTerminal = Deno.stdout.isTerminal;

      try {
        Deno.env.set("NO_COLOR", "1");
        Deno.env.delete("FORCE_COLOR");
        Object.defineProperty(Deno.stdout, "isTerminal", {
          configurable: true,
          value: () => true,
        });

        const output = formatCLIError(new Error("Failure"));

        assertEquals(output.includes("\x1b["), false);
      } finally {
        if (originalNoColor === undefined) Deno.env.delete("NO_COLOR");
        else Deno.env.set("NO_COLOR", originalNoColor);
        if (originalForceColor === undefined) Deno.env.delete("FORCE_COLOR");
        else Deno.env.set("FORCE_COLOR", originalForceColor);
        Object.defineProperty(Deno.stdout, "isTerminal", {
          configurable: true,
          value: originalIsTerminal,
        });
      }
    });

    it("should fail closed for proxies around real errors and redact diagnostics", () => {
      const source = new VeryfrontError("secret", {
        slug: "custom",
        category: "GENERAL",
        status: 500,
        title: "Authorization: Bearer title-secret",
        detail: "apiKey=detail-secret cookie=cookie-secret",
      });
      const hostile = new Proxy(source, {
        get(target, property, receiver) {
          if (property === "slug") throw new Error("blocked");
          return Reflect.get(target, property, receiver);
        },
      });

      const output = formatCLIError(hostile);

      assertEquals(output, "\n✗ Unknown error\n  Run with --verbose for details\n");
      for (const secret of ["title-secret", "detail-secret", "cookie-secret"]) {
        assertEquals(output.includes(secret), false);
      }
    });

    it("should neutralize terminal and line injection in untrusted fields", () => {
      const injection = "\x1b]2;owned\x07\x1b[2J\nFAKE SUCCESS";
      const error = new VeryfrontError(`message ${injection}`, {
        slug: `custom-${injection}`,
        category: "GENERAL",
        status: 500,
        title: `title ${injection}`,
        detail: `detail ${injection}`,
        suggestion: `suggestion ${injection}`,
      });

      const output = formatCLIError(error, { color: false, verbose: true });

      for (const forbidden of ["\x1b]2;owned", "\x1b[2J", "\x07", "\nFAKE SUCCESS"]) {
        assertEquals(output.includes(forbidden), false);
      }
    });

    it("should bound actual CLI output for oversized diagnostics", () => {
      const error = new VeryfrontError("Vendor error", {
        slug: "vendor/path?token=slug-secret#fragment",
        category: "GENERAL",
        status: 500,
        title: "t".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
        detail: "d".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
        suggestion: "s".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2),
      });
      error.stack = `Error: vendor\n${
        "    at frame (file:///app/main.ts:1:1)\n".repeat(
          ERROR_OUTPUT_MAX_LENGTH_CHARS,
        )
      }`;

      const output = formatCLIError(error, { color: false, verbose: true });

      assert(output.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS);
      assert(output.includes("...[truncated]"));
      assertEquals(output.includes("slug-secret"), false);
    });
  });
});
