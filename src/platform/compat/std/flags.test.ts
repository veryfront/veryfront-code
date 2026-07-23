import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseArgs } from "./flags.ts";

describe("platform/compat/std/flags", () => {
  it("supports the string, collect, and default options used by build scripts", () => {
    const args = parseArgs(
      ["--include", "src/one", "--include=src/two", "--output", "dist/bin"],
      {
        string: ["include", "output", "entrypoint"],
        collect: ["include"],
        default: { entrypoint: "cli/main.ts" },
      },
    );

    assertEquals(args.include, ["src/one", "src/two"]);
    assertEquals(args.output, "dist/bin");
    assertEquals(args.entrypoint, "cli/main.ts");
  });

  it("keeps boolean aliases synchronized and initializes them to false", () => {
    assertEquals(
      parseArgs([], { boolean: ["help"], alias: { h: "help" } }),
      { _: [], help: false, h: false },
    );
    assertEquals(
      parseArgs(["-h"], { boolean: ["help"], alias: { h: "help" } }),
      { _: [], help: true, h: true },
    );
  });

  it("supports grouped short flags, attached values, negation, and passthrough", () => {
    assertEquals(
      parseArgs(["-abc", "-n5", "--no-cache", "value", "--", "--raw"], {
        boolean: ["a", "b", "c"],
        string: ["n"],
        negatable: ["cache"],
        "--": true,
      }),
      {
        _: ["value"],
        "--": ["--raw"],
        a: true,
        b: true,
        c: true,
        n: "5",
        cache: false,
      },
    );
  });

  it("honors unknown filtering, nested keys, and prototype pollution guards", () => {
    const seen: string[] = [];
    const args = parseArgs(
      [
        "--db.host",
        "localhost",
        "--ignored",
        "value",
        "--__proto__.polluted",
        "yes",
      ],
      {
        string: ["db.host"],
        unknown: (arg) => {
          seen.push(arg);
          return !arg.startsWith("--ignored");
        },
      },
    );

    assertEquals(args.db, { host: "localhost" });
    assertEquals(args.ignored, undefined);
    assertEquals(({} as Record<string, unknown>).polluted, undefined);
    assertEquals(seen, ["--ignored", "--__proto__.polluted"]);
  });
});
