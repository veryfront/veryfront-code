import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildConditionalChatTemplateOptions,
  buildConditionalGenerateOptions,
  buildPipeOptions,
  createStopSequenceFilter,
  isOnnxUnavailableError,
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

  it("does NOT silently drop stopSequences — it attaches a stopping_criteria", () => {
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["STOP"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    assertExists(
      opts.stopping_criteria,
      "stopSequences must be forwarded via the stopping_criteria option",
    );
    assertEquals(opts.stopping_criteria instanceof FakeStoppingCriteriaList, true);
  });

  it("builds a stopping criterion that triggers when a stop sequence is produced", () => {
    // tokens [18,19,14,15] decode to "stop" with the fake tokenizer
    // (s=18, t=19, o=14, p=15). Use uppercase-insensitive match by checking
    // the literal decoded string.
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["stop"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    const prompt = [0, 1];
    // Transformers invokes stopping criteria after appending the first token.
    assertEquals(list._call([[...prompt, 18]], null), [false]); // "s"
    assertEquals(list._call([[...prompt, 18, 19, 14]], null), [false]); // "sto"
    assertEquals(list._call([[...prompt, 18, 19, 14, 15]], null), [true]); // "stop"
  });

  it("can stop on the very first generated token", () => {
    const opts = buildPipeOptions(
      { stopSequences: ["s"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;
    assertEquals(list._call([[0, 1, 18]], null), [true]);
  });

  it("does NOT trigger when the stop sequence is only in the prompt, not the generated suffix", () => {
    // Stop string "stop" lives entirely inside the prompt. The criterion must
    // not trip until the model actually generates the stop string.
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["stop"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;

    // Prompt tokens [18,19,14,15] decode to "stop". The real first call also
    // contains the first generated token, which establishes the boundary.
    const prompt = [18, 19, 14, 15]; // "stop"
    assertEquals(list._call([[...prompt, 6]], null), [false]); // generated "g"

    // Model completes "go" — suffix has no stop string → continue.
    assertEquals(list._call([[...prompt, 6, 14]], null), [false]);

    // Model now generates "stop" in the suffix → must stop, even though the
    // prompt also contained "stop".
    assertEquals(list._call([[...prompt, 6, 14, 18, 19, 14, 15]], null), [true]);
  });

  it("tracks prompt length per batch item independently", () => {
    const opts = buildPipeOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["stop"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
    );

    // deno-lint-ignore no-explicit-any
    const list = opts.stopping_criteria as any;

    // Two batch items with different prompt lengths, both mentioning "stop".
    const promptA = [18, 19, 14, 15]; // "stop"
    const promptB = [6, 14, 18, 19, 14, 15]; // "gostop"
    assertEquals(list._call([[...promptA, 18], [...promptB, 6]], null), [false, false]);

    // Item 0 generates "stop" → stop; item 1 generates "go" → continue.
    assertEquals(
      list._call([[...promptA, 18, 19, 14, 15], [...promptB, 6, 14]], null),
      [true, false],
    );
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

  it("forwards stopSequences for conditional-generation models", () => {
    const opts = buildConditionalGenerateOptions(
      { maxNewTokens: 64, temperature: 0.7, stopSequences: ["STOP"] },
      fakeTransformers,
      fakeTokenizer,
      "streamer-sentinel",
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

  it("does not classify model URLs containing ONNX as native runtime failures", () => {
    assertEquals(
      isOnnxUnavailableError(
        'Could not locate file: "https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX/config.json".',
      ),
      false,
    );
    assertEquals(
      isOnnxUnavailableError(
        "ERR_DLOPEN_FAILED: could not load onnxruntime_binding.node",
      ),
      true,
    );
  });
});
