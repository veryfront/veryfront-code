import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ModuleSourceCapture } from "./module-source-capture.ts";

const url = "file:///capture/entry.mjs";
const source = "export const value = '😀';";
const limits = { maxEntries: 2, maxBytes: 1024 };

describe("ModuleSourceCapture", () => {
  it("keeps an incomplete borrowed capture unusable without failing other producers", () => {
    const capture = new ModuleSourceCapture(limits);
    capture.record(url, source);
    capture.invalidate();
    capture.record("file:///later.mjs", "export {};");
    assertThrows(() => capture.take(), Error, "incomplete");
  });

  it("deduplicates identical sources and transfers a frozen snapshot once", () => {
    const capture = new ModuleSourceCapture(limits);
    capture.record(url, source);
    capture.record(url, source);
    const modules = capture.take();
    assertEquals(modules, [{ url, source }]);
    assertEquals(Object.isFrozen(modules), true);
    assertEquals(Object.isFrozen(modules[0]), true);
    capture.record("file:///late.mjs", "late");
    assertEquals(modules, [{ url, source }], "late shared work cannot mutate a completed snapshot");
    assertThrows(() => capture.take(), Error, "closed");
  });

  it("invalidates the whole capture when one module changes without failing its producer", () => {
    const capture = new ModuleSourceCapture(limits);
    capture.record(url, source);
    capture.record(url, "export const value = 'changed';");
    capture.record(url, source);
    assertThrows(() => capture.take(), Error, "changed during capture");
  });

  it("bounds retained UTF-8 URL and source bytes with inclusive limits", () => {
    const maxBytes = new TextEncoder().encode(url + source).length;
    const exact = new ModuleSourceCapture({ maxEntries: 1, maxBytes });
    exact.record(url, source);
    exact.record(url, source);
    assertEquals(exact.take(), [{ url, source }]);
    const over = new ModuleSourceCapture({ maxEntries: 1, maxBytes: maxBytes - 1 });
    over.record(url, source);
    assertThrows(() => over.take(), Error, "byte budget");
  });

  it("rejects excess entries and invalid UTF-8 without throwing into shared work", () => {
    const capture = new ModuleSourceCapture({ ...limits, maxEntries: 1 });
    capture.record(url, source);
    capture.record("file:///other.mjs", "");
    assertThrows(() => capture.take(), Error, "entry budget");
    for (const [key, value] of [[url, "\uD800"], ["\uD800", source]]) {
      const invalid = new ModuleSourceCapture(limits);
      invalid.record(key!, value!);
      assertThrows(() => invalid.take(), Error, "UTF-8");
    }
  });

  it("discards partial capture on cancellation and ignores late writes", () => {
    const capture = new ModuleSourceCapture(limits);
    capture.record(url, source);
    capture.discard();
    capture.discard();
    capture.record(url, "changed");
    assertThrows(() => capture.take(), Error, "closed");
  });

  it("snapshots budgets and rejects invalid settings before work starts", () => {
    const budget = { ...limits };
    const capture = new ModuleSourceCapture(budget);
    budget.maxBytes = 1;
    capture.record(url, source);
    assertEquals(capture.take(), [{ url, source }]);
    for (const value of [0, -1, NaN, Infinity, 1.5]) {
      assertThrows(() => new ModuleSourceCapture({ ...limits, maxBytes: value }), RangeError);
      assertThrows(() => new ModuleSourceCapture({ ...limits, maxEntries: value }), RangeError);
    }
  });
});
