import "#veryfront/schemas/_test-setup.ts";
import {
  hasSyntheticMessageId,
  hasSyntheticMessageTimestamp,
  hasUnchangedSyntheticMessageId,
  hasUnchangedSyntheticMessageTimestamp,
  normalizeInput,
  propagateSyntheticMessageMarks,
} from "#veryfront/agent/runtime/input-utils.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private message provenance ${hooks ? "hooks" : "baseline"}`, () => {
    it("preserves normalization marks without exposing messages through weak collections", () => {
      const marker = "synthetic-private-normalized-message";
      const apply = Reflect.apply;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const defineProperty = Object.defineProperty;
      const methods = [
        { target: WeakMap.prototype, key: "get" },
        { target: WeakMap.prototype, key: "set" },
        { target: WeakSet.prototype, key: "has" },
        { target: WeakSet.prototype, key: "add" },
      ].map((entry) => ({
        ...entry,
        descriptor: Object.getOwnPropertyDescriptor(entry.target, entry.key)!,
      }));
      let observations = 0;
      let generated, normalized, copied;
      let idMarked, timeMarked, idUnchanged, timeUnchanged;
      try {
        if (hooks) {
          for (const method of methods) {
            defineProperty(method.target, method.key, {
              ...method.descriptor,
              value: function (this: unknown, ...args: unknown[]) {
                if (apply(includes, stringify(args[0]) ?? "", [marker])) observations++;
                return apply(method.descriptor.value, this, args);
              },
            });
          }
        }
        generated = normalizeInput(marker)[0]!;
        normalized = normalizeInput([generated])[0]!;
        copied = { ...normalized };
        propagateSyntheticMessageMarks(normalized, copied);
        idMarked = hasSyntheticMessageId(copied);
        timeMarked = hasSyntheticMessageTimestamp(copied);
        idUnchanged = hasUnchangedSyntheticMessageId(copied, copied.id);
        timeUnchanged = hasUnchangedSyntheticMessageTimestamp(copied, copied.timestamp);
      } finally {
        for (const method of methods) defineProperty(method.target, method.key, method.descriptor);
      }
      assertEquals(observations, 0);
      assertEquals(normalized?.parts, [{ type: "text", text: marker }]);
      assertEquals(copied, generated);
      assertEquals([idMarked, timeMarked, idUnchanged, timeUnchanged], [true, true, true, true]);
    });
  });
}
