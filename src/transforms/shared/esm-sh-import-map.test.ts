import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseEsmShSpecifier, resolveEsmShThroughImportMap } from "./esm-sh-import-map.ts";

function resolve(
  specifier: string,
  imports: Record<string, string> = {},
  scopedImports?: Record<string, string>,
): string | null {
  return resolveEsmShThroughImportMap(specifier, scopedImports, imports);
}

describe("transforms/shared/esm-sh-import-map", () => {
  it("extracts package coordinates from esm.sh specifiers", () => {
    assertEquals(parseEsmShSpecifier("https://esm.sh/@scope/pkg@1/sub"), {
      packageName: "@scope/pkg",
      subpath: "/sub",
      version: "1",
    });
    assertEquals(parseEsmShSpecifier("https://esm.sh/v135/v8/sub/"), {
      packageName: "v8",
      subpath: "/sub/",
      version: null,
    });
    assertEquals(parseEsmShSpecifier("https://esm.sh/gh/owner/repo"), null);
  });

  it("resolves scoped subpaths through package mappings", () => {
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/sub",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg/sub", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/sub",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/es2022/pkg.mjs", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/es2022/pkg.mjs",
    );
  });

  it("prefers scoped import-map entries before global entries", () => {
    assertEquals(
      resolve(
        "https://esm.sh/@scope/pkg@1/sub",
        { "@scope/pkg/sub": "/global/sub.js" },
        { "@scope/pkg": "https://cdn.example/scoped" },
      ),
      "https://cdn.example/scoped/sub",
    );
    assertEquals(
      resolve(
        "https://esm.sh/@scope/pkg@1/sub",
        { "https://esm.sh/@scope/pkg@1/sub": "/global/exact-url.js" },
        { "@scope/pkg": "https://cdn.example/scoped" },
      ),
      "https://cdn.example/scoped/sub",
    );
  });

  it("prefers exact package subpath entries over package root entries", () => {
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://cdn.example/pkg",
        "@scope/pkg/sub": "/local/sub.js",
      }),
      "/local/sub.js",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/other", {
        "@scope/pkg/sub": "/local/sub.js",
      }),
      null,
    );
  });

  it("preserves repeated separators in esm.sh subpaths", () => {
    assertEquals(parseEsmShSpecifier("https://esm.sh/pkg@1//sub"), {
      packageName: "pkg",
      subpath: "//sub",
      version: "1",
    });
    assertEquals(parseEsmShSpecifier("https://esm.sh/@scope/pkg@1///deep//sub"), {
      packageName: "@scope/pkg",
      subpath: "///deep//sub",
      version: "1",
    });
    assertEquals(
      resolve("https://esm.sh/pkg@1//sub", {
        "pkg//sub": "/local.js",
        pkg: "https://cdn.example/pkg",
      }),
      "/local.js",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1//sub", { pkg: "https://cdn.example/pkg" }),
      "https://cdn.example/pkg//sub",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1//", { pkg: "https://cdn.example/pkg" }),
      "https://cdn.example/pkg//",
    );
  });

  it("keeps URL query, fragment, and trailing separator boundaries", () => {
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://esm.sh/@scope/pkg@2?target=es2022",
      }),
      "https://esm.sh/@scope/pkg@2/sub?target=es2022",
    );
    assertEquals(
      resolve("https://esm.sh/lodash@4/fp", {
        lodash: "https://cdn.example/lodash#frag",
      }),
      "https://cdn.example/lodash/fp#frag",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub/", {
        "@scope/pkg": "https://cdn.example/pkg",
      }),
      "https://cdn.example/pkg/sub/",
    );
  });

  it("distinguishes package roots from single-module mappings", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/auto", {
        pkg: "https://cdn.jsdelivr.net/npm/chart.js",
      }),
      "https://cdn.jsdelivr.net/npm/chart.js/auto",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", {
        pkg: "https://cdn.example/pkg.js",
      }),
      "https://cdn.example/pkg.js",
    );
    assertEquals(
      resolve("https://esm.sh/foo@1/other", { foo: "npm:foo@1/sub" }),
      "npm:foo@1/sub",
    );
  });

  it("handles reserved esm.sh segment names without changing package identity", () => {
    assertEquals(resolve("https://esm.sh/stable", { stable: "/local/s.js" }), "/local/s.js");
    assertEquals(resolve("https://esm.sh/stable/", { stable: "/local/s.js" }), "/local/s.js");
    assertEquals(
      resolve("https://esm.sh/stable/react@18", { react: "/local/react.js" }),
      "/local/react.js",
    );
    assertEquals(resolve("https://esm.sh/gh/owner/repo", { gh: "/local/gh.js" }), null);
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://esm.sh/stable",
      }),
      "https://esm.sh/stable",
    );
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://esm.sh/%73table",
      }),
      "https://esm.sh/%73table",
      "an encoded reserved name must be classified the way esm.sh decodes it",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://esm.sh/stable@1" }),
      "https://esm.sh/stable@1/sub",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://esm.sh/%73table@1" }),
      "https://esm.sh/%73table@1/sub",
      "a version still disambiguates an encoded reserved package name",
    );
  });

  it("normalizes default ports before classifying esm.sh mappings", () => {
    for (
      const mapping of [
        "https://esm.sh:443/stable",
        "http://esm.sh:80/stable",
        "HTTPS://ESM.SH.:443/stable",
      ] as const
    ) {
      assertEquals(
        resolve("https://esm.sh/pkg@1/sub", { pkg: mapping }),
        mapping,
        "a default port must not bypass reserved-package protection",
      );
    }

    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://esm.sh:444/stable" }),
      "https://esm.sh:444/stable/sub",
      "a non-default port names a different origin",
    );
  });

  it("treats a mapping ending in a separator as a directory", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://cdn.example/chart.js/" }),
      "https://cdn.example/chart.js/sub",
      "a trailing separator names a directory whatever the segment before it looks like",
    );
  });

  it("keeps an extensionless export below a CDN coordinate", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://cdn.jsdelivr.net/npm/chart.js/auto" }),
      "https://cdn.jsdelivr.net/npm/chart.js/auto",
      "below a coordinate the mapping already selects an export, extension or not",
    );
  });

  it("keeps a versioned export below a CDN coordinate", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", {
        pkg: "https://cdn.jsdelivr.net/npm/lodash@4.17.21/fp",
      }),
      "https://cdn.jsdelivr.net/npm/lodash@4.17.21/fp",
      "the same holds once the coordinate carries a version",
    );
  });

  it("appends a subpath to a coordinate on a package-root CDN", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/auto", { pkg: "https://unpkg.com/chart.js" }),
      "https://unpkg.com/chart.js/auto",
      "unpkg serves the coordinate from the path root, so the whole path is the package",
    );
  });

  it("applies known-CDN coordinates only on canonical ports", () => {
    for (
      const mapping of [
        "https://unpkg.com:443/chart.js",
        "http://unpkg.com:80/chart.js",
        "https://cdn.jsdelivr.net:443/npm/chart.js",
      ] as const
    ) {
      assertEquals(
        resolve("https://esm.sh/pkg@1/auto", { pkg: mapping }),
        `${mapping}/auto`,
        "URL-normalized default ports retain the public CDN path contract",
      );
    }

    for (
      const mapping of [
        "https://unpkg.com:444/chart.js",
        "https://cdn.jsdelivr.net:444/npm/chart.js",
      ] as const
    ) {
      assertEquals(
        resolve("https://esm.sh/pkg@1/auto", { pkg: mapping }),
        mapping,
        "a non-default port names a different origin and keeps a file mapping exact",
      );
    }

    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://unpkg.com:444/pkg.js",
      }),
      "https://unpkg.com:444/pkg.js",
      "a scoped package mapping on a non-default port also remains exact",
    );
  });

  it("normalizes trailing-dot CDN hostnames before classifying coordinates", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/auto", { pkg: "https://unpkg.com./chart.js" }),
      "https://unpkg.com./chart.js/auto",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/auto", {
        pkg: "https://cdn.jsdelivr.net./npm/chart.js",
      }),
      "https://cdn.jsdelivr.net./npm/chart.js/auto",
    );
  });

  it("does not treat an npm directory on an arbitrary host as a package route", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://example.com/npm/some.js" }),
      "https://example.com/npm/some.js",
      "any site may have a directory called npm; the route belongs to specific CDNs",
    );
  });

  it("keeps a version-stamped remote file exact", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://cdn.example/pkg@2.0.0.js" }),
      "https://cdn.example/pkg@2.0.0.js",
      "a version plus an extension is a stamped filename, not a coordinate",
    );
  });

  it("keeps a numeric-leading remote file extension exact", () => {
    assertEquals(
      resolve("https://esm.sh/@scope/pkg@1/sub", {
        "@scope/pkg": "https://cdn.example/archive.7z",
      }),
      "https://cdn.example/archive.7z",
      "numeric-leading extensions are files while purely numeric SemVer components are not",
    );
  });

  it("decodes the remote filename only when classifying its extension", () => {
    for (const filename of ["pkg%2Ejs", "pkg.j%73"]) {
      const mapping = `https://cdn.example/${filename}`;
      assertEquals(
        resolve("https://esm.sh/pkg@1/sub", { pkg: mapping }),
        mapping,
        `${filename} is a single remote module`,
      );
    }
  });

  it("still appends to a bare versioned coordinate", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/fp", { pkg: "https://cdn.example/lodash@4.17.21" }),
      "https://cdn.example/lodash@4.17.21/fp",
      "the last component of a version is not an extension, since one starts with a letter",
    );
  });

  it("recognizes alphabetic SemVer prereleases before file extensions", () => {
    for (
      const version of [
        "2.0.0-rc.alpha",
        "2.0.0-0.alpha",
        "2.0.0+build.alpha",
      ] as const
    ) {
      const mapping = `https://cdn.example/pkg@${version}`;
      assertEquals(
        resolve("https://esm.sh/pkg@1/sub", { pkg: mapping }),
        `${mapping}/sub`,
        `${version} is an exact package version rather than a file extension`,
      );
    }

    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", {
        pkg: "https://cdn.example/pkg@2.0.0.js",
      }),
      "https://cdn.example/pkg@2.0.0.js",
      "an invalid SemVer suffix with a file extension remains a file mapping",
    );
  });

  it("recognizes wildcard SemVer ranges before file extensions", () => {
    for (const version of ["1.x", "1.x.x", "1.2.x", "v1.X", "^1.x", "~1.2.x"] as const) {
      const mapping = `https://cdn.example/pkg@${version}`;
      assertEquals(
        resolve("https://esm.sh/pkg@1/sub", { pkg: mapping }),
        `${mapping}/sub`,
        `${version} is a package version range rather than a file extension`,
      );
    }
  });

  it("treats an npm mapping ending in a separator as a package root", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "npm:react@19/" }),
      "npm:react@19/sub",
      "a trailing separator reads as a root here exactly as it does for a URL",
    );
  });

  it("treats a jsr mapping ending in a separator as a package root", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "jsr:@std/path@1/" }),
      "jsr:@std/path@1/sub",
      "the scope must not be mistaken for an export when the separator trails",
    );
  });

  it("recognises a percent-encoded scope in a CDN coordinate", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://unpkg.com/%40scope/pkg@2" }),
      "https://unpkg.com/%40scope/pkg@2/sub",
      "pathname does not decode the scope marker, so the check has to accept both spellings",
    );
  });

  it("counts a fully encoded scoped CDN coordinate before classifying its export", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", {
        pkg: "https://unpkg.com/%40scope%2Fpkg@2",
      }),
      "https://unpkg.com/%40scope%2Fpkg@2/sub",
      "the encoded scope separator still belongs to the package coordinate",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/other", {
        pkg: "https://unpkg.com/%40scope%2Fpkg@2/export",
      }),
      "https://unpkg.com/%40scope%2Fpkg@2/export",
      "an export below that encoded coordinate must remain exact",
    );
  });

  it("appends below a build-prefixed package named like a build prefix", () => {
    // The channel occupies the first segment, so `v135/v8/sub` reads back as
    // the package `v8`. Only a bare `v8` or `stable` carries the collision.
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://esm.sh/v135/v8" }),
      "https://esm.sh/v135/v8/sub",
      "a build channel disambiguates the coordinate the way a version does",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/sub", { pkg: "https://esm.sh/v8" }),
      "https://esm.sh/v8",
      "without a channel the collision stands and the mapping stays exact",
    );
  });

  it("normalises dot segments before stripping an esm.sh build channel", () => {
    assertEquals(
      resolve("https://esm.sh/./v135/react@18/sub", {
        react: "https://cdn.example/react",
        v135: "https://cdn.example/wrong-package",
      }),
      "https://cdn.example/react/sub",
    );
  });

  it("recognises a jsDelivr GitHub repository as a coordinate", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/build/pdf.mjs", {
        pkg: "https://cdn.jsdelivr.net/gh/mozilla/pdf.js",
      }),
      "https://cdn.jsdelivr.net/gh/mozilla/pdf.js/build/pdf.mjs",
      "a dotted repository name is still the GitHub coordinate",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/other", {
        pkg: "https://cdn.jsdelivr.net/gh/mozilla/pdf.js/build/pdf.mjs",
      }),
      "https://cdn.jsdelivr.net/gh/mozilla/pdf.js/build/pdf.mjs",
      "a path below the repository coordinate already selects an export",
    );
  });

  it("recognises an esm.sh GitHub repository as a coordinate", () => {
    assertEquals(
      resolve("https://esm.sh/pkg@1/build/pdf.mjs", {
        pkg: "https://esm.sh/gh/mozilla/pdf.js",
      }),
      "https://esm.sh/gh/mozilla/pdf.js/build/pdf.mjs",
    );
    assertEquals(
      resolve("https://esm.sh/pkg@1/other", {
        pkg: "https://esm.sh/gh/mozilla/pdf.js/build/pdf.mjs",
      }),
      "https://esm.sh/gh/mozilla/pdf.js/build/pdf.mjs",
    );
  });

  it("normalises dot segments before reading the trailing separator", () => {
    // `pkg@18/.`, `pkg@18/./` and `pkg@18/%2e` are all the same path as
    // `pkg@18/`, but only the normalised form ends in the separator.
    for (const spelling of ["/.", "/./", "/%2e", "/"]) {
      assertEquals(
        resolve(`https://esm.sh/react@18${spelling}`, { react: "https://cdn.example/react" }),
        "https://cdn.example/react/",
        `${spelling} names the package root`,
      );
    }
  });

  it("normalises a dot segment after a subpath", () => {
    assertEquals(
      resolve("https://esm.sh/react@18/sub/.", { react: "https://cdn.example/react" }),
      "https://cdn.example/react/sub/",
      "the separator the dot segment normalises to belongs to the subpath",
    );
  });

  it("recovers a reserved-name package behind a build channel", () => {
    // esm.sh does not nest channels, so once one has been stripped a leading
    // reserved word is a package name even with a subpath after it.
    assertEquals(
      resolve("https://esm.sh/v135/stable/sub", { stable: "/local/s.js" }),
      "/local/s.js",
      "v135/stable/sub names the package stable",
    );
    assertEquals(
      resolve("https://esm.sh/stable/sub", { sub: "/local/sub.js", stable: "/local/s.js" }),
      "/local/sub.js",
      "without a channel ahead of it, stable is the channel and sub is the package",
    );
  });
});
