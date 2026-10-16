import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withOnboardingDeadline } from "./onboarding-fetch.ts";

it("keeps the onboarding deadline active while a response body stalls", async () => {
  const transport = withOnboardingDeadline(
    () => Promise.resolve(new Response(new ReadableStream())),
    5,
  );
  await assertRejects(
    () => transport("https://api.example.test/projects"),
    DOMException,
    "timed out",
  );
});

it("preserves caller cancellation during onboarding body reads", async () => {
  const controller = new AbortController();
  const reason = new Error("caller cancelled setup");
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let signal: AbortSignal | null | undefined;
  const transport = withOnboardingDeadline((_input: unknown, init?: RequestInit) => {
    signal = init?.signal;
    started();
    return Promise.resolve(new Response(new ReadableStream()));
  });
  const request = transport("https://api.example.test/projects", { signal: controller.signal });
  await reading;
  controller.abort(reason);
  await assertRejects(() => request, Error, reason.message);
  assertEquals(signal?.aborted, true);
  assertEquals(signal?.reason, reason);
});

it("preserves an input Request's cancellation and never sends an already cancelled request", async () => {
  const controller = new AbortController();
  const reason = new Error("request cancelled setup");
  controller.abort(reason);
  let calls = 0;
  const transport = withOnboardingDeadline(() => {
    calls++;
    return Promise.resolve(new Response());
  });
  await assertRejects(
    () =>
      transport(new Request("https://api.example.test/projects", { signal: controller.signal })),
    Error,
    reason.message,
  );
  assertEquals(calls, 0);
});

it("preserves onboarding response status, headers, and JSON", async () => {
  const transport = withOnboardingDeadline(() =>
    Promise.resolve(
      Response.json({ detail: "denied" }, {
        status: 403,
        headers: { "x-request-id": "request-1" },
      }),
    )
  );
  const response = await transport("https://api.example.test/projects");
  assertEquals(response.status, 403);
  assertEquals(response.headers.get("x-request-id"), "request-1");
  assertEquals(await response.json(), { detail: "denied" });
});

it("cancels both buffered response branches when the read deadline expires", async () => {
  let cancellation: unknown;
  let cancelled!: () => void;
  const cancellationDone = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const transport = withOnboardingDeadline(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          cancel(reason) {
            cancellation = reason;
            cancelled();
          },
        }),
      ),
    ), 5);
  await assertRejects(
    () => transport("https://api.example.test/projects"),
    DOMException,
    "timed out",
  );
  await cancellationDone;
  assertEquals(Array.isArray(cancellation), true);
  assertEquals((cancellation as DOMException[]).map((reason) => reason.name), [
    "TimeoutError",
    "TimeoutError",
  ]);
});
