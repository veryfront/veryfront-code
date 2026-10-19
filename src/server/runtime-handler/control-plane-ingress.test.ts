import { assertEquals } from "#veryfront/testing/assert.ts";
for (
  const mode of [
    "delayed",
    "encoded",
    "missing-project",
    "missing-run",
    "malformed-json",
    "null",
    "array",
    "primitive",
    "inherited-identity",
    "invalid-utf8",
    "errored-stream",
    "aborted-body",
    "hosted-cancelled-body",
    "consumed-body",
    "stale",
    "foreign",
    "oversize",
    "wrong-subject",
    "tampered-body",
    "replay",
    "clone",
    "expired",
  ]
) {
  Deno.test(`factory to execute handler ingress: ${mode}`, async () => {
    const url = new URL("./fixtures/control-plane-ingress-clock.ts", import.meta.url);
    url.searchParams.set("case", mode);
    const worker = new Worker(url.href, { type: "module" });
    try {
      const result = await new Promise<{ passed: boolean }>((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => {
          e.preventDefault();
          reject(new Error(e.message));
        };
      });
      assertEquals(result.passed, true);
    } finally {
      worker.terminate();
    }
  });
}
