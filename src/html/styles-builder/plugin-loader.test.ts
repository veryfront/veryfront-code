import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { loadModuleFromEsmSh, loadPlugin } from "./plugin-loader.ts";
import {
  bareName,
  PACKAGE_SPEC_RE,
  TAILWIND_PLUGIN_ALLOWLIST,
} from "./tailwind-plugin-allowlist.ts";

describe("styles-builder/plugin-loader", () => {
  it("throws when esm.sh stub request fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() => Promise.resolve(new Response("upstream failure", { status: 503 }))) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("@tailwindcss/typography@0.5.19"),
        Error,
        "Failed to fetch stub: 503",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when esm.sh stub has no bundle path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() =>
        Promise.resolve(new Response(`export * from "react";`, { status: 200 }))) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("@tailwindcss/forms@0.5.11"),
        Error,
        "Could not find bundle path in esm.sh response",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when esm.sh bundle fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(`export * from "/v1/bad-package.bundle.mjs";`, { status: 200 }),
        );
      }
      return Promise.resolve(new Response("bundle failure", { status: 500 }));
    }) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("tailwindcss-animate@1.0.7"),
        Error,
        "Failed to fetch bundle: 500",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when esm.sh bundle responds with HTML", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(`export * from "/v1/html-package.bundle.mjs";`, { status: 200 }),
        );
      }
      return Promise.resolve(new Response("<html>not javascript</html>", { status: 200 }));
    }) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("@tailwindcss/aspect-ratio@0.4.2"),
        Error,
        "returned HTML instead of JavaScript",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns cached plugin error without refetching", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCallCount = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      fetchCallCount++;
      return Promise.reject(new Error("fetch should not be called"));
    }) as typeof fetch;

    try {
      const pluginCache = new Map<string, unknown>();
      const pluginErrors = new Map<string, Error>();
      pluginErrors.set(
        "@tailwindcss/typography",
        new VeryfrontError("cached plugin load failure", {
          slug: "network-error",
          category: "SERVER",
          status: 502,
          title: "Network operation failed",
          detail: "cached plugin load failure",
        }),
      );

      await assertRejects(
        () => loadPlugin("@tailwindcss/typography", pluginCache, pluginErrors),
        Error,
        "cached plugin load failure",
      );
      assertEquals(fetchCallCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves structured upstream errors when plugin loading fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() => Promise.resolve(new Response("upstream failure", { status: 503 }))) as typeof fetch;

    try {
      try {
        await loadPlugin("@tailwindcss/typography@0.5.19", new Map(), new Map());
        throw new Error("Expected loadPlugin to throw");
      } catch (error) {
        assertEquals(error instanceof VeryfrontError, true);
        if (!(error instanceof VeryfrontError)) throw error;

        assertEquals(error.slug, "network-error");
        assertEquals(error.status, 502);
        assertEquals(
          error.message.includes('Failed to load plugin "@tailwindcss/typography@0.5.19"'),
          true,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses plugin cache on subsequent successful loads", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCallCount = 0;
    globalThis.fetch = (() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return Promise.resolve(
          new Response(`export * from "/v1/good-plugin.bundle.mjs";`, { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(`export default { id: "good-plugin", handler() {} };`, { status: 200 }),
      );
    }) as typeof fetch;

    try {
      const pluginCache = new Map<string, unknown>();
      const pluginErrors = new Map<string, Error>();

      const first = await loadPlugin(
        "@tailwindcss/typography@0.5.19",
        pluginCache,
        pluginErrors,
      );
      const second = await loadPlugin(
        "@tailwindcss/typography@0.5.19",
        pluginCache,
        pluginErrors,
      );

      assertEquals(typeof first, "object");
      assertEquals(second === first, true);
      assertEquals(fetchCallCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("styles-builder/plugin-loader allowlist enforcement (VULN-FS-1)", () => {
  // All tests in this block must reject BEFORE any fetch happens. Install a
  // fetch stub that fails the test if called.
  function withFailFastFetch(run: () => Promise<void>): Promise<void> {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      called = true;
      return Promise.reject(new Error("fetch must not be called for rejected specs"));
    }) as typeof fetch;
    return run().finally(() => {
      globalThis.fetch = originalFetch;
      if (called) {
        throw new Error(
          "Allowlist enforcement leaked a fetch: rejection must happen before network I/O",
        );
      }
    });
  }

  const rejectionCases: Array<[string, string]> = [
    ["non-allowlisted package", "evil-package@1.0.0"],
    ["path-traversal specifier", "../../etc/passwd"],
    ["URL-like specifier", "https://evil.com/x"],
    ["shell-injection specifier", "pkg;evil"],
    ["NUL-byte specifier", "pkg\0"],
    ["empty string", ""],
    ["unicode homoglyph (fullwidth @)", "\uFF20tailwindcss/typography"],
    ["allowlisted-name with extra suffix", "@tailwindcss/typography-evil"],
    ["leading whitespace", " @tailwindcss/typography"],
    ["trailing whitespace", "@tailwindcss/typography "],
    ["uppercase variant of allowlisted scope", "@TAILWINDCSS/typography"],
    ["parent-directory jump in bare name", "foo/../bar"],
    ["absolute path", "/etc/passwd"],
    ["backslash path", "evil\\pkg"],
  ];

  for (const [label, spec] of rejectionCases) {
    it(`loadModuleFromEsmSh rejects ${label}`, () => {
      return withFailFastFetch(async () => {
        await assertRejects(
          () => loadModuleFromEsmSh(spec),
          Error,
        );
      });
    });

    it(`loadPlugin rejects ${label}`, () => {
      return withFailFastFetch(async () => {
        await assertRejects(
          () => loadPlugin(spec, new Map(), new Map()),
          Error,
        );
      });
    });
  }

  it("loadModuleFromEsmSh error mentions invalid specifier or allowlist", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("must not fetch");
    }) as typeof fetch;
    try {
      const err = await assertRejects(
        () => loadModuleFromEsmSh("evil-package@1.0.0"),
        Error,
      ) as Error;
      const combined = err.message;
      const mentionsAllowlist = combined.includes("allowlist") ||
        combined.includes("Invalid Tailwind plugin specifier");
      assert(
        mentionsAllowlist,
        `Expected error to mention allowlist or invalid specifier, got: ${combined}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loadPlugin rejects an unknown package id (not on allowlist)", async () => {
    await assertRejects(
      () => loadPlugin("definitely-not-an-allowed-plugin", new Map(), new Map()),
      Error,
    );
  });
});

describe("styles-builder/plugin-loader allowlist positive cases", () => {
  // Verify each allowlisted package is accepted past the guard by letting the
  // fetch fail downstream. The acceptance is proven by the *specific* error
  // message: if the guard rejected, we would never see a fetch error.
  for (const pkg of TAILWIND_PLUGIN_ALLOWLIST) {
    it(`accepts ${pkg} bare name (passes allowlist guard)`, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response("downstream failure", { status: 503 }),
        )) as typeof fetch;
      try {
        const err = await assertRejects(
          () => loadModuleFromEsmSh(pkg),
          Error,
        ) as Error;
        assertStringIncludes(err.message, "Failed to fetch stub: 503");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it(`accepts ${pkg}@1.2.3 versioned spec (passes allowlist guard)`, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response("downstream failure", { status: 503 }),
        )) as typeof fetch;
      try {
        const err = await assertRejects(
          () => loadModuleFromEsmSh(`${pkg}@1.2.3`),
          Error,
        ) as Error;
        assertStringIncludes(err.message, "Failed to fetch stub: 503");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

describe("styles-builder/plugin-loader bareName", () => {
  it("returns an unscoped name unchanged", () => {
    assertEquals(bareName("pkg"), "pkg");
  });

  it("strips @version from an unscoped name", () => {
    assertEquals(bareName("pkg@1"), "pkg");
    assertEquals(bareName("pkg@1.2.3-rc.4"), "pkg");
  });

  it("returns a scoped name unchanged", () => {
    assertEquals(bareName("@scope/pkg"), "@scope/pkg");
  });

  it("strips @version from a scoped name", () => {
    assertEquals(bareName("@scope/pkg@1.0.0"), "@scope/pkg");
    assertEquals(bareName("@tailwindcss/typography@0.5.19"), "@tailwindcss/typography");
  });
});

describe("styles-builder/plugin-loader PACKAGE_SPEC_RE", () => {
  const rejects: Array<[string, string]> = [
    ["empty string", ""],
    ["URL-like", "https://evil.com/x"],
    ["path traversal", "../../etc/passwd"],
    ["shell-injection", "pkg;evil"],
    ["NUL byte", "pkg\0"],
    ["fullwidth @ homoglyph", "\uFF20tailwindcss/typography"],
    ["leading whitespace", " pkg"],
    ["trailing whitespace", "pkg "],
    ["internal whitespace", "pk g"],
    ["absolute path", "/etc/passwd"],
    ["backslash", "evil\\pkg"],
    ["scope without name", "@scope/"],
    ["name starting with dot", ".hidden"],
    ["name starting with dash", "-pkg"],
  ];

  for (const [label, spec] of rejects) {
    it(`rejects ${label}`, () => {
      assertEquals(
        PACKAGE_SPEC_RE.test(spec),
        false,
        `expected rejection for ${JSON.stringify(spec)}`,
      );
    });
  }

  const accepts = [
    "pkg",
    "pkg@1",
    "pkg@1.2.3",
    "pkg@1.2.3-rc.4",
    "pkg@1.2.3+build.5",
    "@scope/pkg",
    "@scope/pkg@1.0.0",
    "@tailwindcss/typography",
    "@tailwindcss/typography@0.5.19",
    "tailwindcss-animate",
    "tailwindcss-animate@1.0.7",
  ];

  for (const spec of accepts) {
    it(`accepts ${spec}`, () => {
      assertEquals(
        PACKAGE_SPEC_RE.test(spec),
        true,
        `expected acceptance for ${JSON.stringify(spec)}`,
      );
    });
  }
});
