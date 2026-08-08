import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  filterToolNamesForSkill,
  filterToolsForSkill,
  isSkillToolAvailable,
} from "./allowed-tools.ts";

const ACTIVE_SKILL_WITH_FILES = {
  hasActiveSkill: true,
  references: ["references/guide.md"],
  scripts: ["scripts/run.sh"],
};

const ACTIVE_SKILL_WITHOUT_FILES = {
  hasActiveSkill: true,
  references: [],
  scripts: [],
};

const SKILL_TOOLS = ["load_skill", "load_skill_reference", "execute_skill_script"];

describe("src/skill/allowed-tools", () => {
  describe("filterToolsForSkill", () => {
    it("returns every tool untouched when no skill is active", () => {
      const tools = [{ name: "Read" }, { name: "Write" }, { name: "api:list" }];
      assertEquals(filterToolsForSkill(tools), tools);
    });

    it("never filters ordinary tools, whatever the active skill advertises", () => {
      const tools = [{ name: "Read" }, { name: "Write" }, { name: "api:list" }];
      assertEquals(
        filterToolsForSkill(tools, ACTIVE_SKILL_WITHOUT_FILES),
        tools,
      );
    });

    it("advertises file-backed skill tools only when the skill declares the files", () => {
      const tools = SKILL_TOOLS.map((name) => ({ name }));
      assertEquals(
        filterToolsForSkill(tools, ACTIVE_SKILL_WITH_FILES).map((tool) => tool.name),
        SKILL_TOOLS,
      );
      assertEquals(
        filterToolsForSkill(tools, ACTIVE_SKILL_WITHOUT_FILES).map((tool) => tool.name),
        ["load_skill"],
      );
    });

    it("keeps load_skill available with no skill active so navigation still works", () => {
      assertEquals(
        filterToolsForSkill(SKILL_TOOLS.map((name) => ({ name })), {
          hasActiveSkill: false,
        }).map((tool) => tool.name),
        ["load_skill"],
      );
    });
  });

  describe("filterToolNamesForSkill", () => {
    it("preserves name-only inventories when no skill is active", () => {
      assertEquals(
        filterToolNamesForSkill(["web_search", "web_fetch"], undefined),
        ["web_search", "web_fetch"],
      );
    });

    it("applies the same file-backed gate to name-only inventories", () => {
      assertEquals(
        filterToolNamesForSkill(SKILL_TOOLS, ACTIVE_SKILL_WITH_FILES),
        SKILL_TOOLS,
      );
      assertEquals(
        filterToolNamesForSkill(SKILL_TOOLS, ACTIVE_SKILL_WITHOUT_FILES),
        ["load_skill"],
      );
    });
  });

  describe("isSkillToolAvailable", () => {
    it("allows any ordinary tool regardless of what the skill declares", () => {
      // `allowed-tools` is spec pre-approval metadata, not an authorization
      // boundary, so no declaration can deny an ordinary tool.
      assertEquals(isSkillToolAvailable("Write", ACTIVE_SKILL_WITHOUT_FILES), true);
      assertEquals(isSkillToolAvailable("api:list", ACTIVE_SKILL_WITH_FILES), true);
      assertEquals(isSkillToolAvailable("Write"), true);
    });

    it("allows load_skill unconditionally", () => {
      assertEquals(isSkillToolAvailable("load_skill"), true);
      assertEquals(isSkillToolAvailable("load_skill", ACTIVE_SKILL_WITHOUT_FILES), true);
    });

    it("denies file-backed skill tools when the skill advertises no such file", () => {
      assertEquals(
        isSkillToolAvailable("load_skill_reference", ACTIVE_SKILL_WITHOUT_FILES),
        false,
      );
      assertEquals(
        isSkillToolAvailable("execute_skill_script", ACTIVE_SKILL_WITHOUT_FILES),
        false,
      );
      assertEquals(
        isSkillToolAvailable("load_skill_reference", ACTIVE_SKILL_WITH_FILES),
        true,
      );
      assertEquals(
        isSkillToolAvailable("execute_skill_script", ACTIVE_SKILL_WITH_FILES),
        true,
      );
    });

    it("denies file-backed skill tools when no skill is active", () => {
      assertEquals(isSkillToolAvailable("load_skill_reference"), false);
      assertEquals(isSkillToolAvailable("execute_skill_script"), false);
    });
  });
});
