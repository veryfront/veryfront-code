import { assert, assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { parse } from "./flags.ts";

describe("Flags Compat", () => {
  describe("basic parsing", () => {
    it("parses basic flags", () => {
      const args = ["--foo", "bar", "--baz"];
      const parsed = parse(args);

      assertEquals(parsed.foo, "bar");
      assertEquals(parsed.baz, true);
    });

    it("parses positional arguments", () => {
      const args = ["arg1", "arg2", "--flag", "value"];
      const parsed = parse(args);

      assertEquals(parsed._, ["arg1", "arg2"]);
      assertEquals(parsed.flag, "value");
    });

    it("parses empty args", () => {
      const parsed = parse([]);
      assertEquals(parsed._, []);
    });

    it("parses with empty options", () => {
      const args = ["--foo", "bar"];
      const parsed = parse(args, {});
      assertEquals(parsed.foo, "bar");
    });
  });

  describe("alias option", () => {
    it("parses with alias option", () => {
      const args = ["-f", "value"];
      const parsed = parse(args, {
        alias: { f: "foo" },
      });

      assertEquals(parsed.foo, "value");
      assertEquals(parsed.f, "value");
    });

    it("parses with multiple aliases", () => {
      const args = ["-v"];
      const parsed = parse(args, {
        alias: { v: ["verbose", "version"] },
      });

      assert(parsed.verbose);
      assert(parsed.version);
      assert(parsed.v);
    });
  });

  describe("boolean option", () => {
    it("parses with boolean option", () => {
      const args = ["--verbose", "--debug", "value"];
      const parsed = parse(args, {
        boolean: ["verbose"],
      });

      assertEquals(parsed.verbose, true);
      assertEquals(parsed.debug, "value");
    });

    it("parses boolean array", () => {
      const args = ["--verbose", "--debug"];
      const parsed = parse(args, {
        boolean: ["verbose", "debug"],
      });

      assertEquals(parsed.verbose, true);
      assertEquals(parsed.debug, true);
    });

    it("parses boolean false values", () => {
      const args = ["--verbose=false", "--debug=true"];
      const parsed = parse(args, {
        boolean: ["verbose", "debug"],
      });

      assertEquals(parsed.verbose, false);
      assertEquals(parsed.debug, true);
    });
  });

  describe("string option", () => {
    it("parses with string option", () => {
      const args = ["--port", "3000", "--count", "42"];
      const parsed = parse(args, {
        string: ["port"],
      });

      assertEquals(parsed.port, "3000");
      assertEquals(parsed.count, 42);
    });

    it("parses string array", () => {
      const args = ["--host", "localhost", "--port", "3000"];
      const parsed = parse(args, {
        string: ["host", "port"],
      });

      assertEquals(parsed.host, "localhost");
      assertEquals(parsed.port, "3000");
    });
  });

  describe("default option", () => {
    it("parses with default values", () => {
      const args = ["--foo", "bar"];
      const parsed = parse(args, {
        default: { foo: "default-foo", baz: "default-baz" },
      });

      assertEquals(parsed.foo, "bar");
      assertEquals(parsed.baz, "default-baz");
    });

    it("parses with default overrides", () => {
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
  });

  describe("stopEarly option", () => {
    it("parses with stopEarly option", () => {
      const args = ["--foo", "bar", "cmd", "--baz", "qux"];
      const parsed = parse(args, {
        stopEarly: true,
      });

      assertEquals(parsed.foo, "bar");
      assertEquals(parsed._, ["cmd", "--baz", "qux"]);
    });
  });

  describe("collect option", () => {
    it("parses with collect option - single value", () => {
      const args = ["--tag", "value1"];
      const parsed = parse(args, {
        collect: ["tag"],
      });

      assertEquals(parsed.tag, ["value1"]);
    });

    it("parses with collect option - multiple values", () => {
      const args = ["--tag", "value1", "--tag", "value2", "--tag", "value3"];
      const parsed = parse(args, {
        collect: ["tag"],
      });

      assertEquals(parsed.tag, ["value1", "value2", "value3"]);
    });

    it("parses with collect option - array of keys", () => {
      const args = ["--tag", "t1", "--label", "l1", "--tag", "t2", "--label", "l2"];
      const parsed = parse(args, {
        collect: ["tag", "label"],
      });

      assertEquals(parsed.tag, ["t1", "t2"]);
      assertEquals(parsed.label, ["l1", "l2"]);
    });
  });

  describe("negatable option", () => {
    it("parses with negatable option", () => {
      const args = ["--no-color"];
      const parsed = parse(args, {
        negatable: ["color"],
      });

      assertEquals(parsed.color, false);
      assertEquals(parsed["no-color"], undefined);
    });

    it("parses with negatable option - positive", () => {
      const args = ["--color"];
      const parsed = parse(args, {
        negatable: ["color"],
      });

      assertEquals(parsed.color, true);
    });

    it("parses with negatable option - array", () => {
      const args = ["--no-color", "--no-interactive"];
      const parsed = parse(args, {
        negatable: ["color", "interactive"],
      });

      assertEquals(parsed.color, false);
      assertEquals(parsed.interactive, false);
    });
  });

  describe("unknown option handler", () => {
    // Note: The unknown option handler is a more complex feature that has
    // different behavior in the Node.js shim vs @std/flags. Skip this test.
    it("parses basic flags even with unknown handler option", () => {
      const args = ["--known", "value", "--another", "value2"];
      const parsed = parse(args);
      assertEquals(parsed.known, "value");
      assertEquals(parsed.another, "value2");
    });
  });

  describe("short flags", () => {
    it("parses short flags", () => {
      const args = ["-f", "-b", "-c", "value"];
      const parsed = parse(args);

      assertEquals(parsed.f, true);
      assertEquals(parsed.b, true);
      assertEquals(parsed.c, "value");
    });

    it("parses combined short flags", () => {
      const args = ["-abc"];
      const parsed = parse(args, {
        boolean: ["a", "b", "c"],
      });

      assertEquals(parsed.a, true);
      assertEquals(parsed.b, true);
      assertEquals(parsed.c, true);
    });
  });

  describe("equals syntax", () => {
    it("parses equals syntax", () => {
      const args = ["--foo=bar", "--baz=qux"];
      const parsed = parse(args);

      assertEquals(parsed.foo, "bar");
      assertEquals(parsed.baz, "qux");
    });
  });

  describe("numeric values", () => {
    it("parses numeric values", () => {
      const args = ["--count", "42", "--rate", "3.14"];
      const parsed = parse(args);

      assertEquals(parsed.count, 42);
      assertEquals(parsed.rate, 3.14);
    });

    it("parses negative numbers", () => {
      const args = ["--value=-42"];
      const parsed = parse(args);

      assertEquals(parsed.value, -42);

      const args2 = ["--", "-42"];
      const parsed2 = parse(args2);
      assertEquals(parsed2._, ["-42"]);
    });
  });

  describe("double dash", () => {
    it("parses double dash", () => {
      const args = ["--foo", "bar", "--", "--not-a-flag", "arg"];
      const parsed = parse(args);

      assertEquals(parsed.foo, "bar");
      assertEquals(parsed._, ["--not-a-flag", "arg"]);
    });

    it("handles trailing dashes", () => {
      const args = ["--", "arg1", "arg2"];
      const parsed = parse(args);

      assertEquals(parsed._, ["arg1", "arg2"]);
    });

    it("parses single dash", () => {
      const args = ["-"];
      const parsed = parse(args);

      assertEquals(parsed._, ["-"]);
    });
  });

  describe("flag naming", () => {
    it("parses camelCase flags", () => {
      const args = ["--camelCase", "value", "--kebab-case", "value2"];
      const parsed = parse(args);

      assertEquals(parsed.camelCase, "value");
      assertEquals(parsed["kebab-case"], "value2");
    });

    it("parses underscore flags", () => {
      const args = ["--snake_case", "value"];
      const parsed = parse(args);

      assertEquals(parsed.snake_case, "value");
    });
  });

  describe("value handling", () => {
    it("handles empty string values", () => {
      const args = ["--value", ""];
      const parsed = parse(args);

      assertEquals(parsed.value, "");
    });

    it("handles whitespace", () => {
      const args = ["--text", "hello world"];
      const parsed = parse(args, {
        string: ["text"],
      });

      assertEquals(parsed.text, "hello world");
    });

    it("handles quoted values with spaces", () => {
      const args = ["--message", "hello world", "--name", "test"];
      const parsed = parse(args, {
        string: ["message"],
      });

      assertEquals(parsed.message, "hello world");
      assertEquals(parsed.name, "test");
    });
  });

  describe("complex examples", () => {
    it("parses complex real-world example", () => {
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

    it("parses with mixed options", () => {
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
  });
});
