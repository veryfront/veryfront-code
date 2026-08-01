import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import extensionPackage from "../deno.json" with { type: "json" };
import { loadPlugin } from "./plugin-loader.ts";
import {
  bareName,
  TAILWIND_PLUGIN_ALLOWLIST,
  TAILWIND_PLUGIN_POLICY,
  TAILWIND_PLUGIN_POLICY_IDENTITY,
} from "./plugin-policy.ts";

const extensionImports: Readonly<Record<string, string>> = extensionPackage.imports;

describe("ext-css-tailwind local plugin policy", () => {
  it("pins every static plugin to its exact extension-owned npm dependency", () => {
    assertEquals(
      TAILWIND_PLUGIN_ALLOWLIST.length,
      TAILWIND_PLUGIN_POLICY.length,
    );

    for (const policy of TAILWIND_PLUGIN_POLICY) {
      assertEquals(
        extensionImports[policy.importSpecifier],
        policy.npmSpecifier,
      );
      assertEquals(
        TAILWIND_PLUGIN_ALLOWLIST.includes(bareName(policy.name)),
        true,
      );
    }
  });

  it("binds the complete pinned local registry into the policy identity", () => {
    assertEquals(JSON.parse(TAILWIND_PLUGIN_POLICY_IDENTITY), {
      schema: "veryfront.tailwind-plugin-policy.v3",
      resolution: "extension-owned-static-npm-imports",
      plugins: TAILWIND_PLUGIN_POLICY.map((entry) => ({ ...entry })).sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      ),
    });
  });

  it("returns each statically imported plugin for bare and exact specifiers", () => {
    for (const policy of TAILWIND_PLUGIN_POLICY) {
      const barePlugin = loadPlugin(policy.name);
      const pinnedPlugin = loadPlugin(`${policy.name}@${policy.version}`);
      assertEquals(barePlugin, pinnedPlugin);
      assertEquals(
        typeof barePlugin === "function" ||
          (typeof barePlugin === "object" && barePlugin !== null),
        true,
      );
    }
  });

  it("rejects unknown, malformed, and unpinned plugin specifiers", () => {
    for (
      const specifier of [
        "is-odd@3.0.1",
        "@tailwindcss/typography@latest",
        "https://example.test/plugin.js",
      ]
    ) {
      assertThrows(
        () => loadPlugin(specifier),
        Error,
        "not an audited ext-css-tailwind plugin",
      );
    }
  });

  it("performs no runtime network access or global shim injection", () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      throw new Error("local plugin loading must not fetch");
    }) as typeof fetch;
    try {
      const globalKeys = Reflect.ownKeys(globalThis);
      for (const name of TAILWIND_PLUGIN_ALLOWLIST) loadPlugin(name);
      assertEquals(fetchCalls, 0);
      assertEquals(Reflect.ownKeys(globalThis), globalKeys);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
