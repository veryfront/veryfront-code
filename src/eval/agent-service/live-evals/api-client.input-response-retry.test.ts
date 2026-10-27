import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { type LiveEvalInputResponseValues, submitLiveEvalInputResponse } from "./api-client.ts";

const pending = () =>
  Response.json({ status: 503, code: "RUN_EVENT_IDENTITY_PENDING" }, { status: 503 });

function contextFor(responses: Array<() => Response>) {
  const keys: Array<string | null> = [];
  const bodies: unknown[] = [];
  const sentAt: number[] = [];
  return {
    keys,
    bodies,
    gapsMs: () => sentAt.slice(1).map((at, index) => at - sentAt[index]!),
    context: {
      apiUrl: "https://api.example.test",
      authToken: "test-token",
      projectId: null,
      fetch: (_url: string | URL | Request, init?: RequestInit) => {
        keys.push(new Headers(init?.headers).get("Idempotency-Key"));
        bodies.push(init?.body);
        sentAt.push(Date.now());
        const next = responses.shift();
        if (!next) throw new Error("Unexpected extra submit");
        return Promise.resolve(next());
      },
    },
  };
}

async function submitWithFakeTime(
  context: ReturnType<typeof contextFor>["context"],
  values: LiveEvalInputResponseValues = { answer: "yes" },
) {
  using time = new FakeTime();
  const submitted = submitLiveEvalInputResponse(context, {
    conversationId: "conversation-1",
    inputRequestId: "input-1",
    values,
    requestTimeoutMs: 1000,
  });
  let settled = false;
  const outcome = submitted.then(
    () => ({ error: undefined }),
    (error: unknown) => ({ error }),
  ).finally(() => settled = true);
  while (!settled) await time.tickAsync(1_000);
  return await outcome;
}

it("retries a pending run event identity with the same idempotency key", async () => {
  const { context, keys, gapsMs } = contextFor([
    pending,
    pending,
    () => new Response(null, { status: 201 }),
  ]);
  const { error } = await submitWithFakeTime(context);
  assertEquals(error, undefined);
  assertEquals(keys.length, 3);
  assertEquals(new Set(keys).size, 1);
  assertEquals(gapsMs(), [1_000, 2_000]);
});

it("resends the first payload even if the caller changes it during backoff", async () => {
  const values: LiveEvalInputResponseValues = { answer: "yes" };
  const { context, bodies } = contextFor([
    () => {
      values.answer = "no";
      return pending();
    },
    () => new Response(null, { status: 201 }),
  ]);
  const { error } = await submitWithFakeTime(context, values);
  assertEquals(error, undefined);
  assertEquals(bodies, [
    JSON.stringify({ values: { answer: "yes" } }),
    JSON.stringify({ values: { answer: "yes" } }),
  ]);
});

it("gives up after five pending tries over about ten seconds", async () => {
  const { context, keys, gapsMs } = contextFor([pending, pending, pending, pending, pending]);
  const { error } = await submitWithFakeTime(context);
  assertEquals(keys.length, 5);
  assertEquals(gapsMs(), [1_000, 2_000, 3_000, 4_000]);
  assertEquals((error as Error).message.includes("RUN_EVENT_IDENTITY_PENDING"), true);
});

for (
  const [name, response] of [
    ["another 503", () => Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503 })],
    ["a non-JSON 503", () => new Response("unavailable", { status: 503 })],
    [
      "a pending code on another status",
      () => Response.json({ code: "RUN_EVENT_IDENTITY_PENDING" }, { status: 409 }),
    ],
  ] as const
) {
  it(`does not retry ${name}`, async () => {
    const { context, keys } = contextFor([response]);
    await assertRejects(() =>
      submitLiveEvalInputResponse(context, {
        conversationId: "conversation-1",
        inputRequestId: "input-1",
        values: { answer: "yes" },
        requestTimeoutMs: 1000,
      })
    );
    assertEquals(keys.length, 1);
  });
}
