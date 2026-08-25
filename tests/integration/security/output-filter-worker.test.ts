/**
 * The zero-length global-sticky Unicode regression runs in a Worker so a bad
 * regex advancement loop times out without hanging the unit runner. Worker
 * construction is a semantic unit-boundary effect, so this wiring lives in the
 * integration suite while the hermetic OutputFilter cases stay colocated with
 * the implementation.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

async function filterAstralOutputInWorker(flags: string): Promise<string> {
  const source = `
    import { OutputFilter } from ${
    JSON.stringify(import.meta.resolve("#veryfront/agent/middleware/security/validator.ts"))
  };
    const pattern = new RegExp("(?:)", ${JSON.stringify(flags)});
    const result = await new OutputFilter({ blockedPatterns: [pattern] }).filter("😀");
    self.postMessage(result.filtered);
  `;
  const workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module" });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      new Promise<string>((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => {
          event.preventDefault();
          reject(event.error ?? new Error(event.message));
        };
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`OutputFilter timed out for /${flags}`)),
          5_000,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  }
}

describe("OutputFilter Worker regressions", () => {
  it("advances zero-length Unicode matches past complete astral code points", async () => {
    for (const flags of ["guy", "gvy"]) {
      assertEquals(
        await filterAstralOutputInWorker(flags),
        "[REDACTED]😀[REDACTED]",
        `/${flags} must terminate without splitting the astral code point`,
      );
    }
  });
});
