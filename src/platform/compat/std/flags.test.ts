import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse, parseArgs } from "./flags.ts";

describe("platform/compat/std/flags", () => {
  it("exports the standard parseArgs name and compatibility alias", () => {
    assertEquals(parse, parseArgs);
    assertEquals(
      parseArgs(["--foo", "--bar=baz", "./quux.txt"]),
      { foo: true, bar: "baz", _: ["./quux.txt"] },
    );
  });

  it("applies aliases, declared types, defaults, and boolean defaults", () => {
    assertEquals(
      parseArgs(["-v", "--output", "42"], {
        alias: { verbose: "v", output: ["o"] },
        boolean: ["verbose", "dry-run"],
        string: ["output"],
        default: { mode: "safe" },
      }),
      {
        _: [],
        verbose: true,
        v: true,
        output: "42",
        o: "42",
        mode: "safe",
        "dry-run": false,
      },
    );
  });

  it("collects repeated values and supports explicit negation", () => {
    assertEquals(
      parseArgs(
        ["--tag", "one", "--tag=two", "--no-cache"],
        {
          collect: ["tag"],
          boolean: ["cache"],
          negatable: ["cache"],
        },
      ),
      {
        _: [],
        tag: ["one", "two"],
        cache: false,
      },
    );
  });

  it("parses grouped short flags and inline numeric values", () => {
    assertEquals(
      parseArgs(["-abc", "-n5", "--ratio=1.5", "7"]),
      {
        _: [7],
        a: true,
        b: true,
        c: true,
        n: 5,
        ratio: 1.5,
      },
    );
  });

  it("supports dotted keys without prototype pollution", () => {
    const result = parseArgs(
      ["--server.port=3000", "--__proto__.polluted=true"],
      { default: { "server.host": "localhost" } },
    );

    assertEquals(result, {
      _: [],
      server: { port: 3000, host: "localhost" },
    });
    assertEquals(
      Reflect.get({} as Record<string, unknown>, "polluted"),
      undefined,
    );
  });

  it("lets unknown handling reject flags and positional values", () => {
    const seen: string[] = [];
    const result = parseArgs(["--known", "yes", "--drop=secret", "skip"], {
      string: ["known"],
      unknown(argument) {
        seen.push(argument);
        return !argument.startsWith("--drop") && argument !== "skip";
      },
    });

    assertEquals(result, { _: [], known: "yes" });
    assertEquals(seen, ["--drop=secret", "skip"]);
  });

  it("supports stopEarly and separate double-dash values", () => {
    assertEquals(
      parseArgs(["--flag", "first", "--later", "value"], {
        boolean: ["flag"],
        stopEarly: true,
      }),
      {
        _: ["first", "--later", "value"],
        flag: true,
      },
    );
    assertEquals(
      parseArgs(["before", "--", "after", "--literal"], { "--": true }),
      {
        _: ["before"],
        "--": ["after", "--literal"],
      },
    );
  });

  it("rejects undefined alias declarations", () => {
    assertThrows(
      () => parseArgs([], { alias: { broken: undefined } }),
      TypeError,
      "Alias value must be defined",
    );
  });
});
