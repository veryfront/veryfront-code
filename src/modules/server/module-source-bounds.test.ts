import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { MAX_SERVABLE_MODULE_SOURCE_BYTES } from "./module-limits.ts";

let projectDir = "";

async function serve(pathname: string): Promise<Response> {
  const { serveModule } = await import("./module-server.ts");
  return await serveModule(
    new Request(`http://localhost${pathname}`),
    // dev: the refusal case asserts the specific limit message, which the
    // production branch deliberately redacts.
    { projectId: "test", projectDir, adapter: denoAdapter, dev: true },
  );
}

interface RecordedReads {
  bounded: Array<{ path: string; byteLimit: number }>;
  unbounded: string[];
}

/** denoAdapter with its read surface instrumented, so the reader used is observable. */
function createRecordingAdapter(): { adapter: typeof denoAdapter; reads: RecordedReads } {
  const reads: RecordedReads = { bounded: [], unbounded: [] };
  const baseFs = denoAdapter.fs;
  const fs = Object.create(baseFs) as typeof baseFs;

  fs.readFileBytesWithinLimit = (path: string, byteLimit: number) => {
    reads.bounded.push({ path, byteLimit });
    return baseFs.readFileBytesWithinLimit!(path, byteLimit);
  };
  fs.readFile = (path: string) => {
    reads.unbounded.push(path);
    return baseFs.readFile(path);
  };
  fs.readFileBytes = (path: string) => {
    reads.unbounded.push(path);
    return baseFs.readFileBytes(path);
  };

  const adapter = Object.create(denoAdapter) as typeof denoAdapter;
  Object.defineProperty(adapter, "fs", { value: fs, enumerable: true });
  return { adapter, reads };
}

describe("serveModule source size bounds", () => {
  beforeAll(async () => {
    projectDir = await Deno.makeTempDir({ prefix: "vf-source-bounds-" });
    await Deno.mkdir(`${projectDir}/components`, { recursive: true });
    await Deno.writeTextFile(
      `${projectDir}/components/Small.json`,
      JSON.stringify({ ok: true }),
    );
    // One byte past the admission boundary.
    await Deno.writeTextFile(
      `${projectDir}/components/Huge.json`,
      `{"pad":"${"a".repeat(MAX_SERVABLE_MODULE_SOURCE_BYTES)}"}`,
    );
  });

  afterAll(async () => {
    await Deno.remove(projectDir, { recursive: true });
  });

  it("serves a module within the size boundary", async () => {
    const response = await serve("/_vf_modules/components/Small.json");
    assertEquals(response.status, 200);
  });

  it("refuses a module source past the size boundary instead of buffering it", async () => {
    const response = await serve("/_vf_modules/components/Huge.json");
    const body = await response.text();

    assertEquals(response.status, 500);
    assertEquals(JSON.parse(body), { error: "Module source exceeds 5242880 bytes" });
  });

  it("reads a module source through the exact bounded reader", async () => {
    const { adapter, reads } = createRecordingAdapter();
    const { serveModule } = await import("./module-server.ts");

    const response = await serveModule(
      new Request("http://localhost/_vf_modules/components/Huge.json"),
      { projectId: "test", projectDir, adapter, dev: true },
    );
    await response.text();

    assertEquals(response.status, 500);
    assertEquals(
      reads.bounded.at(-1)?.byteLimit,
      MAX_SERVABLE_MODULE_SOURCE_BYTES,
      "module source must be read through the exact bounded reader at the servable limit",
    );
    assertEquals(
      reads.unbounded.some((path) => path.endsWith("/components/Huge.json")),
      false,
      "an oversized module source must never be fully buffered",
    );
  });
});
