import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleInstallCommand, handleUninstallCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

function extractInstallArgs(args: ParsedArgs) {
  const target = typeof args.target === "string" ? args.target : undefined;
  return {
    target,
    global: Boolean(args.global),
    force: Boolean(args.force || args.f),
  };
}

function extractUninstallArgs(args: ParsedArgs) {
  const target = typeof args.target === "string" ? args.target : undefined;
  return {
    target,
    global: Boolean(args.global),
    force: Boolean(args.force || args.f),
  };
}

describe("commands/install/handler", () => {
  describe("handleInstallCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleInstallCommand, "function");
      assertEquals(handleInstallCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleInstallCommand.length, 1);
    });
  });

  describe("handleUninstallCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleUninstallCommand, "function");
      assertEquals(handleUninstallCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleUninstallCommand.length, 1);
    });
  });

  describe("install argument extraction", () => {
    it("parses --target as string value", () => {
      const result = extractInstallArgs({ _: ["install"], target: "/usr/local/bin" });
      assertEquals(result.target, "/usr/local/bin");
    });

    it("returns undefined for --target when not provided", () => {
      const result = extractInstallArgs({ _: ["install"] });
      assertEquals(result.target, undefined);
    });

    it("returns undefined for --target when value is boolean (flag without value)", () => {
      const result = extractInstallArgs({ _: ["install"], target: true });
      assertEquals(result.target, undefined);
    });

    it("returns undefined for --target when value is a number", () => {
      const result = extractInstallArgs({ _: ["install"], target: 42 });
      assertEquals(result.target, undefined);
    });

    it("parses --global flag", () => {
      assertEquals(extractInstallArgs({ _: ["install"], global: true }).global, true);
      assertEquals(extractInstallArgs({ _: ["install"], global: false }).global, false);
      assertEquals(extractInstallArgs({ _: ["install"] }).global, false);
    });

    it("parses --force flag", () => {
      assertEquals(extractInstallArgs({ _: ["install"], force: true }).force, true);
      assertEquals(extractInstallArgs({ _: ["install"], force: false }).force, false);
    });

    it("parses -f as alias for --force", () => {
      assertEquals(extractInstallArgs({ _: ["install"], f: true }).force, true);
    });

    it("force is true if either --force or -f is set", () => {
      assertEquals(
        extractInstallArgs({ _: ["install"], force: false, f: true }).force,
        true,
      );
      assertEquals(
        extractInstallArgs({ _: ["install"], force: true, f: false }).force,
        true,
      );
    });

    it("force is false when neither --force nor -f is set", () => {
      assertEquals(extractInstallArgs({ _: ["install"] }).force, false);
    });

    it("uses Boolean() coercion (truthy values enable flags)", () => {
      const globalArgs = { _: ["install"], global: "yes" } as unknown as ParsedArgs;
      const forceArgs = { _: ["install"], force: 1 } as unknown as ParsedArgs;
      assertEquals(extractInstallArgs(globalArgs).global, true);
      assertEquals(extractInstallArgs(forceArgs).force, true);
    });

    it("Boolean() coercion treats falsy values as false", () => {
      const zeroArgs = { _: ["install"], global: 0 } as unknown as ParsedArgs;
      const emptyArgs = { _: ["install"], global: "" } as unknown as ParsedArgs;
      const nullArgs = { _: ["install"], global: null } as unknown as ParsedArgs;
      assertEquals(extractInstallArgs(zeroArgs).global, false);
      assertEquals(extractInstallArgs(emptyArgs).global, false);
      assertEquals(extractInstallArgs(nullArgs).global, false);
    });

    it("does not use -y as force alias (unlike clean/lock)", () => {
      const result = extractInstallArgs({ _: ["install"], y: true });
      assertEquals(result.force, false);
    });
  });

  describe("uninstall argument extraction", () => {
    it("uses same parsing pattern as install", () => {
      const installResult = extractInstallArgs({
        _: ["install"],
        target: "/usr/local/bin",
        global: true,
        force: true,
      });
      const uninstallResult = extractUninstallArgs({
        _: ["uninstall"],
        target: "/usr/local/bin",
        global: true,
        force: true,
      });

      assertEquals(installResult.target, uninstallResult.target);
      assertEquals(installResult.global, uninstallResult.global);
      assertEquals(installResult.force, uninstallResult.force);
    });

    it("parses --target as string value", () => {
      const result = extractUninstallArgs({ _: ["uninstall"], target: "/usr/local/bin" });
      assertEquals(result.target, "/usr/local/bin");
    });

    it("returns undefined for --target when not provided", () => {
      const result = extractUninstallArgs({ _: ["uninstall"] });
      assertEquals(result.target, undefined);
    });

    it("parses --global flag", () => {
      assertEquals(extractUninstallArgs({ _: ["uninstall"], global: true }).global, true);
      assertEquals(extractUninstallArgs({ _: ["uninstall"] }).global, false);
    });

    it("parses -f as alias for --force", () => {
      assertEquals(extractUninstallArgs({ _: ["uninstall"], f: true }).force, true);
    });
  });
});
