import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

interface NodeConsoleEvaluation {
  red: string;
}

async function evaluateNodeStyles(
  env: Readonly<Record<string, string>>,
  isTTY: boolean,
): Promise<NodeConsoleEvaluation> {
  const moduleUrl = new URL("./node.ts", import.meta.url).href;
  const source = `
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: {
        cwd: () => ".",
        env: ${JSON.stringify(env)},
        release: { name: "node" },
        stdout: { isTTY: ${JSON.stringify(isTTY)} },
        versions: { node: "22.0.0" },
      },
      writable: true,
    });
    const consoleStyles = await import(${JSON.stringify(moduleUrl)});
    console.log(JSON.stringify({ red: consoleStyles.red("text") }));
  `;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--no-check", source],
    clearEnv: true,
    env: { DENO_NO_UPDATE_CHECK: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(result.code, 0);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as NodeConsoleEvaluation;
}

describe("platform/compat/console/node", () => {
  it("emits ANSI styles for a terminal", async () => {
    const result = await evaluateNodeStyles({}, true);

    assertEquals(result.red, "\x1b[31mtext\x1b[39m");
  });

  it("does not emit ANSI styles for redirected output", async () => {
    const result = await evaluateNodeStyles({}, false);

    assertEquals(result.red, "text");
  });

  it("honors NO_COLOR for terminal output", async () => {
    const result = await evaluateNodeStyles({ NO_COLOR: "1" }, true);

    assertEquals(result.red, "text");
  });
});
