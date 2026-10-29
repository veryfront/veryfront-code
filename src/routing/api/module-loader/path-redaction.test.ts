import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { redactedErrorMessage, redactFreeText } from "./path-redaction.ts";

/** Every directory of the fake host paths below; none may survive redaction. */
const HOST_PARTS = /srv|alice|some user|Program Files|Device|HarddiskVolume3|Users|other|app/;

describe("redactFreeText", () => {
  it("redacts a path whose directories contain whitespace through its last segment", () => {
    const cases: Array<[string, string]> = [
      ["File not found: /srv/some user/other/x.ts", "File not found: x.ts"],
      ["Cannot find module '/srv/some user name/x.ts' here", "Cannot find module 'x.ts' here"],
      [`Module not found "/srv/some user/a b/x.ts".`, `Module not found "x.ts".`],
      ["open `/Users/alice/some user/x.ts`", "open `x.ts`"],
      ["At C:\\Program Files\\app\\x.ts:1:2", "At x.ts:1:2"],
      ["Missing /Users/alice/some user/x.ts, then failed", "Missing x.ts, then failed"],
    ];
    for (const [text, expected] of cases) {
      const output = redactFreeText(text);
      assertEquals(output, expected, text);
      assertEquals(HOST_PARTS.test(output), false, text);
    }
  });

  it("never lets a path run into a URL, which is still cut to its origin", () => {
    const cases: Array<[string, string]> = [
      [
        "Failed /srv/route.ts (https://cdn.example/mod.ts?token=<TOKEN>)",
        "Failed route.ts (https://cdn.example",
      ],
      ["Failed /srv/route.ts (file:///srv/a.ts?token=<TOKEN>)", "Failed route.ts (a.ts"],
      [
        "Failed '/srv/some user/a.ts at https://cdn.example/m.ts?token=<TOKEN>'",
        "Failed 'a.ts at https://cdn.example'",
      ],
      [
        "Failed /srv/a.ts(https://cdn.example/m.ts?token=<TOKEN>)",
        "Failed a.ts(https://cdn.example",
      ],
    ];
    for (const [text, expected] of cases) {
      const output = redactFreeText(text);
      assertEquals(output, expected, text);
      assertEquals(output.includes("TOKEN") || HOST_PARTS.test(output), false, text);
    }
  });

  it("redacts a Windows root-relative path with a single leading backslash", () => {
    const cases: Array<[string, string]> = [
      ["At \\Users\\alice\\secret.ts", "At secret.ts"],
      ["Open \\Device\\HarddiskVolume3\\srv\\x.ts failed", "Open x.ts failed"],
      ["See '\\Users\\alice\\some user\\x.ts'", "See 'x.ts'"],
    ];
    for (const [text, expected] of cases) {
      const output = redactFreeText(text);
      assertEquals(output, expected, text);
      assertEquals(HOST_PARTS.test(output), false, text);
    }
  });

  it("leaves ordinary messages, escape text and relative paths alone", () => {
    for (
      const text of [
        "Unexpected \\nfoo\\tbar in string",
        "Bad escape \\u00e9\\x41\\0 in string",
        "Cannot find './x.ts' or '../lib/y.ts'",
        "x /srv/a.ts and ./lib/y.ts",
        "Failed at x.ts because of a/b",
        "File /srv/a.ts: input/output error",
        "Failed /srv/build: read/write error",
        "Missing /srv/a.ts and/or b",
        "Cannot open /srv/cache read/write",
        "Missing /srv/build and/or its parent",
        "it's missing, isn't it",
      ]
    ) {
      const expected = text.replace(/\/srv\//, "");
      assertEquals(redactFreeText(text), expected, text);
    }
  });

  it("stays linear on crafted input", () => {
    const crafted = "'/x" + " a/".repeat(20_000) + " \\B\\".repeat(20_000) + " /a b" +
      "/b.".repeat(20_000) + " /c" + "/".repeat(20_000);
    const started = performance.now();
    redactFreeText(crafted);
    assertEquals(performance.now() - started < 1_000, true);
  });
});

describe("redactedErrorMessage", () => {
  it("reads an error's message and redacts it", () => {
    assertEquals(redactedErrorMessage(new Error("open /Users/alice/x.ts")), "open x.ts");
    assertEquals(redactedErrorMessage("open /Users/alice/x.ts"), "open x.ts");
  });

  it("never throws when reading the thrown value throws", () => {
    const hostileMessage = new Error("x");
    Object.defineProperty(hostileMessage, "message", {
      get() {
        throw new Error("/Users/alice/secret.ts");
      },
    });
    const hostileString = {
      toString() {
        throw new Error("/Users/alice/secret.ts");
      },
    };
    assertEquals(redactedErrorMessage(hostileMessage), "<unreadable error>");
    assertEquals(redactedErrorMessage(hostileString), "<unreadable error>");
  });
});
