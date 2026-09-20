import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  classifyProjectNpmImport,
  describeNpmImport,
  exactVersionNamedByRange,
  isFrameworkProvidedPackage,
  nodeBuiltinSpecifier,
  parseNpmSpecifier,
  type ProjectNpmImport,
  rangeAdmitsVersion,
} from "./project-npm-imports.ts";

/**
 * A stand-in for the generated package and constraint sets. Tests state the
 * frozen snapshot they mean instead of reading the live deno.lock, which moves
 * with every framework dependency bump. `ms` is carried only transitively: the
 * binary holds the package, but no import constraint resolves to it.
 */
const EMBEDDED = {
  packages: {
    lodash: ["3.10.1"],
    yaml: ["2.9.0"],
    sharp: ["0.34.5", "0.35.4"],
    ms: ["2.1.3"],
    chalk: ["5.6.2"],
  },
  constraints: {
    lodash: ["3.10.1"],
    yaml: ["2.9.0"],
    sharp: ["0.34.5", "0.35.4"],
    // Recorded only as a range: `npm:chalk` was imported bare.
    chalk: ["*"],
  },
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

  it("admits any release under a wildcard range, operator or not", () => {
    for (const range of ["^*", ">=*", "=*.*", "~>x", "<=x.x", "^x.x.x"]) {
      assertEquals(rangeAdmitsVersion(range, "2.9.0"), true, range);
    }
    // A strict comparator on a wildcard is npm's empty range: nothing is
    // greater than every version, or less than every version.
    for (const range of [">*", "<*", ">x.x", "<x.x.x"]) {
      assertEquals(rangeAdmitsVersion(range, "2.9.0"), false, range);
    }
  });

  it("admits any release under an all-wildcard range", () => {
    for (const range of ["*", "x", "X", "*.*", "x.x", "*.*.*", "x.x.x", "1.*.*"]) {
      assertEquals(rangeAdmitsVersion(range, "2.9.0"), range.startsWith("1") ? false : true, range);
    }
    // A wildcard range still admits no pre-release, as npm does.
    assertEquals(rangeAdmitsVersion("*.*", "2.9.0-rc.1"), false);
  });

  it("compares version cores beyond the safe-integer range", () => {
    // Both majors convert to the same Number, so numeric coercion would call
    // them equal and admit a version the declaration excludes.
    assertEquals(
      rangeAdmitsVersion(">=9007199254740993.0.0", "9007199254740992.0.0"),
      false,
    );
    assertEquals(
      rangeAdmitsVersion(">=9007199254740992.0.0", "9007199254740993.0.0"),
      true,
    );
    assertEquals(rangeAdmitsVersion("^9007199254740993.0.0", "9007199254740993.0.1"), true);
    // Ceilings are computed on the same digits: `^…993.0.0` stops below …994.
    assertEquals(rangeAdmitsVersion("^9007199254740993.0.0", "9007199254740994.0.0"), false);
    assertEquals(exactVersionNamedByRange("^9007199254740993.0.0"), "9007199254740993.0.0");
  });

  it("compares numeric pre-release identifiers beyond the safe-integer range", () => {
    // Both convert to the same Number, so numeric coercion would call them
    // equal and admit the version the declaration excludes.
    assertEquals(rangeAdmitsVersion(">1.0.0-9007199254740993", "1.0.0-9007199254740992"), false);
    assertEquals(rangeAdmitsVersion(">1.0.0-9007199254740992", "1.0.0-9007199254740993"), true);
    // Longer digit strings are larger, and equal lengths compare digit by digit.
    assertEquals(rangeAdmitsVersion(">1.0.0-9", "1.0.0-10"), true);
    assertEquals(rangeAdmitsVersion(">1.0.0-10", "1.0.0-9"), false);
  });

  it("reads a v-prefixed version after an operator, as npm does", () => {
    assertEquals(exactVersionNamedByRange("^v1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange(">= v1.8.1"), "1.8.1");
    assertEquals(exactVersionNamedByRange("=v1.8.1"), "1.8.1");
    assertEquals(rangeAdmitsVersion("^v1.2.3", "1.4.0"), true);
    assertEquals(rangeAdmitsVersion("~v1.2.3", "1.3.0"), false);
    assertEquals(rangeAdmitsVersion(">=v2", "2.0.0"), true);
    assertEquals(exactVersionNamedByRange("vv1.8.1"), null);
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

  it("reads abbreviated versions and wildcards the way npm does", () => {
    assertEquals(rangeAdmitsVersion("^2", "2.9.9"), true);
    assertEquals(rangeAdmitsVersion("^2", "1.8.1"), false);
    assertEquals(rangeAdmitsVersion("^2", "3.0.0"), false);
    assertEquals(rangeAdmitsVersion("^0", "0.9.0"), true);
    assertEquals(rangeAdmitsVersion("^0.0", "0.1.0"), false);
    assertEquals(rangeAdmitsVersion("~2.3", "2.3.9"), true);
    assertEquals(rangeAdmitsVersion("~2.3", "2.4.0"), false);
    assertEquals(rangeAdmitsVersion(">=2", "1.8.1"), false);
    assertEquals(rangeAdmitsVersion(">=2", "2.0.0"), true);
    assertEquals(rangeAdmitsVersion(">2", "2.9.0"), false);
    assertEquals(rangeAdmitsVersion(">2", "3.0.0"), true);
    assertEquals(rangeAdmitsVersion("<=2.3", "2.3.9"), true);
    assertEquals(rangeAdmitsVersion("<=2.3", "2.4.0"), false);
    assertEquals(rangeAdmitsVersion("<2", "1.9.9"), true);
    assertEquals(rangeAdmitsVersion("1.x", "1.8.1"), true);
    assertEquals(rangeAdmitsVersion("1.8.*", "1.9.0"), false);
    assertEquals(rangeAdmitsVersion("2", "2.1.0"), true);
    assertEquals(rangeAdmitsVersion("*", "1.8.1"), true);
    assertEquals(rangeAdmitsVersion("*", "1.8.1-rc.1"), false);
  });

  it("applies npm's pre-release rule and semver precedence", () => {
    assertEquals(rangeAdmitsVersion("^1.8.1", "1.9.0-beta.1"), false);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.1", "1.9.0-beta.1"), true);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.1", "1.9.0-beta.2"), true);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.2", "1.9.0-beta.1"), false);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.1", "1.9.0"), true);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.1", "1.9.5"), true);
    assertEquals(rangeAdmitsVersion("^1.9.0-beta.1", "1.10.0-rc.1"), false);
    assertEquals(rangeAdmitsVersion(">=1.9.0-alpha", "1.9.0-alpha.1"), true);
    assertEquals(rangeAdmitsVersion(">=1.9.0-2", "1.9.0-10"), true);
    assertEquals(rangeAdmitsVersion(">=1.9.0-alpha", "1.9.0-1"), false);
    assertEquals(rangeAdmitsVersion("<1.9.0-rc.1", "1.9.0-beta.1"), true);
    assertEquals(rangeAdmitsVersion("<1.9.0-rc.1", "1.8.9"), true);
    assertEquals(rangeAdmitsVersion("1.9.0-rc.1", "1.9.0-rc.1+build.5"), true);
    assertEquals(rangeAdmitsVersion(">1.9.0-rc.1", "1.9.0"), true);
    assertEquals(rangeAdmitsVersion("<=1.9.0-rc.1", "1.9.0"), false);
  });

  it("evaluates comparator sets, alternatives and hyphen ranges", () => {
    assertEquals(rangeAdmitsVersion(">=1 <2", "1.9.0"), true);
    assertEquals(rangeAdmitsVersion(">=1 <2", "2.0.0"), false);
    assertEquals(rangeAdmitsVersion("^1.0.0 || ^2.0.0", "2.3.4"), true);
    assertEquals(rangeAdmitsVersion("^1.0.0 || ^2.0.0", "3.0.0"), false);
    assertEquals(rangeAdmitsVersion("1.0.0 - 2.0.0", "2.0.0"), true);
    assertEquals(rangeAdmitsVersion("1.0.0 - 2.0.0", "2.0.1"), false);
    // One unreadable comparator makes the whole range unevaluable.
    assertEquals(rangeAdmitsVersion(">=1 <2 SECRET", "1.9.0"), null);
  });

  it("declines to evaluate a range it cannot read", () => {
    for (const range of ["latest", "workspace:*", "1.x.3"]) {
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

  it("claims only the subpaths Node actually exposes under a builtin", () => {
    // `buffer/` is the npm `buffer` package (the documented way to bypass the
    // builtin); `fs/custom` is no builtin. Neither has a `node:` form.
    for (const specifier of ["buffer/", "fs/custom", "events/", "path/to/file"]) {
      assertEquals(nodeBuiltinSpecifier(specifier), null, specifier);
      assertEquals(isFrameworkProvidedPackage(specifier), false, specifier);
    }
    assertEquals(nodeBuiltinSpecifier("path/posix"), "node:path/posix");
    // The platform's canonical list carries Node's internal modules too.
    assertEquals(nodeBuiltinSpecifier("_http_agent"), "node:_http_agent");
    assertEquals(nodeBuiltinSpecifier("_stream_duplex"), "node:_stream_duplex");
    assertEquals(nodeBuiltinSpecifier("util/types"), "node:util/types");
    assertEquals(nodeBuiltinSpecifier("assert/strict"), "node:assert/strict");
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

  it("emits a framework package under a constraint the binary records", () => {
    // A compiled binary resolves `npm:` by constraint. A profile that records
    // zod only at an exact version cannot answer an unconstrained `npm:zod`.
    const exactOnly = {
      packages: { zod: ["4.3.6"], "@opentelemetry/api": ["1.9.1"] },
      constraints: { zod: ["4.3.6"], "@opentelemetry/api": ["1.9.1"] },
    } as const;
    assertEquals(classifyProjectNpmImport("zod", {}, exactOnly), {
      kind: "runtime",
      specifier: "npm:zod@4.3.6",
    });
    assertEquals(classifyProjectNpmImport("@opentelemetry/api", {}, exactOnly), {
      kind: "runtime",
      specifier: "npm:@opentelemetry/api@1.9.1",
    });
    // A recorded wildcard is the framework's own constraint, so it wins.
    const wildcard = {
      packages: { zod: ["4.3.6"] },
      constraints: { zod: ["*", "4.3.6"] },
    } as const;
    assertEquals(classifyProjectNpmImport("zod", {}, wildcard), { kind: "runtime" });
    // The framework itself and Node builtins keep their own forms.
    assertEquals(classifyProjectNpmImport("veryfront/agents", {}, exactOnly), { kind: "runtime" });
    assertEquals(classifyProjectNpmImport("fs/promises", {}, exactOnly), { kind: "runtime" });
  });

  it("rewrites a versioned framework import the binary cannot resolve", () => {
    // The full profile records zod at `*` and 4.3.6, so an import naming
    // 3.25.76 must not be left as written: that constraint resolves to nothing.
    const wildcard = {
      packages: { zod: ["3.25.76", "4.3.6"] },
      constraints: { zod: ["*", "4.3.6"] },
    } as const;
    assertEquals(classifyProjectNpmImport("npm:zod@3.25.76", {}, wildcard), {
      kind: "runtime",
      specifier: "npm:zod@*",
    });
    assertEquals(classifyProjectNpmImport("npm:zod@4.3.6/mini", {}, wildcard), {
      kind: "runtime",
      specifier: "npm:zod@4.3.6/mini",
    });
    // A bare import still keeps the bare form where a wildcard is recorded.
    assertEquals(classifyProjectNpmImport("zod", {}, wildcard), { kind: "runtime" });
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
    assertEquals(classify("yaml", { yaml: "2.9.0" }), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0",
    });
    assertEquals(classify("npm:yaml@2.9.0", { yaml: "2.9.0" }), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0",
    });
    // ...including when the declaration is the caret range npm writes.
    assertEquals(classify("yaml", { yaml: "^2.9.0" }), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0",
    });
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
    assertEquals(classify("npm:yaml@^2.0.0", { yaml: "2.9.0" }), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0",
    });
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
    assertEquals(classify("yaml"), { kind: "runtime", specifier: "npm:yaml@2.9.0" });
    assertEquals(classify("npm:sharp@0.35.4"), {
      kind: "runtime",
      specifier: "npm:sharp@0.35.4",
    });
    assertEquals(classify("npm:sharp@0.30.0").kind, "missing");
    assertEquals(classify("unpdf").kind, "missing");
  });

  it("reports a declaration that names no version to fetch", () => {
    // `*`, `1.x`, `>=1 <2` and dist-tags cannot be turned into a CDN
    // coordinate without a registry, so they fall back to a recorded runtime
    // constraint the declaration admits and are reported, never guessed at,
    // when there is none.
    assertEquals(classify("yaml", { yaml: "*" }), { kind: "runtime", specifier: "npm:yaml@2.9.0" });
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
    // The runtime's own copy is no fallback when the declaration excludes it.
    assertEquals(classify("yaml", { yaml: ">2.9.0" }).kind, "missing");
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
    const unresolvable = classify("npm:unpdf@1.8.1", { unpdf: "latest" });
    assertEquals(unresolvable, {
      kind: "missing",
      name: "unpdf",
      reason: "the import asks for unpdf@1.8.1 and package.json declares a dist-tag, which it " +
        "cannot be checked against -- declare an exact version",
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
    assertEquals(classify("npm:sharp@0.35.4", { sharp: "^0.35.0" }), {
      kind: "runtime",
      specifier: "npm:sharp@0.35.4",
    });
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
    // An abbreviated range is checked as npm reads it: `^2` excludes all of 1.x.
    assertEquals(classify("npm:unpdf@^2", { unpdf: "1.8.1" }), {
      kind: "missing",
      name: "unpdf",
      reason: "the import asks for unpdf@^2 but package.json declares unpdf@1.8.1",
    });
    assertEquals(classify("npm:unpdf@^1", { unpdf: "1.8.1" }), {
      kind: "cdn",
      name: "unpdf",
      version: "1.8.1",
      subpath: ".",
    });
  });

  it("refuses an exact import a declaration without a pin excludes", () => {
    // `<3.0.0` names no version to fetch, but it still rules out lodash 3.10.1,
    // which the runtime happens to carry.
    assertEquals(classify("npm:lodash@3.10.1", { lodash: "<3.0.0" }), {
      kind: "missing",
      name: "lodash",
      reason: "the import asks for lodash@3.10.1 but package.json declares lodash@<3.0.0",
    });
    assertEquals(classify("npm:lodash@3.10.1", { lodash: "<4.0.0" }), {
      kind: "runtime",
      specifier: "npm:lodash@3.10.1",
    });
  });

  it("refuses an import range it cannot check against the declared version", () => {
    assertEquals(classify("npm:unpdf@latest", { unpdf: "1.8.1" }), {
      kind: "missing",
      name: "unpdf",
      reason: "the import asks for unpdf at a dist-tag, a range that cannot be checked against " +
        "the declared unpdf@1.8.1 -- import the declared version instead",
    });
  });

  it("reads an explicit npm: coordinate as the npm package, not the Node builtin", () => {
    assertEquals(classify("npm:buffer@6.0.3", { buffer: "6.0.3" }), {
      kind: "cdn",
      name: "buffer",
      version: "6.0.3",
      subpath: ".",
    });
    assertEquals(classify("buffer", { buffer: "6.0.3" }), { kind: "runtime" });
    assertEquals(classify("npm:zod@3.25.76", { zod: "3.25.76" }), { kind: "runtime" });
  });

  it("treats a package named after an Object.prototype key as any other", () => {
    assertEquals(classify("constructor", { constructor: "1.0.0" }), {
      kind: "cdn",
      name: "constructor",
      version: "1.0.0",
      subpath: ".",
    });
    assertEquals(classify("npm:constructor@1.0.0"), {
      kind: "missing",
      name: "constructor",
      reason: "this runtime does not carry constructor@1.0.0 and the project declares no " +
        "dependency on constructor",
    });
  });

  it("names a non-registry declaration by its kind, never verbatim", () => {
    const secret = "git+https://<TOKEN>@example.com/repo.git";
    const decision = classify("unpdf", { unpdf: secret });
    assertEquals(decision.kind, "missing");
    const reason = decision.kind === "missing" ? decision.reason : "";
    assertEquals(
      reason,
      'this runtime does not carry unpdf and package.json declares a "git+https:" source, ' +
        "which names no single version to fetch -- declare an exact version",
    );
    const exact = classify("npm:unpdf@1.8.1", { unpdf: "user/repo#main" });
    assertEquals(
      exact.kind === "missing" ? exact.reason : "",
      "the import asks for unpdf@1.8.1 and package.json declares a non-registry source, " +
        "which it cannot be checked against -- declare an exact version",
    );
  });

  it("quotes a declaration only when it parses as a range or a dist-tag", () => {
    // Characters a range may use do not make prose a range: whitespace lets a
    // credential-bearing sentence through a character allow-list.
    for (const declared of ["Bearer TOKENVALUE", "token = abc-123", "1.2.3 SECRET"]) {
      const decision = classify("npm:unpdf@1.8.1", { unpdf: declared });
      const reason = decision.kind === "missing" ? decision.reason : "";
      assertEquals(
        reason,
        "the import asks for unpdf@1.8.1 and package.json declares a non-registry source, " +
          "which it cannot be checked against -- declare an exact version",
        declared,
      );
    }
    // A readable range is quoted verbatim wherever the reason states it.
    for (const declared of [">= 1.2.0 < 2", "1.0.0 - 2.0.0", "^1 || ~2.3", ">=1 <2 || 3.x"]) {
      const decision = classify("npm:unpdf@9.9.9", { unpdf: declared });
      const reason = decision.kind === "missing" ? decision.reason : "";
      assertEquals(reason.includes(declared), true, `${declared}: ${reason}`);
    }
  });

  it("never echoes pre-release, build or subpath text that can carry a token", () => {
    // Valid semver, but everything after the core is arbitrary text.
    const mismatch = classify("npm:unpdf@1.0.0-SECRETTOKEN", { unpdf: "2.0.0+BUILDSECRET" });
    const reason = mismatch.kind === "missing" ? mismatch.reason : "";
    assertEquals(reason.includes("SECRETTOKEN"), false, reason);
    assertEquals(reason.includes("BUILDSECRET"), false, reason);
    assertEquals(
      reason,
      "the import asks for unpdf@1.0.0 (pre-release) but package.json declares " +
        "unpdf@2.0.0 (build metadata)",
    );
    assertEquals(
      describeNpmImport("npm:pkg@1.0.0-SECRETTOKEN"),
      "pkg@1.0.0 (pre-release)",
    );
    assertEquals(describeNpmImport("pkg/ghp_EXAMPLETOKEN0123456789"), "pkg/...");
    // A partial version takes a qualifier too: `1.2-<TOKEN>` parses as a range.
    const partial = classify("npm:unpdf@1.8.1", { unpdf: "1.2-AKIAIOSFODNN7EXAMPLE" });
    const partialReason = partial.kind === "missing" ? partial.reason : "";
    assertEquals(partialReason.includes("AKIAIOSFODNN7EXAMPLE"), false, partialReason);
    assertEquals(partialReason.includes('"1.2 (pre-release)"'), true, partialReason);
    assertEquals(describeNpmImport("npm:pkg@1.0.0/sub/deep"), "pkg@1.0.0/...");
  });

  it("names a dist-tag by its kind, since a one-token credential looks the same", () => {
    for (const declared of ["latest", "next", "ghp_EXAMPLETOKEN0123456789"]) {
      const decision = classify("npm:unpdf@1.8.1", { unpdf: declared });
      assertEquals(
        decision.kind === "missing" ? decision.reason : "",
        "the import asks for unpdf@1.8.1 and package.json declares a dist-tag, which it " +
          "cannot be checked against -- declare an exact version",
        declared,
      );
    }
    assertEquals(describeNpmImport("npm:pkg@ghp_EXAMPLETOKEN0123456789"), "pkg (with a dist-tag)");
    assertEquals(describeNpmImport("npm:pkg@latest/sub"), "pkg (with a dist-tag)");
  });

  it("prefers the locked version over the range's lower bound", () => {
    // `^1.8.0` declared, `^1.9.0` imported, 1.9.2 locked: the lower bound 1.8.0
    // is not what the project installed, and the import excludes it.
    assertEquals(
      classifyProjectNpmImport("npm:unpdf@^1.9.0", { unpdf: "^1.8.0" }, EMBEDDED, {
        unpdf: "1.9.2",
      }),
      { kind: "cdn", name: "unpdf", version: "1.9.2", subpath: "." },
    );
  });

  it("does not reuse an embedded copy for a privately sourced package", () => {
    // The embedded artifact is the framework's, not the project's private
    // package of the same coordinate.
    const privately = new Set(["yaml"]);
    assertEquals(
      classifyProjectNpmImport("yaml", { yaml: "2.9.0" }, EMBEDDED, {}, privately).kind,
      "cdn",
    );
    assertEquals(
      classifyProjectNpmImport("npm:yaml@2.9.0", { yaml: "2.9.0" }, EMBEDDED, {}, privately).kind,
      "cdn",
    );
    // Without that evidence the embedded copy is still reused.
    assertEquals(classifyProjectNpmImport("npm:yaml@2.9.0", { yaml: "2.9.0" }, EMBEDDED), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0",
    });
  });

  it("reads a partial strict bound as npm's release boundary", () => {
    // npm expands `>1.1` to `>=1.2.0`, and 1.2.0-beta is below that release.
    assertEquals(rangeAdmitsVersion(">=1.2.0-beta >1.1", "1.2.0-beta"), false);
    assertEquals(rangeAdmitsVersion(">=1.2.0-beta >1.1", "1.2.0"), true);
    assertEquals(rangeAdmitsVersion(">=1.2.0-beta >=1.2", "1.2.0-beta"), false);
    // An upper bound still admits a pre-release below its core.
    assertEquals(rangeAdmitsVersion(">=1.5.0-beta <2", "1.5.0-beta"), true);
  });

  it("lets a wildcard comparator admit a pre-release the set names", () => {
    // `*` vetoes pre-releases on its own, but not when another comparator in
    // the set names one on the same core.
    assertEquals(rangeAdmitsVersion("* >=1.2.3-alpha", "1.2.3-beta"), true);
    assertEquals(rangeAdmitsVersion("*", "1.2.3-beta"), false);
  });

  it("admits a pre-release the comparator set as a whole names", () => {
    // npm admits 1.5.0-beta here: one comparator names a pre-release on that
    // core, and `<2` is not required to name one of its own.
    assertEquals(rangeAdmitsVersion(">=1.5.0-beta <2", "1.5.0-beta"), true);
    assertEquals(rangeAdmitsVersion(">=1.5.0-beta <2", "1.6.0-beta"), false);
    assertEquals(rangeAdmitsVersion(">=1.5.0 <2", "1.5.0-beta"), false);
  });

  it("serves the locked version for a range that names none", () => {
    // `*`, `1.x` and `>=1 <2` name no single version, but the lockfile says
    // which one the project installed, and the declaration admits it.
    for (const declared of ["*", "1.x", ">=1 <2"]) {
      assertEquals(
        classifyProjectNpmImport("unpdf", { unpdf: declared }, EMBEDDED, { unpdf: "1.9.0" }),
        { kind: "cdn", name: "unpdf", version: "1.9.0", subpath: "." },
        declared,
      );
    }
    // A locked version the declaration excludes is not served.
    assertEquals(
      classifyProjectNpmImport("unpdf", { unpdf: "^2" }, EMBEDDED, { unpdf: "1.9.0" }).kind,
      "missing",
    );
  });

  it("serves grandfathered uppercase package names", () => {
    assertEquals(classify("JSONStream", { JSONStream: "1.3.5" }), {
      kind: "cdn",
      name: "JSONStream",
      version: "1.3.5",
      subpath: ".",
    });
  });

  it("claims a builtin only when the whole specifier is one", () => {
    // `buffer/` is the documented way to import the npm package, and
    // `fs/custom` is no builtin subpath: both are the project's dependency.
    assertEquals(classify("buffer/", { buffer: "6.0.3" }), {
      kind: "cdn",
      name: "buffer",
      version: "6.0.3",
      // A trailing slash names no subpath, so the package root is served.
      subpath: ".",
    });
    assertEquals(classify("fs/custom", { fs: "1.0.0" }), {
      kind: "cdn",
      name: "fs",
      version: "1.0.0",
      subpath: "./custom",
    });
    // The builtin itself, and a real builtin subpath, stay with the runtime.
    assertEquals(classify("buffer", { buffer: "6.0.3" }), { kind: "runtime" });
    assertEquals(classify("fs/promises"), { kind: "runtime" });
  });

  it("reads a bare prefix-only builtin name as the npm package", () => {
    assertEquals(classify("test", { test: "3.3.0" }), {
      kind: "cdn",
      name: "test",
      version: "3.3.0",
      subpath: ".",
    });
    assertEquals(classify("node:test"), { kind: "runtime" });
  });

  it("externalizes a reused embedded package under a constraint the binary holds", () => {
    // Left bare, `import "yaml"` is emitted as `npm:yaml` -- the constraint
    // `yaml@*`, which the binary never recorded -- even though it carries 2.9.0.
    assertEquals(classify("yaml", { yaml: "2.9.0" }), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0",
    });
    assertEquals(classify("npm:sharp@0.35.4/lib/utility", { sharp: "^0.35.0" }), {
      kind: "runtime",
      specifier: "npm:sharp@0.35.4/lib/utility",
    });
  });

  it("inlines a declared package the binary carries under no import constraint", () => {
    assertEquals(classify("ms", { ms: "2.1.3" }), {
      kind: "cdn",
      name: "ms",
      version: "2.1.3",
      subpath: ".",
    });
    assertEquals(classify("npm:ms@2.1.3"), {
      kind: "missing",
      name: "ms",
      reason: "this runtime does not carry ms@2.1.3 and the project declares no dependency on ms",
    });
  });
});

describe("describeNpmImport", () => {
  it("names an import by its package, version and subpath", () => {
    assertEquals(describeNpmImport("unpdf"), "unpdf");
    // A subpath's presence is shown, never its free-form segments.
    assertEquals(describeNpmImport("npm:unpdf@1.8.1/dist/core"), "unpdf@1.8.1/...");
    assertEquals(describeNpmImport("@scope/pkg@^2"), "@scope/pkg@^2");
  });

  it("never echoes a version or subpath that can carry a credential", () => {
    assertEquals(
      describeNpmImport("npm:pkg@https://<TOKEN>@example.invalid/x"),
      "pkg (with a non-registry version)",
    );
    assertEquals(
      describeNpmImport("npm:pkg@user:<TOKEN>@host"),
      "pkg (with a non-registry version)",
    );
    assertEquals(describeNpmImport("pkg/x@<TOKEN>"), "pkg/...");
    assertEquals(describeNpmImport("unpdf/../x"), "unpdf/...");
    assertEquals(describeNpmImport("pkg/user:<TOKEN>/x"), "pkg/...");
  });
});

describe("classifyProjectNpmImport with a declaration it cannot evaluate", () => {
  it("refuses an exact import rather than reuse the embedded copy", () => {
    // The comparator set is evaluable, and it excludes the version asked for.
    assertEquals(classify("npm:lodash@3.10.1", { lodash: ">=4.0.0 <5.0.0" }), {
      kind: "missing",
      name: "lodash",
      reason: "the import asks for lodash@3.10.1 but package.json declares " +
        "lodash@>=4.0.0 <5.0.0",
    });
    // A declaration this module cannot read is still not taken as admitting.
    assertEquals(classify("npm:lodash@3.10.1", { lodash: "nightly" }), {
      kind: "missing",
      name: "lodash",
      reason: "the import asks for lodash@3.10.1 and package.json declares a dist-tag, " +
        "which it cannot be checked against -- declare an exact version",
    });
  });
});

describe("parseNpmSpecifier and an @ inside the subpath", () => {
  it("reads a version only from the package-name segment", () => {
    assertEquals(parseNpmSpecifier("pkg/foo@bar"), {
      name: "pkg",
      version: null,
      subpath: "./foo@bar",
    });
    assertEquals(parseNpmSpecifier("@scope/pkg/foo@bar"), {
      name: "@scope/pkg",
      version: null,
      subpath: "./foo@bar",
    });
    assertEquals(parseNpmSpecifier("npm:pkg@1.0.0/foo@bar"), {
      name: "pkg",
      version: "1.0.0",
      subpath: "./foo@bar",
    });
  });
});

describe("classifyProjectNpmImport and a subpath that can leave its package", () => {
  it("refuses every traversal or encoded separator instead of fetching it", () => {
    const pins = { unpdf: "1.8.1" };
    for (
      const specifier of [
        "unpdf/../../left-pad@1.3.0",
        "npm:unpdf@1.8.1/../x",
        "unpdf/./x",
        "unpdf//x",
        "unpdf/dist/",
        "unpdf/%2e%2e/left-pad",
        "unpdf/%2E%2e/left-pad",
        "unpdf/a%2fb",
        "unpdf/a%2Fb",
        "unpdf/a%5cb",
        "unpdf/a\\b",
        "unpdf/sub?target=node",
        "unpdf/foo bar",
        "unpdf/foo\tbar",
        "unpdf/sub#frag",
      ]
    ) {
      const decision = classify(specifier, pins);
      assertEquals(decision.kind, "missing", specifier);
      const reason = decision.kind === "missing" ? decision.reason : "";
      assertEquals(
        reason,
        "the import names a subpath of unpdf with an empty, `.` or `..` segment, an " +
          "encoded or backslash separator, whitespace, or a URL `?` or `#`",
        specifier,
      );
    }
    // An ordinary nested subpath is still served.
    assertEquals(classify("unpdf/dist/core.mjs", pins).kind, "cdn");
  });
});

describe("classifyProjectNpmImport without a usable pin", () => {
  it("reuses an embedded package only under a recorded constraint", () => {
    assertEquals(classify("yaml"), { kind: "runtime", specifier: "npm:yaml@2.9.0" });
    assertEquals(classify("yaml/dist/index.js"), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0/dist/index.js",
    });
    assertEquals(classify("npm:yaml@^2"), { kind: "runtime", specifier: "npm:yaml@2.9.0" });
    assertEquals(classify("chalk"), { kind: "runtime", specifier: "npm:chalk@*" });
    assertEquals(classify("npm:chalk@*"), { kind: "runtime", specifier: "npm:chalk@*" });
    // Carried only transitively: no constraint the binary can resolve.
    assertEquals(classify("ms"), {
      kind: "missing",
      name: "ms",
      reason: "this runtime does not carry ms and the project declares no dependency on it",
    });
  });

  it("never reuses an embedded version the declaration or import excludes", () => {
    assertEquals(classify("yaml", { yaml: "*" }), {
      kind: "runtime",
      specifier: "npm:yaml@2.9.0",
    });
    assertEquals(classify("yaml", { yaml: ">2.9.0" }).kind, "missing");
    assertEquals(classify("lodash", { lodash: "<3.0.0" }).kind, "missing");
    assertEquals(classify("npm:yaml@^3").kind, "missing");
    // A range constraint serves only the range it records, never a different one.
    assertEquals(classify("chalk", { chalk: "^5" }).kind, "missing");
    assertEquals(classify("npm:chalk@^5").kind, "missing");
    assertEquals(classify("chalk", { chalk: "*" }), {
      kind: "runtime",
      specifier: "npm:chalk@*",
    });
  });
});
