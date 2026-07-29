import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for CLI Error Boundary Middleware
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertMatch } from "#veryfront/testing/assert";
import { formatCLIError } from "./cli-error-boundary.ts";
import { VeryfrontError } from "../types.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";

describe("cli-error-boundary", () => {
  describe("formatCLIError", () => {
    it("shows an actionable default without diagnostic metadata", () => {
      const error = CONFIG_NOT_FOUND.create({
        detail: "Missing veryfront.config.ts in project root",
      });

      const output = formatCLIError(error, { color: false });

      assertMatch(output, /✗ Missing veryfront\.config\.ts in project root/);
      assertMatch(output, /Missing veryfront.config.ts/);
      assertMatch(output, /vf init/);
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
  });
});
