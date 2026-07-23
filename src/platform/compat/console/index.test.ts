import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  blue,
  bold,
  colors,
  colorsPromise,
  cyan,
  dim,
  gray,
  green,
  italic,
  magenta,
  red,
  reset,
  strikethrough,
  underline,
  white,
  yellow,
} from "./index.ts";

interface ConsoleEvaluation {
  immediate: string;
  resolved: string;
}

async function evaluateConsoleStyles(
  env: Readonly<Record<string, string>>,
): Promise<ConsoleEvaluation> {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  const source = `
    const consoleStyles = await import(${JSON.stringify(moduleUrl)});
    const immediate = consoleStyles.red("text");
    const resolved = (await consoleStyles.colorsPromise).red("text");
    console.log(JSON.stringify({ immediate, resolved }));
  `;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--no-check", source],
    clearEnv: true,
    env: { DENO_NO_UPDATE_CHECK: "1", ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(result.code, 0);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as ConsoleEvaluation;
}

describe("compat/console/index.ts exports", () => {
  it("should export color functions", () => {
    for (const fn of [red, green, yellow, blue, cyan, magenta, white, gray]) {
      assertExists(fn);
    }
  });

  it("should export style functions", () => {
    for (const fn of [bold, dim, italic, underline, strikethrough, reset]) {
      assertExists(fn);
    }
  });

  it("should export colors object", () => {
    assertExists(colors);
    assertExists(colors.red);
    assertExists(colors.green);
    assertExists(colors.bold);
  });

  it("should export colorsPromise", () => {
    assertExists(colorsPromise);
  });

  it("color functions should return strings", () => {
    for (const fn of [red, green, bold]) {
      assertEquals(typeof fn("test"), "string");
    }
  });

  it("color functions should contain the input text", () => {
    const input = "test message";
    const output = red(input);
    assertEquals(output.includes(input) || output === input, true);
  });

  it("applies forced styling on the first synchronous call", async () => {
    const result = await evaluateConsoleStyles({ FORCE_COLOR: "1" });
    const expected = "\x1b[31mtext\x1b[39m";

    assertEquals(result.immediate, expected);
    assertEquals(result.resolved, expected);
  });

  it("does not emit ANSI codes for non-terminal output", async () => {
    const result = await evaluateConsoleStyles({});

    assertEquals(result.immediate, "text");
    assertEquals(result.resolved, "text");
  });

  it("lets any NO_COLOR value override forced styling", async () => {
    const result = await evaluateConsoleStyles({ NO_COLOR: "", FORCE_COLOR: "1" });

    assertEquals(result.immediate, "text");
    assertEquals(result.resolved, "text");
  });
});
