import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { writeRunsJsonLine } from "./runs-handler.ts";
import { createSuccessEnvelope } from "../../shared/json-output.ts";

describe("runs NDJSON output", () => {
  it("writes a complete envelope through partial asynchronous writes", async () => {
    const bytes: number[] = [];
    const envelope = createSuccessEnvelope("project runs", { id: "one" });
    await writeRunsJsonLine(envelope, {
      write: async (chunk) => {
        await Promise.resolve();
        const size = Math.min(chunk.length, 3);
        bytes.push(...chunk.subarray(0, size));
        return size;
      },
    });
    assertEquals(new TextDecoder().decode(new Uint8Array(bytes)), `${JSON.stringify(envelope)}\n`);
  });

  it("cancels while stdout is blocked", async () => {
    const controller = new AbortController();
    const writing = writeRunsJsonLine({}, {
      write: () => new Promise<number>(() => {}),
    }, controller.signal);
    controller.abort();
    await assertRejects(() => writing, DOMException);
  });

  it("rejects a closed writer instead of spinning or swallowing output failure", async () => {
    await assertRejects(
      () =>
        writeRunsJsonLine({}, {
          write: () => Promise.resolve(0),
        }),
      Error,
      "Output closed",
    );
    await assertRejects(
      () =>
        writeRunsJsonLine({}, {
          write: () => Promise.reject(new Error("broken pipe")),
        }),
      Error,
      "broken pipe",
    );
  });
});
