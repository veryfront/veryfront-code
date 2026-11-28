import { FakeTime } from "#std/testing/time";
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agUiSseEventTypes, parseAgUiSseResponse } from "../ag-ui/sse-parser.ts";
import { createCanonicalManagedBrokerHandler } from "./canonical-managed-broker.ts";
import { userId } from "./broker-ingress.test-helpers.ts";

import {
  canonicalId,
  fixture,
  sourceId,
} from "../../../tests/fixtures/canonical-managed-broker.ts";

describe("canonical managed broker preparation", () => {
  it("validates its configured admission limit before invoking deployment callbacks", () => {
    assertThrows(
      () =>
        createCanonicalManagedBrokerHandler({
          maxActiveRuns: 0,
          apiUrl: "https://api.example.test",
          responseMode: "sse",
          resolveProvider: () => "synthetic",
          broker: { start: () => Promise.reject(new Error("Unexpected allocation")) },
          resolveIngressOptions() {
            throw new Error("Unexpected ingress resolution");
          },
          prepareExecutor() {
            throw new Error("Unexpected preparation");
          },
        }),
      TypeError,
      "Invalid managed run ownership limit",
    );
  });

  it("acknowledges the signed API writer snapshot and leaves terminal ownership with the API", async () => {
    const result = await fixture({ stream: true, projectWriter: "valid" });
    try {
      assertEquals(result.response.status, 200);
      const parsed = await parseAgUiSseResponse(result.response);
      assertEquals(
        result.response.headers.get("X-Veryfront-Run-Event-Persistence"),
        "runtime-owned-v1",
      );
      assert(parsed.events.some((event) => event.type === agUiSseEventTypes.runFinished));
      assertEquals(result.appends[0]?.expected_previous_external_event_sequence, 19);
      assertEquals(result.finalizations, []);
    } finally {
      await result.close();
    }
  });
  for (const advanceDuringStatus of [0, 2000]) {
    it(`rejects expired deadlines before consuming dispatch (status delay: ${advanceDuringStatus})`, async () => {
      const now = Date.parse("2026-01-01T00:00:00Z");
      const admission = { claimed: false };
      const result = await fixture({
        deadline: new Date(now + (advanceDuringStatus ? 1000 : -1)).toISOString(),
        now,
        advanceDuringStatus,
        admission,
      });
      try {
        assertEquals(admission.claimed, false);
        assertEquals(result.response.status, 409);
        assertEquals(result.prepared, 0);
        assertEquals(
          result.calls.some(({ url }) => url.pathname.endsWith("/runtime/admission")),
          false,
        );
      } finally {
        await result.close();
      }
    });
  }
  it("bounds in-flight admission by the signed deadline and refuses a late receipt", async () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    using time = new FakeTime(now);
    let admissionAborted = false;
    const result = await fixture({
      now,
      deadline: new Date(now + 1000).toISOString(),
      advanceDuringAdmission: 1001,
      observeAdmission(signal) {
        time.tick(1001);
        admissionAborted = signal.aborted;
      },
    });
    try {
      assertEquals(admissionAborted, true);
      assertEquals(result.response.status, 409);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    } finally {
      await result.close();
    }
  });
  it("requires atomic API admission across independent broker replicas before preparation", async () => {
    const admission = { claimed: false };
    const replicas = await Promise.all([
      fixture({ stream: true, projectWriter: "valid", admission }),
      fixture({ stream: true, projectWriter: "valid", admission }),
    ]);
    try {
      assertEquals(replicas.map((result) => result.response.status).sort(), [200, 409]);
      const accepted = replicas.find((result) => result.response.status === 200)!;
      const refused = replicas.find((result) => result.response.status === 409)!;
      assertEquals(refused.prepared, 0);
      assertEquals(refused.started, undefined);
      await accepted.response.text();
    } finally {
      await Promise.all(replicas.map((result) => result.close()));
    }
  });
  for (const admissionStatus of [401, 403, 404, 409, 500]) {
    it(`refuses API admission ${admissionStatus} before preparation`, async () => {
      const result = await fixture({ admissionStatus });
      try {
        assertEquals(
          result.response.status,
          admissionStatus === 409
            ? 409
            : admissionStatus === 401 || admissionStatus === 403
            ? 403
            : 503,
        );
        assertEquals(result.prepared, 0);
        assertEquals(result.started, undefined);
      } finally {
        await result.close();
      }
    });
  }
  it("refuses a foreign admission receipt before preparation", async () => {
    const result = await fixture({ admissionMismatch: true });
    try {
      assertEquals(result.response.status, 403);
      assertEquals(result.prepared, 0);
    } finally {
      await result.close();
    }
  });

  it("marks a signed resumed segment consistently with the API opening event", async () => {
    const result = await fixture({ stream: true, projectWriter: "valid", resume: true });
    try {
      const parsed = await parseAgUiSseResponse(result.response);
      const start = parsed.events.find((event) => event.type === agUiSseEventTypes.runStarted);
      assertEquals((start as { metadata?: unknown })?.metadata, { resumed: true });
      assertEquals(result.finalizations, []);
    } finally {
      await result.close();
    }
  });
  for (const projectWriter of ["foreign", "stale", "unsafe"] as const) {
    it(`refuses ${projectWriter} signed writer negotiation before preparation`, async () => {
      const result = await fixture({ projectWriter });
      try {
        assertEquals(result.response.status, projectWriter === "unsafe" ? 400 : 403);
        assertEquals(result.prepared, 0);
        assertEquals(result.started, undefined);
      } finally {
        await result.close();
      }
    });
  }

  it("persists and finalizes a signed canonical SSE turn with separate append and terminal authority", async () => {
    const result = await fixture({ stream: true });
    try {
      assertEquals(result.response.status, 200);
      const parsed = await parseAgUiSseResponse(result.response);
      assert(parsed.events.some((event) => event.type === agUiSseEventTypes.runFinished));
      assert(result.appends.length > 0);
      assertEquals(result.finalizations, [{ status: "completed", terminalBound: true }]);
      const finalization = result.calls.filter((call) => call.url.pathname.endsWith("/finalize"));
      assertEquals(finalization.map((call) => [call.url.pathname, call.authorization]), [[
        `/runs/${canonicalId}/finalize`,
        "Bearer api-auth-token",
      ]]);
      assertEquals(
        result.calls.filter((call) => call.url.pathname.endsWith("/events")).every((call) =>
          call.authorization === "Bearer run-event-token"
        ),
        true,
      );
    } finally {
      await result.close();
    }
    assertEquals(result.cleaned, 1);
  });

  it("refuses a shared run without consuming inference authority before preparation", async () => {
    const result = await fixture({ stream: true, inferenceToken: false });
    try {
      assertEquals(result.response.status, 403);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
      assertEquals(result.calls, []);
    } finally {
      await result.close();
    }
  });

  it("reads execution lifecycle with execution authority before constructing persistence", async () => {
    const result = await fixture();
    assertEquals(result.response.status, 500);
    assertEquals(result.prepared, 1);
    assertEquals(result.cleaned, 1);
    assertEquals(result.calls.map((call) => [call.url.pathname, call.authorization]), [
      [`/runs/${canonicalId}`, "Bearer api-auth-token"],
      [`/runs/${canonicalId}/runtime/admission`, "Bearer api-auth-token"],
    ]);
    assert(result.started?.bindSessionOwnedWork);
    assert(result.started.persistence.publishParentRunEvents);
    assert(result.started.model.runEventSink);
    assertEquals(result.started.tools.admitToolCall, undefined);
    assertEquals(result.started.prepare.serverResolvedResumeToolCall, undefined);
    assertEquals(result.started.persistence.initialToolExposureCheckpoint, {
      version: 2,
      loadedToolNames: ["check"],
    });
    assertEquals(result.started.installation.grant.execution.userId, userId);
    assertEquals(
      JSON.stringify({ installation: result.started.installation, prepare: result.started.prepare })
        .includes("source-read-token"),
      false,
    );
    assertEquals(result.started.trustedRuntime?.hostedKnowledgeAuthToken, "source-read-token");
  });

  for (const absent of ["cursor", "terminal", "sourceToken"] as const) {
    it(`refuses missing ${absent} without an API read, executor preparation or allocation`, async () => {
      const result = await fixture({ [absent]: false });
      assertEquals(result.response.status, absent === "sourceToken" ? 400 : 503);
      assertEquals(result.calls.length, 0);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    });
  }

  it("refuses a waiting run without its signed resume decision before preparation", async () => {
    const result = await fixture({ status: "waiting" });
    try {
      assertEquals(result.response.status, 409);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    } finally {
      await result.close();
    }
  });

  it("refuses a replayed signed resume after its segment has entered another wait", async () => {
    const result = await fixture({
      status: "waiting",
      resume: true,
      stream: true,
      projectWriter: "valid",
    });
    try {
      assertEquals(result.response.status, 409);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    } finally {
      await result.close();
    }
  });

  for (const status of ["completed", "cancelled", "failed"]) {
    it(`refuses a ${status} run before executor preparation`, async () => {
      const result = await fixture({ status });
      assertEquals(result.response.status, 409);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    });
  }

  it("propagates failed authority reads without preparing an executor", async () => {
    const result = await fixture({ apiStatus: 403 });
    assertEquals(result.response.ok, false);
    assertEquals(result.prepared, 0);
    assertEquals(result.started, undefined);
  });

  it("rejects a prepared source project substituted for the execution project and cleans up", async () => {
    const result = await fixture({ mismatch: true });
    assertEquals(result.response.status, 403);
    assertEquals(result.started, undefined);
    assertEquals(result.cleaned, 1);
  });

  it("reads source instructions with the source credential and captured release, never the execution project", async () => {
    const result = await fixture({ probeState: true });
    const sourceReads = result.calls.filter((call) => call.url.pathname.startsWith("/projects/"));
    assert(sourceReads.length > 0);
    assertEquals(
      sourceReads.every((call) =>
        call.url.pathname.startsWith(`/projects/${sourceId}/releases/release-1/files`) &&
        call.authorization === "Bearer source-read-token" &&
        !call.url.searchParams.has("ref")
      ),
      true,
    );
    assertEquals(result.cleaned, 1);
  });

  for (const mismatch of ["wrongEntrypoint", "wrongActor", "aborted"] as const) {
    it(`refuses ${mismatch} before allocation and releases prepared resources`, async () => {
      const result = await fixture({ [mismatch]: true });
      assertEquals(result.response.ok, false);
      assertEquals(result.started, undefined);
      assertEquals(result.cleaned, 1);
    });
  }

  it("forwards only the signed resume decision", async () => {
    const result = await fixture({ resume: true });
    assertEquals(result.started?.prepare.serverResolvedResumeToolCall, {
      id: "tool-1",
      name: "check",
      input: { approved: true },
    });
  });

  it("appends from the signed nonzero durable cursor and advances only on API acknowledgements", async () => {
    const result = await fixture({ probeAppend: true });
    assertEquals(result.appends.map((append) => append.expected_previous_event_id), [
      42,
      43,
      undefined,
    ]);
    assertEquals(result.appends.map((append) => append.expected_previous_external_event_sequence), [
      undefined,
      undefined,
      17,
    ]);
    assertEquals(
      result.calls.filter((call) => call.url.pathname.endsWith("/events")).map(
        (call) => [call.url.pathname, call.authorization],
      ),
      [
        [`/runs/${canonicalId}/events`, "Bearer run-event-token"],
        [`/runs/${canonicalId}/events`, "Bearer run-event-token"],
        [`/runs/${canonicalId}/events`, "Bearer run-event-token"],
      ],
    );
    assertEquals(result.cleaned, 1);
  });
});
