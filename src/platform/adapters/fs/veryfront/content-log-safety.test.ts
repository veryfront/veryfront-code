import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLoggerConfigForTests } from "#veryfront/utils/logger/logger.ts";
import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import { FileListIndex } from "./file-list-index.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";

async function captureDebugOutput(action: () => Promise<void>): Promise<string> {
  const previousFormat = Deno.env.get("LOG_FORMAT");
  const previousLevel = Deno.env.get("LOG_LEVEL");
  const originalDebug = console.debug;
  const output: string[] = [];

  Deno.env.set("LOG_FORMAT", "json");
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  console.debug = ((...args: unknown[]) => {
    output.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
  }) as typeof console.debug;

  try {
    await action();
    return output.join("\n");
  } finally {
    console.debug = originalDebug;
    if (previousFormat === undefined) Deno.env.delete("LOG_FORMAT");
    else Deno.env.set("LOG_FORMAT", previousFormat);
    if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", previousLevel);
    __resetLoggerConfigForTests();
  }
}

describe("remote filesystem content logging", () => {
  it("does not log inline source content from the file-list index", async () => {
    const sentinel = "VF_SOURCE_CONTENT_MUST_NOT_REACH_LOGS_7d4f";

    const output = await captureDebugOutput(async () => {
      const index = new FileListIndex(async () => [
        { path: "pages/index.tsx", content: sentinel },
      ]);
      assertEquals(await index.lookup("pages/index.tsx"), sentinel);
    });

    assertEquals(output.includes(sentinel), false);
  });

  it("does not log source content returned by the remote API", async () => {
    const sentinel = "VF_REMOTE_SOURCE_MUST_NOT_REACH_LOGS_91ac";
    const client = {
      getRequestBranch: () => "main",
      getFileContent: () => Promise.resolve(sentinel),
      getPublishedFileContent: () => Promise.resolve(sentinel),
      resolveFileWithExtension: () => Promise.resolve(null),
    } as unknown as VeryfrontApiClient;
    const readOperations = new ReadOperations(
      client,
      new FileCache({ enabled: true, ttl: 1_000, maxSize: 100 }),
      new PathNormalizer(),
      {
        isProductionMode: () => false,
        getReleaseId: () => null,
        getContentContext: () => ({
          sourceType: "branch" as const,
          projectSlug: "test",
          branch: "main",
        }),
      },
    );
    readOperations.setFileListReadyPromise(Promise.resolve());

    const output = await captureDebugOutput(async () => {
      assertEquals(await readOperations.readTextFile("pages/index.tsx"), sentinel);
    });

    assertEquals(output.includes(sentinel), false);
  });
});
