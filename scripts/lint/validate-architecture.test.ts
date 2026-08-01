import { assertEquals, assertStringIncludes } from "#std/assert";
import { dirname, fromFileUrl, join } from "#std/path";

const decoder = new TextDecoder();
const repositoryRoot = fromFileUrl(new URL("../..", import.meta.url));
const validatorPath = fromFileUrl(
  new URL("./validate-architecture.ts", import.meta.url),
);

interface ValidatorResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function sourceWithPhysicalLines(
  lineCount: number,
  separator: string,
  trailingSeparator: boolean,
): string {
  const source = Array.from(
    { length: lineCount },
    (_, index) => `// line ${index + 1}`,
  ).join(separator);
  return trailingSeparator ? `${source}${separator}` : source;
}

async function runValidator(
  handlerFiles: Readonly<Record<string, string>>,
): Promise<ValidatorResult> {
  const root = await Deno.makeTempDir({
    prefix: "veryfront-architecture-validator-",
  });
  try {
    const handlersRoot = join(root, "src", "server", "handlers");
    for (const [relativePath, content] of Object.entries(handlerFiles)) {
      const path = join(handlersRoot, relativePath);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, content);
    }

    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--config=${join(repositoryRoot, "deno.json")}`,
        "--frozen",
        "--allow-read",
        validatorPath,
      ],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).output();

    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("handler LOC accepts 150 physical lines with a final newline", async () => {
  const result = await runValidator({
    "boundary.handler.ts": sourceWithPhysicalLines(150, "\n", true),
  });

  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "✅ Handler LOC Limit: PASS");
});

Deno.test("handler LOC recognizes every physical line separator", async () => {
  const separators = [
    ["lf", "\n"],
    ["crlf", "\r\n"],
    ["cr", "\r"],
    ["line-separator", "\u2028"],
    ["paragraph-separator", "\u2029"],
  ] as const;
  const handlerFiles: Record<string, string> = {};
  for (const [label, separator] of separators) {
    handlerFiles[`over-limit-${label}.handler.ts`] = sourceWithPhysicalLines(
      151,
      separator,
      false,
    );
    handlerFiles[`boundary-${label}.handler.ts`] = sourceWithPhysicalLines(
      150,
      separator,
      true,
    );
  }

  const result = await runValidator(handlerFiles);

  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "⚠️  Handler LOC Limit: 5 warning(s)");
  for (const [label] of separators) {
    assertStringIncludes(
      result.stdout,
      `src/server/handlers/over-limit-${label}.handler.ts: Handler has 151 lines (max: 150).`,
    );
    assertEquals(
      result.stdout.includes(
        `src/server/handlers/boundary-${label}.handler.ts:`,
      ),
      false,
    );
  }
});

Deno.test("handler LOC counts legitimate hyphenated and integration handlers", async () => {
  const oversizedSource = sourceWithPhysicalLines(151, "\n", false);
  const result = await runValidator({
    "helper-api.handler.ts": oversizedSource,
    "integration/route.handler.ts": oversizedSource,
  });

  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "⚠️  Handler LOC Limit: 2 warning(s)");
  assertStringIncludes(
    result.stdout,
    "src/server/handlers/helper-api.handler.ts: Handler has 151 lines (max: 150).",
  );
  assertStringIncludes(
    result.stdout,
    "src/server/handlers/integration/route.handler.ts: Handler has 151 lines (max: 150).",
  );
});

Deno.test("handler LOC excludes conventional nonproduction markers", async () => {
  const oversizedSource = sourceWithPhysicalLines(151, "\n", false);
  const handlerFiles: Record<string, string> = {
    "request-handler-helper.ts": oversizedSource,
  };
  const dotMarkers = [
    "Test",
    "tests",
    "Spec",
    "specs",
    "Bench",
    "Benchmark",
    "benchmarks",
    "Helper",
    "helpers",
    "Fixture",
    "fixtures",
  ];
  const directorySegments = [...dotMarkers, "__FiXtUrEs__"];
  for (const marker of dotMarkers) {
    handlerFiles[`route.${marker}.handler.ts`] = oversizedSource;
  }
  for (const segment of directorySegments) {
    handlerFiles[`${segment}/route.handler.ts`] = oversizedSource;
  }

  const result = await runValidator(handlerFiles);

  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stderr, "");
  assertStringIncludes(result.stdout, "✅ Handler LOC Limit: PASS");
  for (const relativePath of Object.keys(handlerFiles)) {
    assertEquals(
      result.stdout.includes(`src/server/handlers/${relativePath}:`),
      false,
    );
  }
});
