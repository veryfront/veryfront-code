import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetHostAddressCacheForTests,
  DnsPermissionError,
  resolveHostAddresses,
} from "#veryfront/platform/compat/dns.ts";

async function withResolveDns(
  resolveDns: typeof Deno.resolveDns,
  operation: () => Promise<void>,
): Promise<void> {
  const originalResolveDns = Deno.resolveDns;
  __resetHostAddressCacheForTests();
  try {
    Object.defineProperty(Deno, "resolveDns", {
      value: resolveDns,
      configurable: true,
      writable: true,
    });
    await operation();
  } finally {
    Object.defineProperty(Deno, "resolveDns", {
      value: originalResolveDns,
      configurable: true,
      writable: true,
    });
    __resetHostAddressCacheForTests();
  }
}

describe("DNS permission diagnostics", () => {
  it("surfaces a redacted missing-net-permission diagnosis", async () => {
    await withResolveDns(
      (() => {
        throw new Deno.errors.NotCapable('Requires net access to "8.8.8.8"');
      }) as typeof Deno.resolveDns,
      async () => {
        const error = await assertRejects(
          () => resolveHostAddresses("permission-probe.invalid", { recordTypes: ["A"] }),
          DnsPermissionError,
          "net access to the DNS resolver is not permitted",
        );
        const cause = (error as Error & { cause?: unknown }).cause;
        assertEquals(cause instanceof Error, true);
        assertEquals((cause as Error).message.includes("NotCapable"), true);
        assertEquals((cause as Error).message.includes("8.8.8.8"), false);
        assertEquals((error as Error).message.includes("permission-probe.invalid"), false);
      },
    );
  });

  it("keeps the empty fallback for a genuine resolution failure", async () => {
    await withResolveDns(
      (() => {
        throw new Deno.errors.NotFound("no record found");
      }) as typeof Deno.resolveDns,
      async () => {
        assertEquals(
          await resolveHostAddresses("missing-probe.invalid", { recordTypes: ["A"] }),
          [],
        );
      },
    );
  });
});
