import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { DecisionCallOptions, DecisionQuestion } from "veryfront/provider/types";
import { ProviderRateLimitError, ProviderRequestError } from "veryfront/provider/shared";
import { createOpenAIProviderDecisions, OpenAIProvider } from "./index.ts";

const predicate = {
  name: "relevant",
  type: "predicate",
  instructions: "Is the text relevant?",
} as const;
const options: DecisionCallOptions = { input: "A synthetic example.", questions: [predicate] };
const usage = {
  input_tokens: 42,
  output_tokens: 0,
  total_tokens: 42,
  input_tokens_details: { cached_tokens: 10, cache_write_tokens: 20 },
};

function result(answers: unknown[] = [{ name: "relevant", type: "predicate", probability: 0.8 }]) {
  return { model: "gpt-6-luna", answers, usage };
}

function runtimeWith(payload: unknown) {
  return new OpenAIProvider().createDecisions("gpt-6-luna", {
    credential: "test-key",
    fetch: () => Promise.resolve(Response.json(payload)),
  });
}

describe("OpenAI Decisions runtime", () => {
  it("omits undefined optional descriptions from valid choice and score questions", async () => {
    const questions: DecisionQuestion[] = [
      {
        name: "category",
        type: "choice",
        instructions: "Choose one",
        choices: [{ value: "a", description: undefined }, { value: "b" }],
      },
      {
        name: "quality",
        type: "score",
        instructions: "Rate quality",
        levels: [{ label: "low", description: undefined }, { label: "high" }],
      },
    ];
    let body: Record<string, unknown> | undefined;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: (_url, init) => {
        body = JSON.parse(init?.body as string);
        return Promise.resolve(Response.json(result([
          { name: "category", type: "refusal" },
          { name: "quality", type: "refusal" },
        ])));
      },
    });
    await runtime.decide({ input: "fixture", questions });
    assertEquals(body?.questions, [
      { ...questions[0], choices: [{ value: "a" }, { value: "b" }] },
      { ...questions[1], levels: [{ label: "low" }, { label: "high" }] },
    ]);
  });

  it("sends typed shared evidence and questions through the authenticated decisions endpoint", async () => {
    let seenURL = "";
    let seenInit: RequestInit | undefined;
    const runtime = createOpenAIProviderDecisions("gpt-6-luna", {
      credential: "test-key",
      baseURL: "https://api.openai.com/v1/?routing=test#fragment",
      fetch: (url, init) => {
        seenURL = String(url);
        seenInit = init;
        return Promise.resolve(Response.json(result()));
      },
    });
    const output = await runtime.decide({
      input: [
        { type: "text", text: "Evaluate this sample." },
        { type: "json", data: { count: 2 } },
        { type: "image", url: "https://example.com/sample.png" },
      ],
      questions: [predicate],
      promptCacheKey: "fixture",
    });
    assertEquals(seenURL, "https://api.openai.com/v1/decisions?routing=test");
    assertEquals(new Headers(seenInit?.headers).get("authorization"), "Bearer test-key");
    assertEquals(JSON.parse(seenInit?.body as string), {
      model: "gpt-6-luna",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "Evaluate this sample." },
          { type: "input_json", data: { count: 2 } },
          { type: "input_image", image_url: "https://example.com/sample.png" },
        ],
      }],
      questions: [predicate],
      prompt_cache_key: "fixture",
    });
    assertEquals<unknown>(output.answers, result().answers);
    assertEquals(output.usage, {
      inputTokens: 42,
      outputTokens: 0,
      totalTokens: 42,
      cachedInputTokens: 10,
      cacheCreationInputTokens: 20,
    });
  });

  it("accepts empty structured input", async () => {
    let sent: Record<string, unknown> | undefined;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: (_url, init) => {
        sent = JSON.parse(init?.body as string);
        return Promise.resolve(Response.json(result()));
      },
    });
    await runtime.decide({ input: [], questions: [predicate] });
    assertEquals(sent?.input, [{ role: "user", content: [] }]);
  });

  it("preserves typed choices, ordered scores, and refusals independently", async () => {
    const questions: DecisionQuestion[] = [
      {
        type: "choice",
        name: "selected",
        instructions: "Choose one",
        choices: [{ value: "true" }, { value: true }],
      },
      {
        type: "score",
        name: "quality",
        instructions: "Rate quality",
        levels: [{ label: "low" }, { label: "high" }],
      },
      predicate,
    ];
    const answers = [
      {
        type: "choice",
        name: "selected",
        choice: true,
        confidence: 0.9,
        probabilities: [{ value: true, probability: 0.8 }, { value: "true", probability: 0.2 }],
      },
      {
        type: "score",
        name: "quality",
        score: 0.75,
        confidence: 0.8,
        probabilities: [{ value: 0, label: "low", probability: 0.25 }, {
          value: 1,
          label: "high",
          probability: 0.75,
        }],
      },
      { type: "refusal", name: "relevant" },
    ];
    const output = await runtimeWith(result(answers)).decide({ input: "fixture", questions });
    assertEquals<unknown>(output.answers, answers);
  });

  it("encodes JSON objects and arrays of objects in shared input and question instructions", async () => {
    let sent: Record<string, unknown> | undefined;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: (_url, init) => {
        sent = JSON.parse(init?.body as string);
        return Promise.resolve(Response.json(result()));
      },
    });
    const evidence = [{ score: 1 }, { score: 2, tags: ["sample", null, 3] }] as const;
    const criteria = { threshold: 2, instruction: "Is any score at least the threshold?" };

    await runtime.decide({
      input: [{ type: "json", data: evidence }],
      questions: [{ ...predicate, instructions: [{ type: "json", data: criteria }] }],
    });

    assertEquals(sent?.input, [{
      role: "user",
      content: [{ type: "input_json", data: evidence }],
    }]);
    assertEquals(sent?.questions, [{
      ...predicate,
      instructions: [{ type: "input_json", data: criteria }],
    }]);
  });

  it("rejects malformed questions and unsupported content before sending a request", async () => {
    let calls = 0;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json(result()));
      },
    });
    const invalid: DecisionCallOptions[] = [
      { ...options, questions: [] },
      {
        ...options,
        questions: Array.from(
          { length: 401 },
          (_, index) => ({ ...predicate, name: String(index) }),
        ),
      },
      { ...options, questions: [predicate, predicate] },
      { ...options, questions: [{ ...predicate, name: " " }] },
      {
        ...options,
        questions: [{ ...predicate, type: "choice", choices: [{ value: "a" }, { value: "a" }] }],
      },
      { ...options, questions: [{ ...predicate, type: "score", levels: [{ label: "a" }] }] },
      { ...options, input: [{ type: "image", url: "file:///private/sample.png" }] },
      { ...options, input: [{ type: "json", data: ["not an object"] as never }] },
      { ...options, input: [{ type: "file", url: "https://example.com/sample.pdf" }] as never },
      { ...options, promptCacheKey: "x".repeat(65) },
    ];
    for (const value of invalid) await assertRejects(() => runtime.decide(value), TypeError);
    assertEquals(calls, 0);
  });

  it("does not invoke getters in structured evidence", async () => {
    let reads = 0;
    const data = {
      get value() {
        reads++;
        return "secret";
      },
    };
    await assertRejects(
      () => runtimeWith(result()).decide({ ...options, input: [{ type: "json", data }] }),
      TypeError,
    );
    assertEquals(reads, 0);
  });

  it("rejects missing, duplicate, mismatched, or out-of-range answers", async () => {
    const invalid = [
      result([]),
      result([{ name: "wrong", type: "predicate", probability: 0.8 }]),
      result([{ name: "relevant", type: "predicate", probability: 1.1 }]),
      result([{ name: "relevant", type: "predicate", probability: "0.8" }]),
      result([{ name: "relevant", type: "score", score: 0.8 }]),
      result([...result().answers, ...result().answers]),
      { ...result(), usage: { ...usage, input_tokens: -1 } },
    ];
    for (const payload of invalid) {
      await assertRejects(
        () => runtimeWith(payload).decide(options),
        ProviderRequestError,
        "invalid successful response",
      );
    }
  });

  it("rejects choices outside the allowed set and duplicate distribution values", async () => {
    const question = {
      ...predicate,
      type: "choice",
      choices: [{ value: "a" }, { value: "b" }],
    } as const;
    for (const [choice, values] of [["c", ["a", "b"]], ["a", ["a", "a"]]] as const) {
      const payload = result([{
        name: predicate.name,
        type: "choice",
        choice,
        confidence: 0.9,
        probabilities: values.map((value) => ({ value, probability: 0.5 })),
      }]);
      await assertRejects(
        () => runtimeWith(payload).decide({ ...options, questions: [question] }),
        ProviderRequestError,
      );
    }
  });

  it("accepts sparse choice and score probability arrays", async () => {
    const choice = {
      ...predicate,
      name: "choice",
      type: "choice",
      choices: [{ value: "a" }, { value: "b" }],
    } as const;
    const score = {
      ...predicate,
      name: "score",
      type: "score",
      levels: [{ label: "low" }, { label: "high" }],
    } as const;
    const payload = result([
      {
        name: choice.name,
        type: "choice",
        choice: "a",
        confidence: 0.9,
        probabilities: [],
      },
      {
        name: score.name,
        type: "score",
        score: 0.5,
        confidence: 0.9,
        probabilities: [{ value: 1, label: "high", probability: 0.5 }],
      },
    ]);
    const output = await runtimeWith(payload).decide({
      ...options,
      questions: [choice, score],
    });
    assertEquals(output.answers.length, 2);
  });

  it("accepts documented ten megabyte text input", async () => {
    let calls = 0;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json(result()));
      },
    });
    await runtime.decide({ input: "x".repeat(9_000_000), questions: [predicate] });
    assertEquals(calls, 1);
  });

  it("accepts the documented maximum choice-question shape", async () => {
    let calls = 0;
    const questions = Array.from({ length: 400 }, (_, questionIndex) => ({
      name: `question-${questionIndex}`,
      type: "choice" as const,
      instructions: "Choose one.",
      choices: Array.from({ length: 255 }, (_, choiceIndex) => ({
        value: `choice-${choiceIndex}`,
      })),
    }));
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json({
          model: "gpt-6-luna",
          answers: questions.map((question) => ({ name: question.name, type: "refusal" })),
          usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
        }));
      },
    });
    const output = await runtime.decide({ input: "fixture", questions });
    assertEquals(output.answers.length, 400);
    assertEquals(calls, 1);
  });

  it("rejects score distributions that do not identify the requested levels", async () => {
    const question = {
      ...predicate,
      type: "score",
      levels: [{ label: "low" }, { label: "high" }],
    } as const;
    const payload = result([{
      name: predicate.name,
      type: "score",
      score: 0.5,
      confidence: 0.9,
      probabilities: [{ value: 0, label: "wrong", probability: 0.5 }, {
        value: 1,
        label: "high",
        probability: 0.5,
      }],
    }]);
    await assertRejects(
      () => runtimeWith(payload).decide({ ...options, questions: [question] }),
      ProviderRequestError,
    );
  });

  it("propagates HTTP failures without retrying the model call", async () => {
    let calls = 0;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: () => {
        calls++;
        return Promise.resolve(
          Response.json({ error: { message: "rate limit" } }, { status: 429 }),
        );
      },
    });
    await assertRejects(() => runtime.decide(options), ProviderRateLimitError);
    assertEquals(calls, 1);
  });

  it("cancels an in-flight request using the caller's signal", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | null | undefined;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: (_url, init) => {
        observedSignal = init?.signal;
        controller.abort(new Error("stop fixture"));
        return new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) reject(init.signal.reason);
          else {init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });}
        });
      },
    });
    await assertRejects(
      () => runtime.decide({ ...options, abortSignal: controller.signal }),
      Error,
      "stop fixture",
    );
    assert(observedSignal?.aborted);
  });

  it("rejects missing credentials and invalid endpoint URLs", async () => {
    assertThrows(
      () =>
        new OpenAIProvider().createDecisions("gpt-6-luna", {
          credential: "test-key",
          baseURL: "https://user:password@example.com/v1",
        }),
      TypeError,
      "embedded credentials",
    );
    let calls = 0;
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "",
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json(result()));
      },
    });
    await assertRejects(() => runtime.decide(options), TypeError);
    assertEquals(calls, 0);
  });

  it("does not dispatch an already aborted decision call", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort(new Error("already stopped"));
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json(result()));
      },
    });
    await assertRejects(
      () => runtime.decide({ ...options, abortSignal: controller.signal }),
      Error,
      "already stopped",
    );
    assertEquals(calls, 0);
  });

  it("rejects malformed JSON instead of treating a successful HTTP status as an answer", async () => {
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: () => Promise.resolve(new Response("{malformed")),
    });
    await assertRejects(() => runtime.decide(options), ProviderRequestError, "not valid JSON");
  });

  it("keeps concurrent calls and caller mutations isolated while answers arrive out of order", async () => {
    const pending = new Map<string, (response: Response) => void>();
    const dispatched = Promise.withResolvers<void>();
    const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
      credential: "test-key",
      fetch: (_url, init) =>
        new Promise((resolve) => {
          const body = JSON.parse(init?.body as string);
          pending.set(body.questions[0].name, resolve);
          if (pending.size === 2) dispatched.resolve();
        }),
    });
    const firstQuestion = { ...predicate, name: "first" };
    const first = runtime.decide({ ...options, questions: [firstQuestion] });
    const second = runtime.decide({ ...options, questions: [{ ...predicate, name: "second" }] });
    await dispatched.promise;
    firstQuestion.name = "changed after dispatch";
    pending.get("second")!(
      Response.json(result([{ name: "second", type: "predicate", probability: 0.2 }])),
    );
    assertEquals((await second).answers[0]?.name, "second");
    pending.get("first")!(
      Response.json(result([{ name: "first", type: "predicate", probability: 0.8 }])),
    );
    assertEquals((await first).answers[0]?.name, "first");
  });
});
