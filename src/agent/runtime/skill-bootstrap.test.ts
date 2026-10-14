import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "@std/assert";
import {
  RUNTIME_SKILL_BOOTSTRAP_MAX_BYTES,
  validateRuntimeSkillBootstrapResult,
} from "./skill-bootstrap.ts";

Deno.test("skill bootstrap accepts a root at its UTF-8 context budget", () => {
  const empty = { skillId: "plan", instructions: "" };
  const overhead = new TextEncoder().encode(JSON.stringify(empty)).byteLength;
  const room = RUNTIME_SKILL_BOOTSTRAP_MAX_BYTES - overhead;
  const boundary = "é".repeat(Math.floor(room / 2)) + (room % 2 ? "a" : "");
  validateRuntimeSkillBootstrapResult({ skillId: "plan", instructions: boundary }, "plan");
  assertThrows(
    () =>
      validateRuntimeSkillBootstrapResult(
        { skillId: "plan", instructions: `${boundary}a` },
        "plan",
      ),
    Error,
    "context budget",
  );
});

Deno.test("skill bootstrap bounds the reference index as well as instructions", () => {
  const result = {
    skillId: "plan",
    instructions: "# Plan",
    references: Array.from({ length: 500 }, (_, i) => `references/${i}-${"x".repeat(40)}.md`),
  };
  assertThrows(() => validateRuntimeSkillBootstrapResult(result, "plan"), Error, "context budget");
});

Deno.test("skill bootstrap rejects results for another skill or without instructions", () => {
  assertThrows(
    () => validateRuntimeSkillBootstrapResult({ skillId: "other", instructions: "x" }, "plan"),
    Error,
    "authorized skill loader",
  );
  assertThrows(
    () => validateRuntimeSkillBootstrapResult({ error: "Skill not found" }, "plan"),
    Error,
    "authorized skill loader",
  );
});
