import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BrokerIngressError } from "./broker-ingress.ts";
import { claimManagedBrokerAdmission } from "./managed-broker-admission.ts";

const projectId = "11111111-1111-4111-8111-111111111111",
  canonicalRunId = "22222222-2222-4222-8222-222222222222",
  nonce = "33333333-3333-4333-8333-333333333333";
// Routing hints only: canonical ingress and the API separately verify both credentials.
const terminal = `header.${
  btoa(
    JSON.stringify({
      runId: "run-owned",
      canonicalRunId,
      dispatchNonce: nonce,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
    }),
  )
}.signature`;
const input = () => ({
  apiUrl: "https://api.example.test",
  authToken: "private-execution-token",
  terminalAuthToken: terminal,
  projectId,
  runId: "run-owned",
  canonicalRunId,
  latestEventId: 3,
  latestExternalEventSequence: 2,
  signal: new AbortController().signal,
});
const receipt = () => ({
  version: 1,
  accepted: true,
  identity: { project_id: projectId, canonical_run_id: canonicalRunId, public_run_id: "run-owned" },
  generation: { worker_id: "worker", dispatch_nonce: nonce, transport_recovery_attempt: 0 },
  lease_remaining_ms: 1000,
  acknowledged_event_id: 3,
  acknowledged_external_sequence: 2,
});

describe("managed broker API admission", () => {
  it("sends only consuming-run authority and the exact cursor, without redirects or retries", async () => {
    let calls = 0;
    await claimManagedBrokerAdmission({
      ...input(),
      fetch: (url, init) => {
        calls++;
        assertEquals(
          String(url),
          `https://api.example.test/runs/${canonicalRunId}/runtime/admission`,
        );
        assertEquals(init?.method, "POST");
        assertEquals(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("authorization"), "Bearer private-execution-token");
        assertEquals(headers.get("x-veryfront-run-terminal-token"), terminal);
        assertEquals(JSON.parse(String(init?.body)), {
          latest_event_id: 3,
          latest_external_event_sequence: 2,
        });
        return Promise.resolve(Response.json(receipt()));
      },
    });
    assertEquals(calls, 1);
  });
  for (const field of ["project", "run", "generation", "cursor"] as const) {
    it(`refuses an unbound ${field} receipt`, async () => {
      const value = receipt();
      if (field === "project") value.identity.project_id = canonicalRunId;
      if (field === "run") value.identity.public_run_id = "foreign-run";
      if (field === "generation") value.generation.dispatch_nonce = projectId;
      if (field === "cursor") value.acknowledged_external_sequence = 3;
      const error = await assertRejects(() =>
        claimManagedBrokerAdmission({
          ...input(),
          fetch: () => Promise.resolve(Response.json(value)),
        })
      );
      assert(error instanceof BrokerIngressError);
      assertEquals(error.status, 403);
    });
  }
  it("refuses oversized and malformed success bodies", async () => {
    for (
      const body of [
        "x".repeat(16 * 1024 + 1),
        "not-json",
        JSON.stringify({ ...receipt(), accepted: false }),
      ]
    ) {
      const error = await assertRejects(() =>
        claimManagedBrokerAdmission({
          ...input(),
          fetch: () => Promise.resolve(new Response(body)),
        })
      );
      assert(error instanceof BrokerIngressError);
      assertEquals(error.status, 503);
    }
  });
  it("retains a private transport diagnostic and never retries an ambiguous claim", async () => {
    const diagnostic = new Error("private transport diagnostic");
    let calls = 0;
    const error = await assertRejects(() =>
      claimManagedBrokerAdmission({
        ...input(),
        fetch: () => {
          calls++;
          return Promise.reject(diagnostic);
        },
      })
    );
    assert(error instanceof BrokerIngressError);
    assertEquals(error.message, "BROKER_UNAVAILABLE");
    assertStrictEquals(error.cause, diagnostic);
    assertEquals(calls, 1);
  });
  it("cancels an unread response when the caller aborts immediately after headers", async () => {
    const controller = new AbortController();
    let canceled = false;
    const error = await assertRejects(() =>
      claimManagedBrokerAdmission({
        ...input(),
        signal: controller.signal,
        fetch: () => {
          controller.abort(new Error("private caller stop"));
          return Promise.resolve(
            new Response(
              new ReadableStream({
                cancel() {
                  canceled = true;
                },
              }),
            ),
          );
        },
      })
    );
    assert(error instanceof BrokerIngressError);
    assertEquals(canceled, true);
  });
});
