import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  mergeToolCallInput,
  mergeToolInputDelta,
  parseToolInputObject,
  stripLeadingEmptyObjectPlaceholder,
} from "#veryfront/agent/streaming/tool-input.ts";

for (const hooks of [false, true]) {
  describe(`private tool input ${hooks ? "hooks" : "baseline"}`, () => {
    it("normalizes complete and fragmented arguments without mutable string calls", () => {
      const marker = "synthetic-private-tool-input";
      const raw = JSON.stringify({ query: marker });
      const split = raw.indexOf(marker) + 8;
      const first = raw.slice(0, split);
      const second = raw.slice(split);
      const trim = String.prototype.trim;
      const trimStart = String.prototype.trimStart;
      const startsWith = String.prototype.startsWith;
      const endsWith = String.prototype.endsWith;
      const slice = String.prototype.slice;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      const observe = (value: unknown) => {
        if (apply(includes, value, [marker])) observations++;
      };
      let normalized = "";
      let merged = "";
      let completed = "";
      let parsed: Record<string, unknown> = {};
      try {
        if (hooks) {
          String.prototype.trim = function () {
            observe(this);
            return apply(trim, this, []);
          };
          String.prototype.trimStart = function () {
            observe(this);
            return apply(trimStart, this, []);
          };
          String.prototype.startsWith = function (...args) {
            observe(this);
            return apply(startsWith, this, args);
          };
          String.prototype.endsWith = function (...args) {
            observe(this);
            return apply(endsWith, this, args);
          };
          String.prototype.slice = function (...args) {
            observe(this);
            return apply(slice, this, args);
          };
        }
        normalized = stripLeadingEmptyObjectPlaceholder(` {} {} ${raw} `);
        merged = mergeToolInputDelta(first, second);
        completed = mergeToolCallInput(raw, " {} ");
        parsed = parseToolInputObject(`{}${raw}`);
      } finally {
        if (hooks) {
          String.prototype.trim = trim;
          String.prototype.trimStart = trimStart;
          String.prototype.startsWith = startsWith;
          String.prototype.endsWith = endsWith;
          String.prototype.slice = slice;
        }
      }
      assertEquals(normalized, raw);
      assertEquals(merged, raw);
      assertEquals(completed, raw);
      assertEquals(parsed, { query: marker });
      assertEquals(observations, 0);
    });
  });
}
