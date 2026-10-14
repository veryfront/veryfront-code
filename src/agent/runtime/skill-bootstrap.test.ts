import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  RUNTIME_SKILL_BOOTSTRAP_MAX_BYTES,
  validateRuntimeSkillBootstrapResult,
} from "./skill-bootstrap.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("skill bootstrap result validation", () => {
  it("skill bootstrap accepts a root at its UTF-8 context budget", () => {
    const empty = { skillId: "plan", instructions: "" };
    const overhead = new TextEncoder().encode(JSON.stringify(empty)).byteLength;
    const room = RUNTIME_SKILL_BOOTSTRAP_MAX_BYTES - overhead;
    const boundary = "é".repeat(Math.floor(room / 2)) + (room % 2 ? "a" : "");
    validateRuntimeSkillBootstrapResult({ skillId: "plan", instructions: boundary }, "plan");
    assertEquals(
      (assertThrows(
        () =>
          validateRuntimeSkillBootstrapResult(
            { skillId: "plan", instructions: `${boundary}a` },
            "plan",
          ),
        VeryfrontError,
        "context budget",
      ) as VeryfrontError).slug,
      "config-invalid",
    );
  });

  it("skill bootstrap bounds the reference index as well as instructions", () => {
    const result = {
      skillId: "plan",
      instructions: "# Plan",
      references: Array.from({ length: 500 }, (_, i) => `references/${i}-${"x".repeat(40)}.md`),
    };
    assertEquals(
      (assertThrows(
        () => validateRuntimeSkillBootstrapResult(result, "plan"),
        VeryfrontError,
        "context budget",
      ) as VeryfrontError).slug,
      "config-invalid",
    );
  });

  it("skill bootstrap rejects results for another skill or without instructions", () => {
    assertEquals(
      (assertThrows(
        () => validateRuntimeSkillBootstrapResult({ skillId: "other", instructions: "x" }, "plan"),
        VeryfrontError,
        "authorized skill loader",
      ) as VeryfrontError).slug,
      "config-invalid",
    );
    assertEquals(
      (assertThrows(
        () => validateRuntimeSkillBootstrapResult({ error: "Skill not found" }, "plan"),
        VeryfrontError,
        "authorized skill loader",
      ) as VeryfrontError).slug,
      "config-invalid",
    );
  });
});
