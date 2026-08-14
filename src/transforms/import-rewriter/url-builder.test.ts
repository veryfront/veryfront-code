import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  addEsmShDeps,
  appendDependencyPinningKey,
  appendDependencyPinningPathKey,
  appendSameOriginDependencyPinningPathKey,
  appendSameOriginSSRDependencyPinningKey,
  appendSameOriginSSRDependencyPinningPathKey,
  buildCrossProjectUrl,
  buildEsmShUrl,
  buildModuleServerUrl,
  buildPinnedEsmShUrl,
  buildReactUrl,
  buildVeryfrontModuleUrl,
  extractDependencyPinningPathKey,
  getReactImportMap,
  isEsmShUrl,
  normalizeExtension,
  parseEsmShUrl,
} from "./url-builder.ts";

describe("transforms/import-rewriter/url-builder", () => {
  describe("appendDependencyPinningKey", () => {
    it("appends and encodes an enabled dependency snapshot key", () => {
      assertEquals(
        appendDependencyPinningKey(
          "/_vf_modules/components/Button.js?ssr=true",
          "on:snapshot-a",
        ),
        "/_vf_modules/components/Button.js?ssr=true&pins=on%3Asnapshot-a",
      );
    });

    it("replaces a stale key and preserves the fragment", () => {
      assertEquals(
        appendDependencyPinningKey(
          "/_vf_modules/components/Button.js?pins=on%3Astale&v=source#default",
          "on:snapshot-a",
        ),
        "/_vf_modules/components/Button.js?pins=on%3Asnapshot-a&v=source#default",
      );
    });

    it("preserves the historical URL shape when pinning is off", () => {
      assertEquals(
        appendDependencyPinningKey("/_vf_modules/components/Button.js", "off"),
        "/_vf_modules/components/Button.js",
      );
    });
  });

  describe("dependency pinning path keys", () => {
    it("canonicalizes same-origin absolute and protocol-relative module URLs", () => {
      assertEquals(
        appendSameOriginDependencyPinningPathKey(
          "https://app.example/_vf_modules/components/Absolute.js?pins=on%3Astale#entry",
          "on:snapshot-a",
          "https://app.example",
        ),
        "/_vf_modules/_pins/on%3Asnapshot-a/components/Absolute.js#entry",
      );
      assertEquals(
        appendSameOriginDependencyPinningPathKey(
          "//app.example/_vf_modules/components/Protocol.js",
          "on:snapshot-a",
          "https://app.example",
        ),
        "/_vf_modules/_pins/on%3Asnapshot-a/components/Protocol.js",
      );
      assertEquals(
        appendSameOriginDependencyPinningPathKey(
          "https://cdn.example/_vf_modules/components/Foreign.js",
          "on:snapshot-a",
          "https://app.example",
        ),
        "https://cdn.example/_vf_modules/components/Foreign.js",
      );
      assertEquals(
        appendSameOriginDependencyPinningPathKey(
          "https://app.example/_vf_modules/components/FlagOff.js",
          "off",
          "https://app.example",
        ),
        "https://app.example/_vf_modules/components/FlagOff.js",
      );
    });

    it("preserves trailing-slash module prefix targets", () => {
      assertEquals(
        appendDependencyPinningPathKey(
          "/_vf_modules/components/",
          "on:snapshot-a",
        ),
        "/_vf_modules/_pins/on%3Asnapshot-a/components/",
      );
    });

    it("supports absolute module URLs and removes ambiguous query tokens", () => {
      assertEquals(
        appendDependencyPinningPathKey(
          "HTTPS://modules.example/_vf_modules/components/Button.js?ssr=true&pins=on%3Astale#default",
          "on:snapshot-a",
        ),
        "HTTPS://modules.example/_vf_modules/_pins/on%3Asnapshot-a/components/Button.js?ssr=true#default",
      );
      assertEquals(
        appendDependencyPinningPathKey(
          "/_vf_modules/_pins/on%3Astale/components/Button.js",
          "on:snapshot-a",
        ),
        "/_vf_modules/_pins/on%3Asnapshot-a/components/Button.js",
      );
      assertEquals(
        appendDependencyPinningPathKey(
          "/_vf_modules/_pins/project-file.js",
          "on:snapshot-a",
        ),
        "/_vf_modules/_pins/on%3Asnapshot-a/_pins/project-file.js",
      );
    });

    it("adds query pinning to same-origin SSR module URLs for fetchable imports", () => {
      assertEquals(
        appendSameOriginSSRDependencyPinningKey(
          "https://app.example/_vf_modules/components/Button.js?pins=on%3Astale#default",
          "on:snapshot-a",
          "https://app.example",
        ),
        "https://app.example/_vf_modules/components/Button.js?pins=on%3Asnapshot-a&ssr=true#default",
      );
      assertEquals(
        appendSameOriginSSRDependencyPinningKey(
          "//app.example/_vf_modules/components/Protocol.js?debug=1",
          "on:snapshot-a",
          "https://app.example",
        ),
        "https://app.example/_vf_modules/components/Protocol.js?debug=1&pins=on%3Asnapshot-a&ssr=true",
      );
      assertEquals(
        appendSameOriginSSRDependencyPinningKey(
          "https://cdn.example/_vf_modules/components/Button.js",
          "on:snapshot-a",
          "https://app.example",
        ),
        "https://cdn.example/_vf_modules/components/Button.js",
      );
    });

    it("canonicalizes same-origin SSR module-server URLs to snapshot paths", () => {
      assertEquals(
        appendSameOriginSSRDependencyPinningPathKey(
          "https://app.example/_vf_modules/components/Button.js?pins=on%3Astale#default",
          "on:snapshot-a",
          "https://app.example",
        ),
        "/_vf_modules/_pins/on%3Asnapshot-a/components/Button.js?ssr=true#default",
      );
    });

    it("preserves flag-off and non-module targets", () => {
      assertEquals(
        appendDependencyPinningPathKey("/_vf_modules/components/", "off"),
        "/_vf_modules/components/",
      );
      assertEquals(
        appendDependencyPinningPathKey("https://cdn.example/components/", "on:snapshot-a"),
        "https://cdn.example/components/",
      );
      assertEquals(
        appendDependencyPinningPathKey(
          "/_veryfront/modules/legacy/",
          "on:snapshot-a",
        ),
        "/_veryfront/modules/legacy/",
      );
    });

    it("extracts and normalizes a concrete browser-resolved prefix URL", () => {
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/on%3Asnapshot-a/components/Button.js",
        ),
        {
          pathname: "/_vf_modules/components/Button.js",
          cacheKey: "on:snapshot-a",
          found: true,
          malformed: false,
        },
      );
    });

    it("distinguishes ordinary _pins source paths from valid transports", () => {
      assertEquals(
        extractDependencyPinningPathKey("/_vf_modules/_pins/not-terminated"),
        {
          pathname: "/_vf_modules/_pins/not-terminated",
          found: false,
          malformed: false,
        },
      );
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/project-dir/page.js",
        ),
        {
          pathname: "/_vf_modules/_pins/project-dir/page.js",
          found: false,
          malformed: false,
        },
      );
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/on%3Aa/_pins/project-dir/page.js",
        ).malformed,
        true,
      );
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/on%3Asnapshot-a",
        ).malformed,
        true,
      );
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/on%3Aa/_pins/on%3Ab/page.js",
        ).malformed,
        true,
      );
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/on%3Aa/_pins/not-terminated/page.js",
        ).malformed,
        true,
      );
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/on%3Aa/_pins/%E0%A4%A/page.js",
        ).malformed,
        true,
      );
      assertEquals(
        extractDependencyPinningPathKey(
          "/_vf_modules/_pins/%E0%A4%A/page.js",
        ).malformed,
        true,
      );
    });
  });

  describe("buildEsmShUrl", () => {
    it("should build basic URL with package name", () => {
      assertEquals(buildEsmShUrl("lodash"), "https://esm.sh/lodash?target=es2022");
    });

    it("should include version", () => {
      assertEquals(buildEsmShUrl("react", "19.1.1"), "https://esm.sh/react@19.1.1?target=es2022");
    });

    it("should include subpath", () => {
      assertEquals(
        buildEsmShUrl("react", "19.1.1", "/jsx-runtime"),
        "https://esm.sh/react@19.1.1/jsx-runtime?target=es2022",
      );
    });

    it("should include external packages", () => {
      const url = buildEsmShUrl("react-dom", "19.1.1", undefined, { external: ["react"] });
      assertEquals(url.includes("external=react"), true);
    });

    it("should include deps", () => {
      const url = buildEsmShUrl("react", "19.1.1", undefined, { deps: { csstype: "3.2.3" } });
      assertEquals(url.includes("deps=csstype@3.2.3"), true);
    });

    it("should use custom target", () => {
      const url = buildEsmShUrl("lodash", undefined, undefined, { target: "es2020" });
      assertEquals(url.includes("target=es2020"), true);
    });
  });

  describe("buildReactUrl", () => {
    it("should build react URL with csstype dep", () => {
      const url = buildReactUrl("react", "19.1.1");
      assertEquals(url.includes("react@19.1.1"), true);
      assertEquals(url.includes("deps=csstype@"), true);
    });

    it("should add external=react when external flag is true", () => {
      const url = buildReactUrl("react-dom", "19.1.1", undefined, true);
      assertEquals(url.includes("external=react"), true);
    });

    it("should not add external when flag is false", () => {
      const url = buildReactUrl("react", "19.1.1", undefined, false);
      assertEquals(url.includes("external="), false);
    });
  });

  describe("getReactImportMap", () => {
    it("should return map with react entries", () => {
      const map = getReactImportMap("19.1.1");
      const keys = [
        "react",
        "react-dom",
        "react-dom/client",
        "react-dom/server",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react/",
        "react-dom/",
      ] as const;

      for (const key of keys) {
        assertEquals(typeof map[key], "string");
      }

      assertEquals(map["react/"]?.endsWith("/"), true);
      assertEquals(map["react-dom/"]?.endsWith("/"), true);
      assertEquals(map["react-dom/"]?.includes("&external=react"), true);
    });
  });

  describe("buildModuleServerUrl", () => {
    it("should join base and path", () => {
      assertEquals(
        buildModuleServerUrl("http://localhost:3000", "/pages/index.js"),
        "http://localhost:3000/pages/index.js",
      );
    });

    it("should normalize trailing slash on base", () => {
      assertEquals(
        buildModuleServerUrl("http://localhost:3000/", "pages/index.js"),
        "http://localhost:3000/pages/index.js",
      );
    });

    it("should add leading slash to path if missing", () => {
      assertEquals(
        buildModuleServerUrl("http://localhost:3000", "pages/index.js"),
        "http://localhost:3000/pages/index.js",
      );
    });
  });

  describe("buildCrossProjectUrl", () => {
    it("should build cross-project URL with version", () => {
      assertEquals(
        buildCrossProjectUrl("my-project", "1.0.0", "components/Button.tsx"),
        "/_vf_modules/_cross/my-project@1.0.0/@/components/Button.tsx",
      );
    });

    it("should omit version when latest", () => {
      assertEquals(
        buildCrossProjectUrl("my-project", "latest", "lib/utils.tsx"),
        "/_vf_modules/_cross/my-project/@/lib/utils.tsx",
      );
    });

    it("should omit version when null", () => {
      assertEquals(
        buildCrossProjectUrl("my-project", null, "lib/utils.tsx"),
        "/_vf_modules/_cross/my-project/@/lib/utils.tsx",
      );
    });

    it("should add .tsx extension if no known extension", () => {
      assertEquals(
        buildCrossProjectUrl("proj", "1.0.0", "components/Button"),
        "/_vf_modules/_cross/proj@1.0.0/@/components/Button.tsx",
      );
    });
  });

  describe("buildVeryfrontModuleUrl", () => {
    it("should normalize .ts to .js", () => {
      assertEquals(
        buildVeryfrontModuleUrl("utils/helper.ts"),
        "/_vf_modules/_veryfront/utils/helper.js",
      );
    });

    it("should normalize .tsx to .js", () => {
      assertEquals(
        buildVeryfrontModuleUrl("components/Button.tsx"),
        "/_vf_modules/_veryfront/components/Button.js",
      );
    });

    it("should keep .js as-is", () => {
      assertEquals(buildVeryfrontModuleUrl("lib/main.js"), "/_vf_modules/_veryfront/lib/main.js");
    });
  });

  describe("normalizeExtension", () => {
    it("should convert .tsx to .js", () => {
      assertEquals(normalizeExtension("file.tsx"), "file.js");
    });

    it("should convert .ts to .js", () => {
      assertEquals(normalizeExtension("file.ts"), "file.js");
    });

    it("should convert .jsx to .js", () => {
      assertEquals(normalizeExtension("file.jsx"), "file.js");
    });

    it("should convert .mdx to .js", () => {
      assertEquals(normalizeExtension("file.mdx"), "file.js");
    });

    it("should remove extension when option set", () => {
      assertEquals(normalizeExtension("file.tsx", { removeExtension: true }), "file");
    });

    it("should use captured replace after String.replace poisoning", () => {
      const originalReplace = Object.getOwnPropertyDescriptor(String.prototype, "replace")!;
      let poisonCalls = 0;
      try {
        Object.defineProperty(String.prototype, "replace", {
          ...originalReplace,
          value() {
            poisonCalls += 1;
            throw new Error("poisoned String.prototype.replace");
          },
        });

        assertEquals(normalizeExtension("components/Card.tsx"), "components/Card.js");
        assertEquals(
          normalizeExtension("components/Card.tsx", { removeExtension: true }),
          "components/Card",
        );
        assertEquals(poisonCalls, 0);
      } finally {
        Object.defineProperty(String.prototype, "replace", originalReplace);
      }
    });

    it("should use captured replace after RegExp Symbol.replace poisoning", () => {
      const originalReplace = Object.getOwnPropertyDescriptor(RegExp.prototype, Symbol.replace)!;
      let poisonCalls = 0;
      try {
        Object.defineProperty(RegExp.prototype, Symbol.replace, {
          ...originalReplace,
          value() {
            poisonCalls += 1;
            throw new Error("poisoned RegExp.prototype[Symbol.replace]");
          },
        });

        assertEquals(normalizeExtension("components/Card.tsx"), "components/Card.js");
        assertEquals(
          normalizeExtension("components/Card.tsx", { removeExtension: true }),
          "components/Card",
        );
        assertEquals(poisonCalls, 0);
      } finally {
        Object.defineProperty(RegExp.prototype, Symbol.replace, originalReplace);
      }
    });

    it("should keep .js unchanged", () => {
      assertEquals(normalizeExtension("file.js"), "file.js");
    });
  });

  describe("isEsmShUrl", () => {
    it("should return true for https esm.sh URLs", () => {
      assertEquals(isEsmShUrl("https://esm.sh/react"), true);
    });

    it("should return true for http esm.sh URLs", () => {
      assertEquals(isEsmShUrl("http://esm.sh/lodash"), true);
    });

    it("should return false for other URLs", () => {
      assertEquals(isEsmShUrl("https://cdn.example.com/lib.js"), false);
    });

    it("should return false for non-URLs", () => {
      assertEquals(isEsmShUrl("react"), false);
    });
  });

  describe("addEsmShDeps", () => {
    it("should add deps to esm.sh URL without params", () => {
      assertEquals(
        addEsmShDeps("https://esm.sh/lodash", "19.1.1"),
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
    });

    it("should skip non-esm.sh URLs", () => {
      assertEquals(addEsmShDeps("https://cdn.com/lib.js", "19.1.1"), "https://cdn.com/lib.js");
    });

    it("should skip React packages", () => {
      assertEquals(
        addEsmShDeps("https://esm.sh/react@19.1.1", "19.1.1"),
        "https://esm.sh/react@19.1.1",
      );
    });

    it("should skip URLs with existing query params", () => {
      assertEquals(
        addEsmShDeps("https://esm.sh/lodash?target=es2022", "19.1.1"),
        "https://esm.sh/lodash?external=react,react-dom&target=es2022",
      );
    });

    it("should normalize malformed external params", () => {
      assertEquals(
        addEsmShDeps("https://esm.sh/@tanstack/react-query@5?external=react&react-dom", "19.1.1"),
        "https://esm.sh/@tanstack/react-query@5?external=react,react-dom&target=es2022",
      );
    });

    it("should add missing react-dom external to existing esm.sh params", () => {
      assertEquals(
        addEsmShDeps("https://esm.sh/@tanstack/react-query@5?external=react", "19.1.1"),
        "https://esm.sh/@tanstack/react-query@5?external=react,react-dom&target=es2022",
      );
    });
  });
});

describe("parseEsmShUrl", () => {
  it("should parse an unversioned package", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/lodash"), {
      origin: "https://esm.sh",
      packageName: "lodash",
      version: null,
      subpath: "",
      search: "",
      hash: "",
    });
  });

  it("should parse a versioned package with a subpath and query", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/lodash@4.17.21/fp?target=es2022"), {
      origin: "https://esm.sh",
      packageName: "lodash",
      version: "4.17.21",
      subpath: "/fp",
      search: "?target=es2022",
      hash: "",
    });
  });

  it("should parse an unversioned scoped package", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/@dnd-kit/core"), {
      origin: "https://esm.sh",
      packageName: "@dnd-kit/core",
      version: null,
      subpath: "",
      search: "",
      hash: "",
    });
  });

  it("should parse a versioned scoped package with a subpath", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/@radix-ui/react-dialog@1.1.1/dist"), {
      origin: "https://esm.sh",
      packageName: "@radix-ui/react-dialog",
      version: "1.1.1",
      subpath: "/dist",
      search: "",
      hash: "",
    });
  });

  it("should decline non-esm.sh URLs", () => {
    assertEquals(parseEsmShUrl("https://cdn.example.com/lib.js"), null);
  });

  it("should decline esm.sh build-prefixed and non-npm paths", () => {
    // Rewriting these would corrupt the specifier; leave them untouched.
    assertEquals(parseEsmShUrl("https://esm.sh/v135/lodash@4.17.21"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/stable/react@19.2.4"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/gh/user/repo"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/jsr/@std/path"), null);
  });

  it("should decline a bare scope with no package", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/@dnd-kit"), null);
  });

  it("should decline an empty path", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/"), null);
  });

  it("should decline a trailing slash, which is an import-map prefix mapping", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/lodash/"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/@dnd-kit/core/"), null);
  });

  it("should decline doubled slashes rather than normalizing them away", () => {
    assertEquals(parseEsmShUrl("https://esm.sh//lodash"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/lodash//fp"), null);
  });

  it("should decline an empty version suffix rather than treating it as unversioned", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/lodash@"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/@dnd-kit/core@"), null);
  });

  it("should decline scheme-qualified specifiers such as node builtins", () => {
    // Treating `node:crypto` as a package name would schedule platform
    // resolution and write-back for something npm has never heard of.
    assertEquals(parseEsmShUrl("https://esm.sh/node:crypto"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/node:fs/promises"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/npm:lodash"), null);
  });
});

describe("buildPinnedEsmShUrl", () => {
  it("should insert the version and preserve subpath, query, and hash", () => {
    const parsed = parseEsmShUrl("https://esm.sh/lodash/fp?target=es2022#frag");
    assertEquals(
      buildPinnedEsmShUrl(parsed!, "4.17.21"),
      "https://esm.sh/lodash@4.17.21/fp?target=es2022#frag",
    );
  });

  it("should insert the version for a scoped package", () => {
    const parsed = parseEsmShUrl("https://esm.sh/@dnd-kit/core");
    assertEquals(
      buildPinnedEsmShUrl(parsed!, "6.1.0"),
      "https://esm.sh/@dnd-kit/core@6.1.0",
    );
  });

  it("should round-trip a pinned URL back through the parser", () => {
    const parsed = parseEsmShUrl("https://esm.sh/@dnd-kit/core/dist?target=es2022");
    const pinned = buildPinnedEsmShUrl(parsed!, "6.1.0");
    assertEquals(parseEsmShUrl(pinned)?.version, "6.1.0");
    assertEquals(parseEsmShUrl(pinned)?.packageName, "@dnd-kit/core");
    assertEquals(parseEsmShUrl(pinned)?.subpath, "/dist");
  });
});
