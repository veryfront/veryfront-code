import { assertEquals } from "#std/assert";
import { DOCUMENTATION_URL, runDocsCommand } from "./command.ts";
import { earlyDocsArguments, parsedDocsArguments } from "./arguments.ts";

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

Deno.test("docs keeps global prefixes and router options available for validation", async () => {
  assertEquals(earlyDocsArguments(["--json", "docs", "--unknown"]), ["--json", "--unknown"]);
  assertEquals(earlyDocsArguments(["agent", "create", "--name", "docs"]), undefined);
  for (
    const parsed of [{ _: ["docs"], json: true, output: true }, {
      _: ["docs"],
      json: true,
      unknown: true,
    }]
  ) {
    const { deps, printed } = capture(() => {
      throw new Error("Must not launch a browser");
    });
    assertEquals(await runDocsCommand(parsedDocsArguments(parsed), deps), 2);
    assertEquals(JSON.parse(printed[0]).error.code, "USAGE_ERROR");
  }
});

Deno.test("global-prefixed docs runs without reading broken application configuration", async () => {
  const directory = await Deno.makeTempDir({ prefix: "docs-prefixed-cli-" });
  try {
    await Deno.writeTextFile(
      `${directory}/veryfront.config.ts`,
      'throw new Error("Must not load project configuration");',
    );
    for (
      const [args, expected] of [
        [["--json", "docs", "--unknown"], 2],
        [[
          "--json",
          "docs",
          "--output",
        ], 2],
        [["--json", "docs"], 0],
        [["--json=true", "docs"], 0],
        [["--quiet=false", "docs", "--json"], 0],
      ] as const
    ) {
      const child = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "--config",
          new URL("../../../deno.json", import.meta.url).pathname,
          new URL("../../main.ts", import.meta.url).pathname,
          ...args,
        ],
        cwd: directory,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(child.code, expected, new TextDecoder().decode(child.stderr));
      const result = JSON.parse(new TextDecoder().decode(child.stdout));
      assertEquals(result.success, expected === 0);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("docs preserves true and false boolean assignments", async () => {
  for (
    const args of [["--json=true"], ["--quiet=false", "--json"], ["--version=false", "--json"]]
  ) {
    const { deps, printed } = capture(() => {
      throw new Error("JSON mode must not launch");
    });
    assertEquals(await runDocsCommand(args, deps), 0);
    assertEquals(JSON.parse(printed[0]).command, "docs");
  }
  const opened: string[] = [];
  const { deps } = capture((url) => {
    opened.push(url);
    return Promise.resolve();
  });
  assertEquals(await runDocsCommand(["--json=false"], deps), 0);
  assertEquals(opened, [DOCUMENTATION_URL]);
});

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

Deno.test("docs writes its plain URL when an output destination is requested", async () => {
  const root = await Deno.makeTempDir({ prefix: "docs-url-output-" });
  try {
    const { deps } = capture();
    assertEquals(await runDocsCommand(["--output", `${root}/url.txt`], deps), 0);
    assertEquals(await Deno.readTextFile(`${root}/url.txt`), DOCUMENTATION_URL + "\n");
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
