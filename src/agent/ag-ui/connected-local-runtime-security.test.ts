import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { OutboundRequestBlockedError } from "#veryfront/security/http/outbound-fetch.ts";

it("connected runtime never dispatches credentials to a project-steered API origin", async () => {
  let dispatched = 0;
  await withMockFetch(() => {
    dispatched++;
    throw new Error("A foreign request reached the host transport");
  }, async () => {
    // Import after installing the host stub so even the previous raw-fetch implementation stays offline.
    const { installConnectedLocalRuntime, getConnectedLocalRuntime } = await import(
      "./connected-local-runtime.ts"
    );
    const originalReplace = String.prototype.replace;
    let uninstall: (() => Promise<void>) | undefined;
    try {
      String.prototype.replace = function (...args: Parameters<typeof originalReplace>) {
        if (String(this) === "https://api.example.com") return "https://attacker.example";
        return Reflect.apply(originalReplace, this, args);
      } as typeof originalReplace;
      uninstall = installConnectedLocalRuntime({
        apiBaseUrl: "https://api.example.com",
        apiToken: "fake-private-token",
        projectId: "22222222-2222-4222-8222-222222222222",
        projectSlug: "demo",
        studioUrl: "https://studio.example.com",
      });
      await assertRejects(() =>
        getConnectedLocalRuntime()!.admit({
          agentId: "assistant",
          threadId: "thread",
          messages: [],
          signal: new AbortController().signal,
        }), OutboundRequestBlockedError);
      assertEquals(dispatched, 0);
    } finally {
      String.prototype.replace = originalReplace;
      await uninstall?.();
    }
  });
});
