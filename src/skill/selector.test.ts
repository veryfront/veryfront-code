import { assertEquals } from "#veryfront/testing/assert.ts";
import { createNoneSkillSelectorSnapshot, resolveSkillSelector } from "./selector.ts";

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
