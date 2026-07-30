import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";
import {
  buildConditionalChatTemplateOptions,
  buildConditionalGenerateOptions,
  buildPipeOptions,
  createBoundedTextQueue,
  createStopSequenceFilter,
  createStopSequenceMatcher,
} from "./local-engine.ts";

const LOCAL_AI_THINKING_ENV = "VERYFRONT_LOCAL_AI_THINKING";
const originalThinkingEnv = Deno.env.get(LOCAL_AI_THINKING_ENV);

function restoreThinkingEnv(): void {
  if (originalThinkingEnv === undefined) {
    Deno.env.delete(LOCAL_AI_THINKING_ENV);
  } else {
    Deno.env.set(LOCAL_AI_THINKING_ENV, originalThinkingEnv);
  }
}

/**
 * Minimal stand-ins for Transformers.js StoppingCriteria primitives. These
 * mirror the real `StoppingCriteria` / `StoppingCriteriaList` contracts so we
 * can verify that `buildPipeOptions` forwards `stopSequences` through the
 * library's documented `stopping_criteria` mechanism (Transformers.js 3.x
 * has no `stop_strings` generate option).
 */
class FakeStoppingCriteria {
  // deno-lint-ignore no-explicit-any
  _call(_input_ids: any, _scores: any): boolean[] {
    return [];
  }
}

class FakeStoppingCriteriaList {
  // deno-lint-ignore no-explicit-any
  criteria: any[] = [];
  // deno-lint-ignore no-explicit-any
  push(item: any) {
    this.criteria.push(item);
  }
  // deno-lint-ignore no-explicit-any
  extend(items: any) {
    this.criteria.push(...items);
  }
  // deno-lint-ignore no-explicit-any
  _call(input_ids: any, scores: any): boolean[] {
    const isDone = new Array(input_ids.length).fill(false);
    for (const c of this.criteria) {
      const done = c._call ? c._call(input_ids, scores) : c(input_ids, scores);
      for (let i = 0; i < isDone.length; ++i) isDone[i] ||= done[i];
    }
    return isDone;
  }
}

// A tokenizer whose decode just maps token ids to letters a, b, c, ...
const fakeTokenizer = {
  decode(tokens: number[]): string {
    return tokens.map((t) => String.fromCharCode(97 + t)).join("");
  },
};

// deno-lint-ignore no-explicit-any
const fakeTransformers: any = {
  StoppingCriteria: FakeStoppingCriteria,
  StoppingCriteriaList: FakeStoppingCriteriaList,
};

type TestTerminationState = { finishReason?: "stop" | "length" };

function buildTestPipeOptions(
  options: Parameters<typeof buildPipeOptions>[0],
  settings: {
    tokenizer?: unknown;
    knownPromptLengths?: readonly number[];
    terminationState?: TestTerminationState;
    eosTokenIds?: readonly (number | bigint)[];
  } = {},
) {
  const stopMatcher = options.stopSequences?.length
    ? createStopSequenceMatcher(options.stopSequences)
    : undefined;
  const pipeOptions = buildPipeOptions(
    options,
    fakeTransformers,
    settings.tokenizer ?? fakeTokenizer,
    "streamer-sentinel",
    settings.knownPromptLengths,
    settings.terminationState,
    settings.eosTokenIds,
    stopMatcher,
  );
  return { pipeOptions, stopMatcher };
}

describe("provider/local/local-engine buildPipeOptions", () => {
  afterEach(() => {
    restoreThinkingEnv();
  });

  it("forwards core sampling options to the pipe options", () => {
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.3, topP: 0.9, topK: 40 },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    assertEquals(opts.max_new_tokens, 64);
    assertEquals(opts.temperature, 0.3);
    assertEquals(opts.top_p, 0.9);
    assertEquals(opts.top_k, 40);
    assertEquals(opts.do_sample, true);
    assertEquals(opts.streamer, "streamer-sentinel");
  });

  it("does NOT silently drop stopSequences — it attaches a stopping_criteria", () => {
    const { pipeOptions: opts } = buildTestPipeOptions({
      maxNewTokens: 64,
      temperature: 0.7,
      stopSequences: ["STOP"],
    });

    assertExists(
      opts.stopping_criteria,
      "stopSequences must be forwarded via the stopping_criteria option",
    );
    assertEquals(opts.stopping_criteria instanceof FakeStoppingCriteriaList, true);
  });

  it("fails closed when stop options are built without their stream matcher", () => {
    assertThrows(
      () =>
        buildPipeOptions(
          { stopSequences: ["STOP"] },
          fakeTransformers,
          fakeTokenizer,
          "streamer-sentinel",
        ),
      TypeError,
      "decoded-stream stop matcher",
    );
  });

  it("retains hard bounds while building the incremental matcher", () => {
    assertThrows(
      () => createStopSequenceMatcher(["x".repeat(257)]),
      RangeError,
      "no more than 256 characters",
    );
    assertThrows(
      () => createStopSequenceMatcher(Array(17).fill("x")),
      RangeError,
      "no more than 16 entries",
    );
  });

  it("builds a stopping criterion that triggers when a stop sequence is produced", () => {
    const { pipeOptions: opts, stopMatcher } = buildTestPipeOptions({
      maxNewTokens: 64,
      temperature: 0.7,
      stopSequences: ["stop"],
    });

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    const prompt = [0, 1];
    stopMatcher!.push(0, "s");
    assertEquals(list._call([[...prompt, 18]], null), [false]);
    stopMatcher!.push(0, "to");
    assertEquals(list._call([[...prompt, 18, 19, 14]], null), [false]);
    stopMatcher!.push(0, "p");
    assertEquals(list._call([[...prompt, 18, 19, 14, 15]], null), [true]);
  });

  it("can stop on the very first generated token", () => {
    const { pipeOptions: opts, stopMatcher } = buildTestPipeOptions({
      stopSequences: ["s"],
    });

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    stopMatcher!.push(0, "s");
    assertEquals(list._call([[0, 1, 18]], null), [true]);
  });

  it("does NOT trigger when the stop sequence is only in the prompt, not the generated suffix", () => {
    const { pipeOptions: opts, stopMatcher } = buildTestPipeOptions({
      maxNewTokens: 64,
      temperature: 0.7,
      stopSequences: ["stop"],
    });

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;

    // The streamer has skip_prompt enabled, so only generated text is fed to
    // the matcher even when the token ids contain the stop string in the prompt.
    const prompt = [18, 19, 14, 15]; // "stop"
    stopMatcher!.push(0, "g");
    assertEquals(list._call([[...prompt, 6]], null), [false]); // generated "g"

    stopMatcher!.push(0, "o");
    assertEquals(list._call([[...prompt, 6, 14]], null), [false]);

    stopMatcher!.push(0, "stop");
    assertEquals(list._call([[...prompt, 6, 14, 18, 19, 14, 15]], null), [true]);
  });

  it("tracks prompt length per batch item independently", () => {
    const { pipeOptions: opts, stopMatcher } = buildTestPipeOptions({
      maxNewTokens: 64,
      temperature: 0.7,
      stopSequences: ["stop"],
    });

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;

    // Two batch items with different prompt lengths, both mentioning "stop".
    const promptA = [18, 19, 14, 15]; // "stop"
    const promptB = [6, 14, 18, 19, 14, 15]; // "gostop"
    stopMatcher!.push(0, "s");
    stopMatcher!.push(1, "g");
    assertEquals(list._call([[...promptA, 18], [...promptB, 6]], null), [false, false]);

    // Item 0 generates "stop" → stop; item 1 generates "go" → continue.
    stopMatcher!.push(0, "top");
    stopMatcher!.push(1, "o");
    assertEquals(
      list._call([[...promptA, 18, 19, 14, 15], [...promptB, 6, 14]], null),
      [true, false],
    );
  });

  it("matches split, overlapping, Unicode, and multi-batch decoded chunks", () => {
    const matcher = createStopSequenceMatcher(["STOP", "aab", "🙂終"]);

    assertEquals(matcher.push(0, "ST"), false);
    assertEquals(matcher.push(0, "OP"), true);

    assertEquals(matcher.push(1, "aaa"), false);
    assertEquals(matcher.push(1, "b"), true, "failure links preserve overlapping prefixes");

    assertEquals(matcher.push(2, "prefix \uD83D"), false);
    assertEquals(matcher.push(3, "safe"), false);
    assertEquals(matcher.push(2, "\uDE42"), false, "surrogate pairs may straddle chunks");
    assertEquals(matcher.push(2, "終 suffix"), true);
    assertEquals(matcher.hasMatched(3), false, "batch matcher state must remain independent");

    assertEquals(
      matcher.processedCharacters,
      2 + 2 + 3 + 1 + 8 + 4 + 1 + 1,
      "each decoded UTF-16 code unit is examined at most once",
    );
  });

  it("handles 32K leading-space BPE chunks with strictly linear matching work", () => {
    let decodeCalls = 0;
    const termination: { finishReason?: "stop" | "length" } = {};
    const { pipeOptions: opts, stopMatcher } = buildTestPipeOptions(
      { maxNewTokens: 32_768, stopSequences: ["never-match"] },
      {
        terminationState: termination,
        tokenizer: {
          decode(tokens: number[]): string {
            decodeCalls += 1;
            return fakeTokenizer.decode(tokens);
          },
        },
      },
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    const ids = [8, 9];
    for (let generated = 0; generated < 32_768; generated++) {
      ids.push(0);
      assertEquals(stopMatcher!.push(0, " word"), false);
      assertEquals(list._call([ids], null), [false]);
    }
    assertEquals(termination.finishReason, "length");
    assertEquals(decodeCalls, 0, "stopping criteria must never re-decode token prefixes");
    assertEquals(stopMatcher!.processedCharacters, 32_768 * " word".length);
  });

  it("matches the pinned TextStreamer output for 2K leading-space BPE tokens", async () => {
    const { TextStreamer } = await import("@huggingface/transformers");
    const matcher = createStopSequenceMatcher(["never-match"]);
    let streamed = "";
    const tokenizer = {
      all_special_ids: [],
      decode(tokens: readonly bigint[]): string {
        return tokens.map(() => " word").join("");
      },
    };
    const streamer = new TextStreamer(tokenizer as never, {
      skip_prompt: true,
      skip_special_tokens: true,
      decode_kwargs: { clean_up_tokenization_spaces: false },
      callback_function(text: string): void {
        streamed += text;
        matcher.push(0, text);
      },
    });

    streamer.put([[99n]]);
    for (let token = 0; token < 2_048; token++) {
      streamer.put([[1n]]);
    }
    streamer.end();

    assertEquals(streamed, " word".repeat(2_048));
    assertEquals(matcher.hasMatched(0), false);
    assertEquals(matcher.processedCharacters, streamed.length);
  });

  it("uses an abort signal as a generation stopping criterion", () => {
    const abortController = new AbortController();
    let decodeCalls = 0;
    const opts = buildPipeOptions(
      { abortSignal: abortController.signal },
      fakeTransformers,
      {
        decode(tokens: number[]): string {
          decodeCalls += 1;
          return fakeTokenizer.decode(tokens);
        },
      },
      "streamer-sentinel",
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    assertEquals(list._call([[0, 1, 2]], null), [false]);
    assertEquals(list._call([[0, 1, 2, 3]], null), [false]);
    assertEquals(decodeCalls, 0, "abort-only criteria must not repeatedly decode generated text");
    abortController.abort(new DOMException("cancelled", "AbortError"));
    assertEquals(list._call([[0, 1, 2, 3, 4]], null), [true]);
  });

  it("omits stopping_criteria entirely when no stopSequences are given", () => {
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.7 },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    assertEquals("stopping_criteria" in opts, false);
  });

  it("records length when generation reaches the configured new-token bound", () => {
    const termination: { finishReason?: "stop" | "length" } = {};
    const opts = buildPipeOptions(
      { maxNewTokens: 3 },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
      undefined,
      termination,
      [99],
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    const prompt = [8, 9];
    assertEquals(list._call([[...prompt, 0]], null), [false]);
    assertEquals(list._call([[...prompt, 0, 1, 2]], null), [false]);
    assertEquals(termination.finishReason, "length");
  });

  it("records EOS as stop even when it lands on the token bound", () => {
    const termination: { finishReason?: "stop" | "length" } = {};
    const opts = buildPipeOptions(
      { maxNewTokens: 3 },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
      undefined,
      termination,
      [99],
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    const prompt = [8, 9];
    assertEquals(list._call([[...prompt, 0]], null), [false]);
    assertEquals(list._call([[...prompt, 0, 1, 99]], null), [false]);
    assertEquals(termination.finishReason, "stop");
  });

  it("forwards stopSequences for conditional-generation models", () => {
    const stopMatcher = createStopSequenceMatcher(["STOP"]);
    const opts = buildConditionalGenerateOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["STOP"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
      undefined,
      undefined,
      [],
      stopMatcher,
    );

    assertExists(
      opts.stopping_criteria,
      "conditional-generation stopSequences must be forwarded via stopping_criteria",
    );
    assertEquals(opts.stopping_criteria instanceof FakeStoppingCriteriaList, true);
  });

  it("omits conditional stopping_criteria when no stopSequences are given", () => {
    const opts = buildConditionalGenerateOptions(
      { maxNewTokens: 64, temperature: 0.7 },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    assertEquals("stopping_criteria" in opts, false);
  });

  it("keeps Gemma4 thinking disabled by default", () => {
    Deno.env.delete(LOCAL_AI_THINKING_ENV);

    assertEquals(
      buildConditionalChatTemplateOptions({ modelClass: "gemma4" }),
      {
        add_generation_prompt: true,
        enable_thinking: false,
      },
    );
  });

  it("enables Gemma4 thinking when explicitly requested", () => {
    Deno.env.set(LOCAL_AI_THINKING_ENV, "1");

    assertEquals(
      buildConditionalChatTemplateOptions({ modelClass: "gemma4" }),
      {
        add_generation_prompt: true,
        enable_thinking: true,
      },
    );
  });

  it("does not pass thinking options to non-Gemma conditional models", () => {
    Deno.env.set(LOCAL_AI_THINKING_ENV, "1");

    assertEquals(
      buildConditionalChatTemplateOptions({ modelClass: "qwen3_5" }),
      {
        add_generation_prompt: true,
      },
    );
  });

  it("suppresses stop sequences split across streamer chunks", () => {
    const filter = createStopSequenceFilter(["STOP"]);
    assertEquals(filter.push("hello ST"), "hello ");
    assertEquals(filter.push("OP trailing text"), "");
    assertEquals(filter.finish(), "");
  });

  it("flushes a partial stop prefix when generation ends normally", () => {
    const filter = createStopSequenceFilter(["STOP"]);
    assertEquals(filter.push("hello ST"), "hello ");
    assertEquals(filter.finish(), "ST");
  });

  it("bounds streamer buffering by chunks and characters while draining by index", () => {
    const queue = createBoundedTextQueue(3, 5);
    assertEquals(queue.capacity, 3);
    assertEquals(queue.enqueue("ab"), true);
    assertEquals(queue.enqueue("cd"), true);
    assertEquals(queue.enqueue("e"), true);
    assertEquals(queue.size, 3);
    assertEquals(queue.bufferedCharacters, 5);
    assertEquals(queue.enqueue("f"), false);

    assertEquals(queue.dequeue(), "ab");
    assertEquals(queue.bufferedCharacters, 3);
    assertEquals(queue.enqueue("fg"), true);
    assertEquals(queue.enqueue("overflow"), false);
    assertEquals(queue.dequeue(), "cd");
    assertEquals(queue.dequeue(), "e");
    assertEquals(queue.dequeue(), "fg");
    assertEquals(queue.dequeue(), undefined);
    assertEquals(queue.size, 0);
    assertEquals(queue.bufferedCharacters, 0);
  });

  it("keeps fixed ring storage under a sustained non-empty backlog", () => {
    const queue = createBoundedTextQueue(3, 1_000_000);
    for (let value = 0; value < 3; value++) {
      assertEquals(queue.enqueue(String(value)), true);
    }

    for (let nextValue = 3; nextValue < 10_003; nextValue++) {
      assertEquals(queue.dequeue(), String(nextValue - 3));
      assertEquals(queue.enqueue(String(nextValue)), true);
      assertEquals(queue.size, 3);
      assertEquals(queue.capacity, 3);
    }

    assertEquals(queue.enqueue("overflow"), false);
    assertEquals(queue.dequeue(), "10000");
    assertEquals(queue.dequeue(), "10001");
    assertEquals(queue.dequeue(), "10002");
    assertEquals(queue.dequeue(), undefined);
    assertEquals(queue.capacity, 3);
  });

  it("rejects ring capacities above the production ceiling before allocation", () => {
    assertThrows(
      () => createBoundedTextQueue(257, 1_000),
      RangeError,
      "no greater than 256",
    );
    assertThrows(
      () => createBoundedTextQueue(Number.MAX_SAFE_INTEGER, 1_000),
      RangeError,
      "no greater than 256",
    );
  });
});
