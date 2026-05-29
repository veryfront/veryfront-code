import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildPipeOptions } from "./local-engine.ts";

/**
 * Minimal stand-ins for Transformers.js StoppingCriteria primitives. These
 * mirror the real `StoppingCriteria` / `StoppingCriteriaList` contracts so we
 * can verify that `buildPipeOptions` forwards `stopSequences` through the
 * library's documented `stopping_criteria` mechanism (Transformers.js 3.8.1
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
    // input_ids: batch of 1, decodes to "stop"
    const stopIds = [[18, 19, 14, 15]];
    const result = list._call(stopIds, null);
    assertEquals(result, [true]);

    // A sequence that does not contain the stop string must NOT stop.
    const goIds = [[6, 14]]; // "go"
    assertEquals(list._call(goIds, null), [false]);
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
});
