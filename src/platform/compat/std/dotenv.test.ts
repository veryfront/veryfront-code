import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove, writeTextFile } from "../fs.ts";
import { join, toFileUrl } from "../path/index.ts";
import { deleteEnv, getHostEnv, setEnv } from "../process.ts";
import {
  MAX_ENV_FILE_CHARACTERS,
  MAX_ENV_FILE_LINES,
  MAX_ENV_VALUE_CHARACTERS,
} from "./dotenv-limits.ts";
import { load, parse } from "./dotenv.ts";

describe("platform/compat/std/dotenv", () => {
  let tempDirectory = "";

  beforeAll(async () => {
    tempDirectory = await makeTempDir({ prefix: "veryfront-dotenv-" });
  });

  afterAll(async () => {
    await remove(tempDirectory, { recursive: true });
  });

  it("parses supported syntax into a null-prototype record", () => {
    const result = parse(
      [
        "# comment",
        "export EXPORTED=value",
        "EMPTY=",
        "SINGLE='  $EXPORTED  '",
        'DOUBLE="line\\nnext\\tend"',
        'MULTILINE="first',
        'second"',
        "INLINE=kept#comment",
      ].join("\n"),
    );

    assertEquals(Object.getPrototypeOf(result), null);
    assertEquals(result.EXPORTED, "value");
    assertEquals(result.EMPTY, "");
    assertEquals(Object.hasOwn(result, "EMPTY"), true);
    assertEquals(result.SINGLE, "  $EXPORTED  ");
    assertEquals(result.DOUBLE, "line\nnext\tend");
    assertEquals(result.MULTILINE, "first\nsecond");
    assertEquals(result.INLINE, "kept");
  });

  it("resolves forward references, host values, and nested defaults", () => {
    const hostKey = uniqueKey("HOST");
    setEnv(hostKey, "from-host");

    try {
      const result = parse(
        [
          "FORWARD=$LATER",
          "LATER=present",
          `HOST_VALUE=\${${hostKey}}`,
          "MISSING_VALUE=${DOES_NOT_EXIST}",
          "DEFAULT_VALUE=${DOES_NOT_EXIST:-fallback}",
          "NESTED_DEFAULT=${DOES_NOT_EXIST:-${LATER:-other}}",
          String.raw`ESCAPED=\$LATER`,
        ].join("\n"),
      );

      assertEquals(result.FORWARD, "present");
      assertEquals(result.HOST_VALUE, "from-host");
      assertEquals(result.MISSING_VALUE, "");
      assertEquals(result.DEFAULT_VALUE, "fallback");
      assertEquals(result.NESTED_DEFAULT, "present");
      assertEquals(result.ESCAPED, String.raw`\$LATER`);
    } finally {
      deleteEnv(hostKey);
    }
  });

  it("uses the last assignment for duplicate keys", () => {
    assertEquals(parse("VALUE=first\nVALUE=second").VALUE, "second");
  });

  it("rejects malformed or dangerous assignments", () => {
    const invalidSources = [
      "NO_ASSIGNMENT",
      "1INVALID=value",
      "__proto__=polluted",
      'UNTERMINATED="value',
      'TRAILING="value" unexpected',
      "INTERPOLATION=${UNTERMINATED",
      "NULL=value\0suffix",
    ];

    for (const source of invalidSources) {
      assertThrows(() => parse(source));
    }
    assertEquals(
      Reflect.get({} as Record<string, unknown>, "polluted"),
      undefined,
    );
  });

  it("rejects interpolation cycles", () => {
    assertThrows(
      () => parse("FIRST=$SECOND\nSECOND=${THIRD}\nTHIRD=$FIRST"),
      Error,
      "FIRST -> SECOND -> THIRD -> FIRST",
    );
  });

  it("enforces file, line, and expanded-value limits", () => {
    assertThrows(
      () => parse("x".repeat(MAX_ENV_FILE_CHARACTERS + 1)),
      RangeError,
    );
    assertThrows(
      () => parse("\n".repeat(MAX_ENV_FILE_LINES)),
      RangeError,
    );

    const baseValue = "x".repeat(MAX_ENV_VALUE_CHARACTERS);
    assertThrows(
      () => parse(`BASE="${baseValue}"\nEXPANDED=$BASE$BASE`),
      RangeError,
    );
  });

  it("returns an empty null-prototype record for disabled or missing files", async () => {
    const disabled = await load({ envPath: null });
    const emptyPath = await load({ envPath: "" });
    const missing = await load({
      envPath: join(tempDirectory, "does-not-exist.env"),
    });

    assertEquals(Object.getPrototypeOf(disabled), null);
    assertEquals(Object.keys(disabled), []);
    assertEquals(Object.getPrototypeOf(emptyPath), null);
    assertEquals(Object.keys(emptyPath), []);
    assertEquals(Object.getPrototypeOf(missing), null);
    assertEquals(Object.keys(missing), []);
  });

  it("loads string and URL paths with identical parsing", async () => {
    const path = join(tempDirectory, "portable.env");
    await writeTextFile(path, "PORTABLE=value\nEMPTY=");

    const fromPath = await load({ envPath: path });
    const fromUrl = await load({ envPath: toFileUrl(path) });

    assertEquals(fromPath.PORTABLE, "value");
    assertEquals(fromPath.EMPTY, "");
    assertEquals(fromUrl.PORTABLE, "value");
    assertEquals(fromUrl.EMPTY, "");
  });

  it("exports missing values without overwriting the host environment", async () => {
    const existingKey = uniqueKey("EXISTING");
    const missingKey = uniqueKey("MISSING");
    const path = join(tempDirectory, "export.env");
    setEnv(existingKey, "host");
    await writeTextFile(
      path,
      `${existingKey}=file\n${missingKey}=exported`,
    );

    try {
      const result = await load({ envPath: path, export: true });

      assertEquals(result[existingKey], "file");
      assertEquals(result[missingKey], "exported");
      assertEquals(getHostEnv(existingKey), "host");
      assertEquals(getHostEnv(missingKey), "exported");
    } finally {
      deleteEnv(existingKey);
      deleteEnv(missingKey);
    }
  });

  it("propagates parse failures from loaded files", async () => {
    const path = join(tempDirectory, "malformed.env");
    await writeTextFile(path, "NOT_AN_ASSIGNMENT");

    await assertRejects(
      () => load({ envPath: path }),
      SyntaxError,
      "Expected an environment assignment",
    );
  });
});

function uniqueKey(suffix: string): string {
  return `VF_DOTENV_${suffix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
