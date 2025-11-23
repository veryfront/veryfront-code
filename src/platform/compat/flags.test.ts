import { assert, assertEquals } from "std/assert/mod.ts";
import { parse } from "./flags.ts";

Deno.test("Flags Compat | parse basic flags", () => {
  const args = ["--foo", "bar", "--baz"];
  const parsed = parse(args);

  assertEquals(parsed.foo, "bar");
  assertEquals(parsed.baz, true);
});

Deno.test("Flags Compat | parse positional arguments", () => {
  const args = ["arg1", "arg2", "--flag", "value"];
  const parsed = parse(args);

  assertEquals(parsed._, ["arg1", "arg2"]);
  assertEquals(parsed.flag, "value");
});

Deno.test("Flags Compat | parse with alias option", () => {
  const args = ["-f", "value"];
  const parsed = parse(args, {
    alias: { f: "foo" },
  });

  assertEquals(parsed.foo, "value");
  assertEquals(parsed.f, "value");
});

Deno.test("Flags Compat | parse with multiple aliases", () => {
  const args = ["-v"];
  const parsed = parse(args, {
    alias: { v: ["verbose", "version"] },
  });

  assert(parsed.verbose);
  assert(parsed.version);
  assert(parsed.v);
});

Deno.test("Flags Compat | parse with boolean option", () => {
  const args = ["--verbose", "--debug", "value"];
  const parsed = parse(args, {
    boolean: ["verbose"],
  });

  assertEquals(parsed.verbose, true);
  assertEquals(parsed.debug, "value");
});

Deno.test("Flags Compat | parse boolean array", () => {
  const args = ["--verbose", "--debug"];
  const parsed = parse(args, {
    boolean: ["verbose", "debug"],
  });

  assertEquals(parsed.verbose, true);
  assertEquals(parsed.debug, true);
});

Deno.test("Flags Compat | parse with string option", () => {
  const args = ["--port", "3000", "--count", "42"];
  const parsed = parse(args, {
    string: ["port"],
  });

  assertEquals(parsed.port, "3000");
  assertEquals(parsed.count, 42); // Not specified as string, so parsed as number
});

Deno.test("Flags Compat | parse string array", () => {
  const args = ["--host", "localhost", "--port", "3000"];
  const parsed = parse(args, {
    string: ["host", "port"],
  });

  assertEquals(parsed.host, "localhost");
  assertEquals(parsed.port, "3000");
});

Deno.test("Flags Compat | parse with default values", () => {
  const args = ["--foo", "bar"];
  const parsed = parse(args, {
    default: { foo: "default-foo", baz: "default-baz" },
  });

  assertEquals(parsed.foo, "bar"); // Overridden by args
  assertEquals(parsed.baz, "default-baz"); // Uses default
});

Deno.test("Flags Compat | parse with stopEarly option", () => {
  const args = ["--foo", "bar", "cmd", "--baz", "qux"];
  const parsed = parse(args, {
    stopEarly: true,
  });

  assertEquals(parsed.foo, "bar");
  assertEquals(parsed._, ["cmd", "--baz", "qux"]);
});

Deno.test("Flags Compat | parse with collect option - single value", () => {
  const args = ["--tag", "value1"];
  const parsed = parse(args, {
    collect: ["tag"],
  });

  assertEquals(parsed.tag, ["value1"]);
});

Deno.test("Flags Compat | parse with collect option - multiple values", () => {
  const args = ["--tag", "value1", "--tag", "value2", "--tag", "value3"];
  const parsed = parse(args, {
    collect: ["tag"],
  });

  assertEquals(parsed.tag, ["value1", "value2", "value3"]);
});

Deno.test("Flags Compat | parse with collect option - array of keys", () => {
  const args = ["--tag", "t1", "--label", "l1", "--tag", "t2", "--label", "l2"];
  const parsed = parse(args, {
    collect: ["tag", "label"],
  });

  assertEquals(parsed.tag, ["t1", "t2"]);
  assertEquals(parsed.label, ["l1", "l2"]);
});

Deno.test("Flags Compat | parse with negatable option", () => {
  const args = ["--no-color"];
  const parsed = parse(args, {
    negatable: ["color"],
  });

  assertEquals(parsed.color, false);
  assertEquals(parsed["no-color"], undefined);
});

Deno.test("Flags Compat | parse with negatable option - positive", () => {
  const args = ["--color"];
  const parsed = parse(args, {
    negatable: ["color"],
  });

  assertEquals(parsed.color, true);
});

Deno.test("Flags Compat | parse with negatable option - array", () => {
  const args = ["--no-color", "--no-interactive"];
  const parsed = parse(args, {
    negatable: ["color", "interactive"],
  });

  assertEquals(parsed.color, false);
  assertEquals(parsed.interactive, false);
});

Deno.test("Flags Compat | parse with unknown option handler", () => {
  const args = ["--known", "value", "--unknown", "value2"];
  const unknownArgs: string[] = [];

  const parsed = parse(args, {
    unknown: (arg: string) => {
      if (arg.startsWith("--unknown")) {
        unknownArgs.push(arg);
        return false; // Reject unknown
      }
      return true;
    },
  });

  assertEquals(parsed.known, "value");
  assertEquals(unknownArgs.length, 1);
  assertEquals(unknownArgs[0], "--unknown");
});

Deno.test("Flags Compat | parse empty args", () => {
  const parsed = parse([]);

  assertEquals(parsed._, []);
});

Deno.test("Flags Compat | parse with empty options", () => {
  const args = ["--foo", "bar"];
  const parsed = parse(args, {});

  assertEquals(parsed.foo, "bar");
});

Deno.test("Flags Compat | parse short flags", () => {
  const args = ["-f", "-b", "-c", "value"];
  const parsed = parse(args);

  assertEquals(parsed.f, true);
  assertEquals(parsed.b, true);
  assertEquals(parsed.c, "value");
});

Deno.test("Flags Compat | parse combined short flags", () => {
  const args = ["-abc"];
  const parsed = parse(args, {
    boolean: ["a", "b", "c"],
  });

  assertEquals(parsed.a, true);
  assertEquals(parsed.b, true);
  assertEquals(parsed.c, true);
});

Deno.test("Flags Compat | parse equals syntax", () => {
  const args = ["--foo=bar", "--baz=qux"];
  const parsed = parse(args);

  assertEquals(parsed.foo, "bar");
  assertEquals(parsed.baz, "qux");
});

Deno.test("Flags Compat | parse numeric values", () => {
  const args = ["--count", "42", "--rate", "3.14"];
  const parsed = parse(args);

  assertEquals(parsed.count, 42);
  assertEquals(parsed.rate, 3.14);
});

Deno.test("Flags Compat | parse negative numbers", () => {
  const args = ["--value=-42"];
  const parsed = parse(args);

  assertEquals(parsed.value, -42);

  const args2 = ["--", "-42"];
  const parsed2 = parse(args2);
  assertEquals(parsed2._, ["-42"]);
});

Deno.test("Flags Compat | parse double dash", () => {
  const args = ["--foo", "bar", "--", "--not-a-flag", "arg"];
  const parsed = parse(args);

  assertEquals(parsed.foo, "bar");
  assertEquals(parsed._, ["--not-a-flag", "arg"]);
});

Deno.test("Flags Compat | parse complex real-world example", () => {
  const args = [
    "--verbose",
    "--port",
    "3000",
    "--host",
    "localhost",
    "--tag",
    "t1",
    "--tag",
    "t2",
    "--no-color",
    "build",
    "src/",
  ];

  const parsed = parse(args, {
    boolean: ["verbose"],
    string: ["port", "host"],
    collect: ["tag"],
    negatable: ["color"],
  });

  assertEquals(parsed.verbose, true);
  assertEquals(parsed.port, "3000");
  assertEquals(parsed.host, "localhost");
  assertEquals(parsed.tag, ["t1", "t2"]);
  assertEquals(parsed.color, false);
  assertEquals(parsed._, ["build", "src/"]);
});

Deno.test("Flags Compat | parse with mixed options", () => {
  const args = ["-v", "--debug", "--port=8080", "start"];

  const parsed = parse(args, {
    boolean: ["verbose", "debug"],
    alias: { v: "verbose" },
    string: ["port"],
  });

  assertEquals(parsed.verbose, true);
  assertEquals(parsed.v, true);
  assertEquals(parsed.debug, true);
  assertEquals(parsed.port, "8080");
  assertEquals(parsed._, ["start"]);
});

Deno.test("Flags Compat | parse boolean false values", () => {
  const args = ["--verbose=false", "--debug=true"];
  const parsed = parse(args, {
    boolean: ["verbose", "debug"],
  });

  assertEquals(parsed.verbose, false);
  assertEquals(parsed.debug, true);
});

Deno.test("Flags Compat | parse with default overrides", () => {
  const args: any[] = [];
  const parsed = parse(args, {
    default: {
      port: 3000,
      host: "localhost",
      verbose: false,
    },
  });

  assertEquals(parsed.port, 3000);
  assertEquals(parsed.host, "localhost");
  assertEquals(parsed.verbose, false);
});

Deno.test("Flags Compat | parse handles trailing dashes", () => {
  const args = ["--", "arg1", "arg2"];
  const parsed = parse(args);

  assertEquals(parsed._, ["arg1", "arg2"]);
});

Deno.test("Flags Compat | parse single dash", () => {
  const args = ["-"];
  const parsed = parse(args);

  assertEquals(parsed._, ["-"]);
});

Deno.test("Flags Compat | parse camelCase flags", () => {
  const args = ["--camelCase", "value", "--kebab-case", "value2"];
  const parsed = parse(args);

  assertEquals(parsed.camelCase, "value");
  assertEquals(parsed["kebab-case"], "value2");
});

Deno.test("Flags Compat | parse underscore flags", () => {
  const args = ["--snake_case", "value"];
  const parsed = parse(args);

  assertEquals(parsed.snake_case, "value");
});

Deno.test("Flags Compat | parse handles empty string values", () => {
  const args = ["--value", ""];
  const parsed = parse(args);

  assertEquals(parsed.value, "");
});

Deno.test("Flags Compat | parse whitespace handling", () => {
  const args = ["--text", "hello world"];
  const parsed = parse(args, {
    string: ["text"],
  });

  assertEquals(parsed.text, "hello world");
});

Deno.test("Flags Compat | parse quoted values with spaces", () => {
  const args = ["--message", "hello world", "--name", "test"];
  const parsed = parse(args, {
    string: ["message"],
  });

  assertEquals(parsed.message, "hello world");
  assertEquals(parsed.name, "test");
});
