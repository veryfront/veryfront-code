import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { captureExecutorProjectCallContext } from "./executor-project-context.ts";

describe("executor project call context", () => {
  it("snapshots only own skill data without invoking accessors", () => {
    const scripts: string[] = [];
    const input: ToolExecutionContext = {
      activeSkillToolAvailability: { hasActiveSkill: false, references: [], scripts },
    };
    let reads = 0;
    Object.defineProperty(input, "authToken", {
      get() {
        reads++;
        return "<TOKEN>";
      },
    });
    const captured = captureExecutorProjectCallContext(input);
    scripts.push("scripts/later.ts");
    assertEquals(captured, {
      activeSkillToolAvailability: { hasActiveSkill: false, references: [], scripts: [] },
    });
    assertEquals(reads, 0);
    Object.defineProperty(input, "activeSkillId", {
      get() {
        reads++;
        return "skill";
      },
    });
    assertThrows(() => captureExecutorProjectCallContext(input), TypeError);
    assertEquals(reads, 0);
    assertEquals(
      captureExecutorProjectCallContext(Object.create({ activeSkillId: "inherited" })),
      undefined,
    );
  });

  it("enforces existing skill path and entry bounds without truncating valid capability lists", () => {
    const availability = {
      references: Array.from(
        { length: SKILL_LOADABLE_REFERENCE_MAX_ENTRIES },
        (_, i) => `references/${i}.md`,
      ),
      scripts: Array.from({ length: SKILL_SUBDIR_MAX_ENTRIES }, (_, i) => `scripts/${i}.ts`),
    };
    assert(
      captureExecutorProjectCallContext({
        activeSkillId: "skill",
        activeSkillToolAvailability: availability,
      }),
    );
    for (
      const activeSkillToolAvailability of [
        { references: [...availability.references, "references/extra.md"] },
        { scripts: [...availability.scripts, "scripts/extra.ts"] },
        ...[
          "/scripts/a.ts",
          "scripts/../a.ts",
          "scripts//a.ts",
          "scripts/./a.ts",
          "scripts/a\\b.ts",
          " scripts/a.ts",
          "scripts/a\n.ts",
          "scripts/",
        ].map((path) => ({ scripts: [path] })),
        { references: ["scripts/not-a-reference.ts"] },
        { scripts: ["references/not-a-script.md"] },
        { hasActiveSkill: "true" },
        { authToken: "<TOKEN>" },
      ]
    ) {
      assertThrows(
        () =>
          captureExecutorProjectCallContext(
            { activeSkillToolAvailability } as ToolExecutionContext,
          ),
        TypeError,
      );
    }
  });
});
