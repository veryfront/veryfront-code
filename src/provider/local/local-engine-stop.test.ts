import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertValidChatMessages,
  buildConditionalChatTemplateOptions,
  buildConditionalGenerateOptions,
  buildPipeOptions,
  createStopSequenceController,
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

  it("rejects unsafe generation option values", () => {
    for (
      const options of [
        { maxNewTokens: 0 },
        { maxNewTokens: Number.POSITIVE_INFINITY },
        { temperature: Number.NaN },
        { topP: 2 },
        { topK: 1.5 },
      ]
    ) {
      let threw = false;
      try {
        buildPipeOptions(options, fakeTransformers, fakeTokenizer, "streamer-sentinel");
      } catch (error) {
        threw = error instanceof RangeError;
      }
      assertEquals(threw, true);
    }
  });

  it("rejects malformed and oversized direct engine messages", () => {
    assertThrows(
      () => assertValidChatMessages([]),
      RangeError,
      "at least one message",
    );
    assertThrows(
      () => assertValidChatMessages([{ role: "tool", content: "invalid" }] as never),
      TypeError,
      "invalid role",
    );
    assertThrows(
      () => assertValidChatMessages([{ role: "user", content: "x".repeat(4 * 1_024 * 1_024 + 1) }]),
      RangeError,
      "supported size",
    );
  });

  it("stops generation after cancellation", () => {
    const controller = new AbortController();
    const opts = buildPipeOptions(
      { abortSignal: controller.signal },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );
    const list = opts.stopping_criteria as FakeStoppingCriteriaList;

    controller.abort();
    assertEquals(list._call([[1]], undefined), [true]);
  });

  it("does NOT silently drop stopSequences - it attaches a stopping_criteria", () => {
    const stopController = createStopSequenceController(["STOP"]);
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["STOP"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
      stopController,
    );

    assertExists(
      opts.stopping_criteria,
      "stopSequences must be forwarded via the stopping_criteria option",
    );
    assertEquals(opts.stopping_criteria instanceof FakeStoppingCriteriaList, true);
  });

  it("builds a stopping criterion that triggers when a stop sequence is produced", () => {
    const stopController = createStopSequenceController(["stop"]);
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["stop"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
      stopController,
    );

    const list = opts.stopping_criteria as FakeStoppingCriteriaList;
    stopController.push("sto");
    assertEquals(list._call([[1]], null), [false]);
    stopController.push("p");
    assertEquals(list._call([[1, 2]], null), [true]);
  });

  it("filters a stop sequence split across streamed chunks", () => {
    const stopController = createStopSequenceController(["STOP"]);
    const output = stopController.push("hello ST") + stopController.push("OP ignored");

    assertEquals(output, "hello ");
    assertEquals(stopController.stopped, true);
    assertEquals(stopController.finish(), "");
  });

  it("flushes a trailing partial match when generation finishes", () => {
    const stopController = createStopSequenceController(["STOP"]);

    assertEquals(stopController.push("hello ST"), "hello");
    assertEquals(stopController.finish(), " ST");
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

  it("forwards stopSequences for conditional-generation models", () => {
    const stopController = createStopSequenceController(["STOP"]);
    const opts = buildConditionalGenerateOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["STOP"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
      stopController,
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
});
