import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  classifyProjectNpmImport,
  exactVersionNamedByRange,
  isFrameworkProvidedPackage,
  parseNpmSpecifier,
  type ProjectNpmImport,
  rangeAdmitsVersion,
} from "./project-npm-imports.ts";

/**
 * A stand-in for the generated package set. Tests state the frozen snapshot
 * they mean instead of reading the live deno.lock, which moves with every
 * framework dependency bump.
 */
const EMBEDDED = {
  lodash: ["3.10.1"],
  yaml: ["2.9.0"],
  sharp: ["0.34.5", "0.35.4"],
} as const;

function classify(
  specifier: string,
  pins: Record<string, string> = {},
): ProjectNpmImport {
  return classifyProjectNpmImport(specifier, pins, EMBEDDED);
}

describe("parseNpmSpecifier", () => {
  it("splits every form a project can import a package under", () => {
    assertEquals(parseNpmSpecifier("unpdf"), { name: "unpdf", version: null, subpath: "." });
    assertEquals(parseNpmSpecifier("unpdf/dist/core"), {
      name: "unpdf",
      version: null,
      subpath: "./dist/core",
    });
    assertEquals(parseNpmSpecifier("@scope/pkg"), {
      name: "@scope/pkg",
      version: null,
      subpath: ".",
    });
    assertEquals(parseNpmSpecifier("@scope/pkg/sub"), {
      name: "@scope/pkg",
      version: null,
      subpath: "./sub",
    });
    assertEquals(parseNpmSpecifier("npm:unpdf@1.8.1"), {
      name: "unpdf",
      version: "1.8.1",
      subpath: ".",
    });
    assertEquals(parseNpmSpecifier("npm:unpdf@1.8.1/dist/core"), {
      name: "unpdf",
      version: "1.8.1",
      subpath: "./dist/core",
    });
    assertEquals(parseNpmSpecifier("npm:@scope/pkg@2.0.0"), {
      name: "@scope/pkg",
      version: "2.0.0",
      subpath: ".",
    });
    assertEquals(parseNpmSpecifier("npm:unpdf"), { name: "unpdf", version: null, subpath: "." });
    assertEquals(parseNpmSpecifier("npm:unpdf@^1.8.0"), {
      name: "unpdf",
      version: "^1.8.0",
      subpath: ".",
    });
  });

  it("claims nothing that is not an npm package specifier", () => {
    // These reach the same esbuild filter and belong to other resolvers: the
    // framework's own subpath imports, URLs, and other schemes.
    assertEquals(parseNpmSpecifier("#veryfront/utils"), null);
    assertEquals(parseNpmSpecifier("https://esm.sh/unpdf@1.8.1"), null);
    assertEquals(parseNpmSpecifier("jsr:@std/path"), null);
    assertEquals(parseNpmSpecifier("node:fs"), null);
    assertEquals(parseNpmSpecifier("@scope"), null);
  });
});

describe("exactVersionNamedByRange", () => {
  it("reads the one version a range names", () => {
    // `npm install` writes the caret form by default, so this is the common
    // package.json entry -- and 1.8.1 is a version the project wrote down.
    assertEquals(exactVersionNamedByRange("^1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange("~1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange(">=1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange("=1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange("v1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange("1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange(" ^1.8.1-rc.1 "), "1.8.1-rc.1");
  });

  it("names no version for a range that names none", () => {
    // Choosing a version for any of these would need a registry, and choosing
    // `latest` would change which code a project runs between two passes.
    assertEquals(exactVersionNamedByRange("*"), null);
    assertEquals(exactVersionNamedByRange("1.x"), null);
    assertEquals(exactVersionNamedByRange(">=1.0.0 <2.0.0"), null);
    assertEquals(exactVersionNamedByRange("^1.0.0 || ^2.0.0"), null);
    assertEquals(exactVersionNamedByRange("latest"), null);
    assertEquals(exactVersionNamedByRange("workspace:*"), null);
    assertEquals(exactVersionNamedByRange("file:../local"), null);
    assertEquals(exactVersionNamedByRange("npm:other@1.0.0"), null);
    assertEquals(exactVersionNamedByRange("git+ssh://git@github.com/o/r.git"), null);
    assertEquals(exactVersionNamedByRange(undefined), null);
    assertEquals(exactVersionNamedByRange(1), null);
  });

  it("names no version a strict bound excludes", () => {
    // `">1.8.1"` is a valid declaration that mentions 1.8.1 and refuses it.
    // Stripping the operator reduced it to 1.8.1 and fetched the one version
    // the project had ruled out -- a worse failure than resolving nothing,
    // because it looks like it worked.
    assertEquals(exactVersionNamedByRange(">1.8.1"), null);
    assertEquals(exactVersionNamedByRange("> 1.8.1"), null);
    assertEquals(exactVersionNamedByRange("<1.8.1"), null);
    // `<=` admits the version it names, so it is servable; `<` and `>` are not.
    assertEquals(exactVersionNamedByRange("<=1.8.1"), "1.8.1");
    // The inclusive sibling still names its version: `>=` must not be read as
    // `>` with a stray `=`, which is the mistake the longest-match order stops.
    assertEquals(exactVersionNamedByRange(">=1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange("~>1.8.1"), "1.8.1");
  });

  it("rejects a version-shaped string without backtracking over it", () => {
    // CodeQL js/redos: the earlier `(?:[-+][0-9A-Za-z.-]+)*` repeated a group
    // whose separator was also inside its own body, so a run of dashes could
    // be split between the repetitions exponentially many ways and an invalid
    // tail made the engine try every one. This exact input took 4.7 seconds to
    // reject; package.json is project-supplied, so that is the whole discovery
    // pass stalled by a declaration.
    const pathological = `0.0.0+${"-".repeat(40)}!`;
    const started = performance.now();
    assertEquals(exactVersionNamedByRange(pathological), null);
    const elapsed = performance.now() - started;
    assertEquals(
      elapsed < 1000,
      true,
      `matching must stay linear, took ${elapsed.toFixed(1)}ms`,
    );
    // The versions the rewritten expression still has to admit and refuse.
    assertEquals(exactVersionNamedByRange("1.8.1-rc.1"), "1.8.1-rc.1");
    assertEquals(exactVersionNamedByRange("1.8.1+build.5"), "1.8.1+build.5");
    assertEquals(exactVersionNamedByRange("1.8.1-rc.1+build.5"), "1.8.1-rc.1+build.5");
    assertEquals(exactVersionNamedByRange("1.8"), null);
    assertEquals(exactVersionNamedByRange("1.8.1-"), null);
  });
});

describe("rangeAdmitsVersion", () => {
  it("evaluates the single-comparator ranges a package.json declares", () => {
    assertEquals(rangeAdmitsVersion("^1.8.1", "1.9.0"), true);
    assertEquals(rangeAdmitsVersion("^1.8.1", "1.8.1"), true);
    assertEquals(rangeAdmitsVersion("^1.8.1", "2.0.0"), false);
    assertEquals(rangeAdmitsVersion("^1.8.1", "1.8.0"), false);
    assertEquals(rangeAdmitsVersion("^0.3.1", "0.3.9"), true);
    assertEquals(rangeAdmitsVersion("^0.3.1", "0.4.0"), false);
    assertEquals(rangeAdmitsVersion("^0.0.3", "0.0.4"), false);
    assertEquals(rangeAdmitsVersion("~1.8.1", "1.8.9"), true);
    assertEquals(rangeAdmitsVersion("~>1.8.1", "1.9.0"), false);
    assertEquals(rangeAdmitsVersion(">=1.8.1", "3.0.0"), true);
    assertEquals(rangeAdmitsVersion(">1.8.1", "1.8.1"), false);
    assertEquals(rangeAdmitsVersion(">1.8.1", "1.8.2"), true);
    assertEquals(rangeAdmitsVersion("<=1.8.1", "1.8.0"), true);
    assertEquals(rangeAdmitsVersion("<2.0.0", "2.0.0"), false);
    assertEquals(rangeAdmitsVersion("<2.0.0", "1.9.9"), true);
    assertEquals(rangeAdmitsVersion("=1.8.1", "1.8.2"), false);
    assertEquals(rangeAdmitsVersion("1.8.1", "1.8.1"), true);
  });

  it("admits a pre-release only as the identical version", () => {
    assertEquals(rangeAdmitsVersion("^1.8.1", "1.9.0-beta.1"), false);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.1", "1.9.0-beta.1"), true);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.1", "1.9.0"), false);
  });

  it("declines to evaluate anything that is not a single comparator", () => {
    for (const range of ["*", "1.x", ">=1 <2", "^1.0.0 || ^2.0.0", "latest", "workspace:*"]) {
      assertEquals(rangeAdmitsVersion(range, "1.8.1"), null, range);
    }
    assertEquals(rangeAdmitsVersion("^1.8.1", "^1.8.1"), null);
  });
});

describe("isFrameworkProvidedPackage", () => {
  it("claims the specifiers only the runtime may answer", () => {
    assertEquals(isFrameworkProvidedPackage("zod"), true);
    assertEquals(isFrameworkProvidedPackage("react"), true);
    assertEquals(isFrameworkProvidedPackage("react-dom"), true);
    assertEquals(isFrameworkProvidedPackage("veryfront"), true);
    assertEquals(isFrameworkProvidedPackage("veryfront/agents"), true);
    assertEquals(isFrameworkProvidedPackage("@opentelemetry/api"), true);
    assertEquals(isFrameworkProvidedPackage("node:fs"), true);
  });

  it("claims bare Node builtins, which have no npm coordinate at all", () => {
    // A project writes `import { readFile } from "fs"` as often as the
    // prefixed form. Classifying these as project dependencies told the user
    // to declare `fs` in package.json, which is advice that cannot work.
    for (
      const builtin of [
        "fs",
        "crypto",
        "stream",
        "os",
        "util",
        "url",
        "process",
        "http",
        "https",
        "net",
        "zlib",
        "child_process",
        "assert",
        "worker_threads",
        "path",
        "buffer",
        "events",
        "timers",
      ]
    ) {
      assertEquals(isFrameworkProvidedPackage(builtin), true, builtin);
    }
    assertEquals(isFrameworkProvidedPackage("fs/promises"), true);
    assertEquals(isFrameworkProvidedPackage("stream/web"), true);
    assertEquals(isFrameworkProvidedPackage("timers/promises"), true);
  });

  it("claims nothing else", () => {
    assertEquals(isFrameworkProvidedPackage("unpdf"), false);
    assertEquals(isFrameworkProvidedPackage("path-to-regexp"), false);
    assertEquals(isFrameworkProvidedPackage("@scope/pkg"), false);
  });
});

describe("classifyProjectNpmImport", () => {
  it("keeps framework-provided packages on the runtime whatever the project declares", () => {
    // A second copy would break the identity comparisons the schema and
    // element registries make against the framework's own objects, so neither
    // a pin nor an explicit version redirects these.
    assertEquals(classify("zod", { zod: "4.0.0" }), { kind: "runtime" });
    assertEquals(classify("npm:react@18.0.0", { react: "18.0.0" }), { kind: "runtime" });
    assertEquals(classify("veryfront/agents"), { kind: "runtime" });
    assertEquals(classify("@opentelemetry/api"), { kind: "runtime" });
  });

  it("keeps bare Node builtins on the runtime instead of calling them missing", () => {
    assertEquals(classify("fs"), { kind: "runtime" });
    assertEquals(classify("crypto"), { kind: "runtime" });
    assertEquals(classify("fs/promises"), { kind: "runtime" });
    assertEquals(classify("child_process"), { kind: "runtime" });
  });

  it("keeps a declared package on the runtime when the runtime embeds that exact version", () => {
    // The binary already carries it: rerouting would turn an offline
    // resolution into a network fetch of a second copy.
    assertEquals(classify("yaml", { yaml: "2.9.0" }), { kind: "runtime" });
    assertEquals(classify("npm:yaml@2.9.0", { yaml: "2.9.0" }), { kind: "runtime" });
    // ...including when the declaration is the caret range npm writes.
    assertEquals(classify("yaml", { yaml: "^2.9.0" }), { kind: "runtime" });
  });

  it("inlines a declared package the runtime does not carry, in every specifier form", () => {
    const cdn = { kind: "cdn", name: "unpdf", version: "1.8.1", subpath: "." } as const;
    const pins = { unpdf: "1.8.1" };

    assertEquals(classify("unpdf", pins), cdn);
    assertEquals(classify("npm:unpdf", pins), cdn);
    assertEquals(classify("npm:unpdf@1.8.1", pins), cdn);
    assertEquals(classify("unpdf/dist/core", pins), { ...cdn, subpath: "./dist/core" });
    assertEquals(classify("npm:unpdf@1.8.1/dist/core", pins), { ...cdn, subpath: "./dist/core" });
    assertEquals(classify("@scope/pkg", { "@scope/pkg": "2.0.0" }), {
      kind: "cdn",
      name: "@scope/pkg",
      version: "2.0.0",
      subpath: ".",
    });
    assertEquals(classify("npm:@scope/pkg@2.0.0", { "@scope/pkg": "2.0.0" }), {
      kind: "cdn",
      name: "@scope/pkg",
      version: "2.0.0",
      subpath: ".",
    });
  });

  it("inlines the caret range npm writes by default", () => {
    // `npm install unpdf` writes `"unpdf": "^1.8.1"`, so this -- not the exact
    // pin -- is the shape the reported production failure actually has. Under
    // exact-only matching the declaration was discarded and the import failed.
    const cdn = { kind: "cdn", name: "unpdf", version: "1.8.1", subpath: "." } as const;
    assertEquals(classify("unpdf", { unpdf: "^1.8.1" }), cdn);
    assertEquals(classify("npm:unpdf", { unpdf: "^1.8.1" }), cdn);
    assertEquals(classify("npm:unpdf@1.8.1", { unpdf: "^1.8.1" }), cdn);
    assertEquals(classify("unpdf/dist/core", { unpdf: "~1.8.1" }), {
      ...cdn,
      subpath: "./dist/core",
    });
    assertEquals(classify("unpdf", { unpdf: ">=1.8.1" }), cdn);
  });

  it("serves the declared version for an import that carries a range", () => {
    // A range in the specifier that admits the pin is served the pin: it is a
    // version the project wrote, and it is what an exact import of the same
    // package would have got.
    assertEquals(classify("npm:unpdf@^1.8.0", { unpdf: "1.8.1" }), {
      kind: "cdn",
      name: "unpdf",
      version: "1.8.1",
      subpath: ".",
    });
    // An embedded declared version still wins, so no network round trip.
    assertEquals(classify("npm:yaml@^2.0.0", { yaml: "2.9.0" }), { kind: "runtime" });
  });

  it("inlines a declared version the runtime carries only at another version", () => {
    // Name-only membership would call this embedded and leave it external, and
    // the runtime would then refuse `lodash@4.17.21` outright -- with the one
    // chance to inline it already spent.
    assertEquals(classify("lodash", { lodash: "4.17.21" }), {
      kind: "cdn",
      name: "lodash",
      version: "4.17.21",
      subpath: ".",
    });
  });

  it("refuses an import whose exact version contradicts the declared pin", () => {
    // Serving 1.8.1 here would run code the import did not ask for.
    const decision = classify("npm:unpdf@2.0.0", { unpdf: "1.8.1" });
    assertEquals(decision.kind, "missing");
    assertEquals(
      decision.kind === "missing" ? decision.reason : "",
      "the import asks for unpdf@2.0.0 but package.json declares unpdf@1.8.1",
    );
  });

  it("leaves an undeclared package to the runtime only when the runtime carries it", () => {
    assertEquals(classify("yaml"), { kind: "runtime" });
    assertEquals(classify("npm:sharp@0.35.4"), { kind: "runtime" });
    assertEquals(classify("npm:sharp@0.30.0").kind, "missing");
    assertEquals(classify("unpdf").kind, "missing");
  });

  it("reports a declaration that names no version to fetch", () => {
    // `*`, `1.x`, `>=1 <2` and dist-tags cannot be turned into a CDN
    // coordinate without a registry, so they fall back to the runtime when the
    // runtime has the package and are reported, never guessed at, when it does
    // not.
    assertEquals(classify("yaml", { yaml: "*" }), { kind: "runtime" });
    const decision = classify("unpdf", { unpdf: "^1.0.0 || ^2.0.0" });
    assertEquals(decision.kind, "missing");
    assertEquals(
      decision.kind === "missing" ? decision.reason : "",
      'this runtime does not carry unpdf and package.json declares "^1.0.0 || ^2.0.0", ' +
        "which names no single version to fetch -- declare an exact version",
    );
  });

  it("never fetches the version a strict lower bound excludes", () => {
    // The declaration is valid and names a version, so nothing upstream of
    // here refuses it -- it reached the CDN branch and inlined unpdf@1.8.1 for
    // a project that had written down that 1.8.1 is not good enough.
    const decision = classify("unpdf", { unpdf: ">1.8.1" });
    assertEquals(decision.kind, "missing");
    assertEquals(
      decision.kind === "missing" ? decision.reason : "",
      'this runtime does not carry unpdf and package.json declares ">1.8.1", ' +
        "which names no single version to fetch -- declare an exact version",
    );
    // A package the runtime does carry keeps falling back to the runtime copy
    // rather than being reported, exactly as any unresolvable range does.
    assertEquals(classify("yaml", { yaml: ">2.9.0" }), { kind: "runtime" });
    // The inclusive bound is unchanged: 1.8.1 satisfies `>=1.8.1`.
    assertEquals(classify("unpdf", { unpdf: ">=1.8.1" }), {
      kind: "cdn",
      name: "unpdf",
      version: "1.8.1",
      subpath: ".",
    });
  });

  it("leaves a specifier that names no npm package to the runtime", () => {
    assertEquals(classify("https://example.com/mod.ts", { unpdf: "1.8.1" }), { kind: "runtime" });
    assertEquals(classify("@scope-only"), { kind: "runtime" });
  });

  it("reads Deno's npm:/ form as the package it names", () => {
    assertEquals(classify("npm:/unpdf@1.8.1", { unpdf: "1.8.1" }), {
      kind: "cdn",
      name: "unpdf",
      version: "1.8.1",
      subpath: ".",
    });
  });

  it("reports an exact import version nothing can serve", () => {
    // Undeclared: the version in the specifier is the only coordinate, and
    // fetching an undeclared package is never done.
    const undeclared = classify("npm:unpdf@1.8.1");
    assertEquals(undeclared, {
      kind: "missing",
      name: "unpdf",
      reason: "this runtime does not carry unpdf@1.8.1 and the project declares no " +
        "dependency on unpdf",
    });

    // Declared, but with a range that names no single version to fetch.
    const unresolvable = classify("npm:unpdf@1.8.1", { unpdf: "*" });
    assertEquals(unresolvable, {
      kind: "missing",
      name: "unpdf",
      reason: 'this runtime does not carry unpdf@1.8.1 and package.json declares "*", ' +
        "which names no single version to fetch -- declare an exact version",
    });
  });

  it("reports an undeclared import that carries a version range", () => {
    assertEquals(classify("npm:unpdf@^1.8.0"), {
      kind: "missing",
      name: "unpdf",
      reason: "this runtime does not carry unpdf and the project declares no dependency on it, " +
        'so the version range "^1.8.0" in the import cannot be resolved',
    });
  });

  it("serves the exact version an import names when the declaration admits it", () => {
    assertEquals(classify("npm:unpdf@1.9.0", { unpdf: "^1.8.1" }), {
      kind: "cdn",
      name: "unpdf",
      version: "1.9.0",
      subpath: ".",
    });
    // A declaration that names no single version still admits an exact import.
    assertEquals(classify("npm:unpdf@1.9.0", { unpdf: ">1.8.1" }), {
      kind: "cdn",
      name: "unpdf",
      version: "1.9.0",
      subpath: ".",
    });
    // The runtime's own copy still wins when it is the admitted version.
    assertEquals(classify("npm:sharp@0.35.4", { sharp: "^0.35.0" }), { kind: "runtime" });
    assertEquals(classify("npm:unpdf@2.0.0", { unpdf: "^1.8.1" }), {
      kind: "missing",
      name: "unpdf",
      reason: "the import asks for unpdf@2.0.0 but package.json declares unpdf@^1.8.1",
    });
  });

  it("refuses an import range that excludes the declared version", () => {
    assertEquals(classify("npm:unpdf@>2.0.0", { unpdf: "1.8.1" }), {
      kind: "missing",
      name: "unpdf",
      reason: "the import asks for unpdf@>2.0.0 but package.json declares unpdf@1.8.1",
    });
  });
});
