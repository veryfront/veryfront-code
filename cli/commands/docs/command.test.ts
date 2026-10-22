import { assertEquals } from "#std/assert";
import { DOCUMENTATION_URL, runDocsCommand } from "./command.ts";

function capture(open: (url: string) => Promise<void> = () => Promise.resolve()) {
  const printed: string[] = [];
  const warnings: string[] = [];
  return {
    printed,
    warnings,
    deps: {
      open,
      print: (text: string) => printed.push(text),
      warn: (text: string) => warnings.push(text),
    },
  };
}

Deno.test("docs prints its destination and opens the fixed public URL", async () => {
  const opened: string[] = [];
  const { deps, printed } = capture((url) => {
    opened.push(url);
    return Promise.resolve();
  });
  assertEquals(await runDocsCommand([], deps), 0);
  assertEquals(printed, [DOCUMENTATION_URL]);
  assertEquals(opened, [DOCUMENTATION_URL]);
});

Deno.test("docs keeps a usable URL and reports failed browser launches", async () => {
  const { deps, printed, warnings } = capture(() => Promise.reject(new Error("missing opener")));
  assertEquals(await runDocsCommand([], deps), 0);
  assertEquals(printed, [DOCUMENTATION_URL]);
  assertEquals(warnings.length, 1);
});

Deno.test("docs JSON returns the existing success envelope without opening a browser", async () => {
  const { deps, printed } = capture(() => {
    throw new Error("must not launch");
  });
  assertEquals(await runDocsCommand(["--json"], deps), 0);
  assertEquals(JSON.parse(printed[0]), {
    success: true,
    command: "docs",
    data: { url: DOCUMENTATION_URL },
  });
});

Deno.test("docs supports the global JSON alias and output destination", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { deps, printed } = capture(() => {
      throw new Error("must not launch");
    });
    const output = `${root}/nested/result.json`;
    assertEquals(await runDocsCommand(["-j", "--output", output], deps), 0);
    assertEquals(JSON.parse(await Deno.readTextFile(output)), JSON.parse(printed[0]));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("docs preserves global noninteractive flags and version reporting", async () => {
  const { deps, printed } = capture(() => {
    throw new Error("must not launch");
  });
  assertEquals(await runDocsCommand(["--no-input", "--no-animation", "-j"], deps), 0);
  assertEquals(JSON.parse(printed[0]).command, "docs");
  assertEquals(await runDocsCommand(["--version", "-j"], deps), 0);
  assertEquals(JSON.parse(printed[1]).command, "version");
});

Deno.test("docs reports output-file failures as JSON without retrying the destination", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${root}/occupied`, "file");
    const { deps, printed } = capture(() => {
      throw new Error("must not launch");
    });
    assertEquals(
      await runDocsCommand(["--json", "--output", `${root}/occupied/result.json`], deps),
      1,
    );
    assertEquals(JSON.parse(printed[0]).error.code, "OUTPUT_WRITE_FAILED");
    assertEquals(printed[0].includes(root), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("docs rejects extra arguments before launching", async () => {
  const { deps, printed } = capture(() => {
    throw new Error("must not launch");
  });
  assertEquals(await runDocsCommand(["--json", "private-path"], deps), 2);
  assertEquals(JSON.parse(printed[0]).error.code, "USAGE_ERROR");
});

Deno.test("docs help is available without launching", async () => {
  const { deps, printed } = capture(() => {
    throw new Error("must not launch");
  });
  assertEquals(await runDocsCommand(["--help"], deps), 0);
  assertEquals(printed[0].includes("without a project"), true);
});
