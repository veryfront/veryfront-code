import { assertEquals } from "#veryfront/testing/assert.ts";
import { createNoneSkillSelectorSnapshot, resolveSkillSelector } from "./selector.ts";
import {
  SKILL_ID_MAX_LENGTH,
  SKILL_SELECTOR_MAX_DEFINITIONS,
  SKILL_SELECTOR_MAX_ENTRIES,
} from "./limits.ts";

function withInheritedArrayIndexSetter<T>(
  index: number,
  operation: () => T,
): { result: T; setterCalls: number } {
  const key = String(index);
  const original = Object.getOwnPropertyDescriptor(Array.prototype, key);
  let setterCalls = 0;
  Object.defineProperty(Array.prototype, key, {
    configurable: true,
    set: () => {
      setterCalls += 1;
    },
  });
  try {
    return { result: operation(), setterCalls };
  } finally {
    if (original) {
      Object.defineProperty(Array.prototype, key, original);
    } else {
      Reflect.deleteProperty(Array.prototype, key);
    }
  }
}

Deno.test("skill selector snapshots are immutable authorization values", () => {
  const definitions = [
    { id: "agent--one", shortName: "one", sourcePath: "skills/one/SKILL.md" },
  ];
  const snapshot = resolveSkillSelector({
    definitions,
    selector: ["one", "unavailable"],
    getId: (definition) => definition.id,
    isVisible: () => true,
    getShortName: (definition) => definition.shortName,
    getSourcePath: (definition) => definition.sourcePath,
  });

  definitions.push({
    id: "agent--late",
    shortName: "late",
    sourcePath: "skills/late/SKILL.md",
  });

  assertEquals(snapshot.allowedSkillIds, ["agent--one"]);
  assertEquals(snapshot.skillSourcePaths, {
    "agent--one": "skills/one/SKILL.md",
  });
  assertEquals(snapshot.unresolvedEntries, [{ index: 1 }]);
  assertEquals(Object.isFrozen(snapshot), true);
  assertEquals(Object.isFrozen(snapshot.policy), true);
  assertEquals(
    snapshot.policy.kind === "allowlist" && Object.isFrozen(snapshot.policy.entries),
    true,
  );
  assertEquals(Object.isFrozen(snapshot.definitions), true);
  assertEquals(Object.isFrozen(snapshot.allowedSkillIds), true);
  assertEquals(Object.isFrozen(snapshot.skillSourcePaths), true);
  assertEquals(Object.isFrozen(snapshot.unresolvedEntries), true);
  assertEquals(Object.isFrozen(snapshot.unresolvedEntries[0]), true);
});

Deno.test("explicit-none skill selector snapshots share no mutable containers", () => {
  const first = createNoneSkillSelectorSnapshot();
  const second = createNoneSkillSelectorSnapshot();

  assertEquals(first, second);
  assertEquals(Object.isFrozen(first), true);
  assertEquals(Object.isFrozen(first.policy), true);
  assertEquals(Object.isFrozen(first.definitions), true);
  assertEquals(Object.isFrozen(first.allowedSkillIds), true);
  assertEquals(Object.isFrozen(first.skillSourcePaths), true);
  assertEquals(Object.isFrozen(first.unresolvedEntries), true);
  assertEquals(first.definitions === second.definitions, false);
  assertEquals(first.allowedSkillIds === second.allowedSkillIds, false);
});

Deno.test("skill selector construction ignores inherited numeric array setters", () => {
  const definition = {
    id: "agent--one",
    shortName: "one",
    sourcePath: "skills/one/SKILL.md",
  };
  const definitions = [definition];
  const selector = ["one", "unavailable"];

  const { result: snapshot, setterCalls } = withInheritedArrayIndexSetter(
    0,
    () =>
      resolveSkillSelector({
        definitions,
        selector,
        getId: (candidate) => candidate.id,
        isVisible: () => true,
        getShortName: (candidate) => candidate.shortName,
        getSourcePath: (candidate) => candidate.sourcePath,
      }),
  );

  assertEquals(setterCalls, 0);
  assertEquals(snapshot.definitions, [definition]);
  assertEquals(snapshot.allowedSkillIds, ["agent--one"]);
  assertEquals(snapshot.unresolvedEntries, [{ index: 1 }]);
});

Deno.test("skill selector visibility does not depend on mutable Array methods", () => {
  const originalFilter = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "filter",
  );
  let filterCalls = 0;
  let snapshot: ReturnType<typeof resolveSkillSelector> | undefined;
  Object.defineProperty(Array.prototype, "filter", {
    configurable: true,
    value(this: unknown[]) {
      filterCalls += 1;
      return this;
    },
    writable: true,
  });

  try {
    snapshot = resolveSkillSelector({
      definitions: [{ id: "other-agent--secret" }],
      selector: true,
      getId: (definition) => definition.id,
      isVisible: () => false,
    });
  } finally {
    if (originalFilter) {
      Object.defineProperty(Array.prototype, "filter", originalFilter);
    } else {
      Reflect.deleteProperty(Array.prototype, "filter");
    }
  }

  assertEquals(filterCalls, 0);
  assertEquals(snapshot?.definitions, []);
  assertEquals(snapshot?.allowedSkillIds, []);
});

Deno.test("skill selector rejects accessor entries under descriptor prototype pollution", () => {
  const definitions: Array<{ id: string }> = [];
  let definitionGetterCalls = 0;
  Object.defineProperty(definitions, "0", {
    configurable: true,
    enumerable: true,
    get() {
      definitionGetterCalls += 1;
      return { id: "other-agent--secret" };
    },
  });

  const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  const originalHasOwnProperty = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "hasOwnProperty",
  );
  let prototypeHookCalls = 0;
  let failure: unknown;
  try {
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        prototypeHookCalls += 1;
        return { id: "other-agent--secret" };
      },
    });
    Object.defineProperty(Object.prototype, "hasOwnProperty", {
      configurable: true,
      value() {
        prototypeHookCalls += 1;
        return true;
      },
      writable: true,
    });
    try {
      resolveSkillSelector({
        definitions,
        selector: true,
        getId: (definition) => definition.id,
        isVisible: () => true,
      });
    } catch (error) {
      failure = error;
    }
  } finally {
    if (originalValue) {
      Object.defineProperty(Object.prototype, "value", originalValue);
    } else {
      Reflect.deleteProperty(Object.prototype, "value");
    }
    if (originalHasOwnProperty) {
      Object.defineProperty(
        Object.prototype,
        "hasOwnProperty",
        originalHasOwnProperty,
      );
    } else {
      Reflect.deleteProperty(Object.prototype, "hasOwnProperty");
    }
  }

  assertEquals(failure instanceof TypeError, true);
  assertEquals(definitionGetterCalls, 0);
  assertEquals(prototypeHookCalls, 0);
});

Deno.test("skill selector rejects sparse, malformed, proxied, and over-limit inputs", () => {
  const definition = { id: "one" };
  const base = {
    getId: (candidate: typeof definition) => candidate.id,
    isVisible: () => true,
  };

  const sparseDefinitions = new Array<typeof definition>(1);
  const sparseSelector = new Array<string>(1);
  for (
    const operation of [
      () => resolveSkillSelector({ ...base, definitions: sparseDefinitions, selector: true }),
      () => resolveSkillSelector({ ...base, definitions: [definition], selector: sparseSelector }),
      () =>
        resolveSkillSelector({
          ...base,
          definitions: new Proxy([definition], {}),
          selector: true,
        }),
      () =>
        resolveSkillSelector({
          ...base,
          definitions: [definition],
          selector: new Proxy(["one"], {}),
        }),
      () =>
        resolveSkillSelector({
          ...base,
          definitions: [definition],
          selector: ["a".repeat(SKILL_ID_MAX_LENGTH + 1)],
        }),
      () => resolveSkillSelector({ ...base, definitions: [definition], selector: ["bad\n"] }),
    ]
  ) {
    let failure: unknown;
    try {
      operation();
    } catch (error) {
      failure = error;
    }
    assertEquals(failure instanceof TypeError, true);
  }

  let tooManyDefinitions: unknown;
  try {
    resolveSkillSelector({
      ...base,
      definitions: Array.from(
        { length: SKILL_SELECTOR_MAX_DEFINITIONS + 1 },
        (_, index) => ({ id: `${index}` }),
      ),
      selector: true,
    });
  } catch (error) {
    tooManyDefinitions = error;
  }
  assertEquals(tooManyDefinitions instanceof RangeError, true);

  let tooManySelectorEntries: unknown;
  try {
    resolveSkillSelector({
      ...base,
      definitions: [definition],
      selector: Array.from(
        { length: SKILL_SELECTOR_MAX_ENTRIES + 1 },
        () => "one",
      ),
    });
  } catch (error) {
    tooManySelectorEntries = error;
  }
  assertEquals(tooManySelectorEntries instanceof RangeError, true);
});
