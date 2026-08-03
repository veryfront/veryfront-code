import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart } from "#veryfront/agent/react";
import { getSkillToolProps, SkillTool } from "./skill-tool.tsx";

describe("SkillTool", () => {
  it("renders the loaded label with a check icon by default", () => {
    const html = renderToString(<SkillTool skill="review" />);
    assertStringIncludes(html, "Loaded skill: review");
  });

  it("renders the loading label with a shimmer while loading", () => {
    const html = renderToString(<SkillTool skill="review" state="loading" />);
    assertStringIncludes(html, "Loading skill: review");
    assertStringIncludes(html, "animate-pulse");
  });

  it("merges className onto the row", () => {
    const html = renderToString(<SkillTool skill="review" className="vf-custom-row" />);
    assertStringIncludes(html, "vf-custom-row");
  });
});

describe("getSkillToolProps", () => {
  it("derives a loading state from a pending tool part", () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-load-skill",
      toolName: "load_skill",
      state: "input-available",
      input: { skillId: "review" },
    };
    assertEquals(getSkillToolProps(tool), { skill: "review", state: "loading" });
  });

  it("derives a loaded state from a completed tool part", () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-load-skill",
      toolName: "load_skill",
      state: "output-available",
      input: { reference: "guide.md" },
      output: { loaded: true },
    };
    assertEquals(getSkillToolProps(tool), { skill: "guide.md", state: "loaded" });
  });

  it("falls back to 'unknown' when no recognizable input field is present", () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-load-skill",
      toolName: "load_skill",
      state: "output-available",
      input: {},
      output: {},
    };
    const props = getSkillToolProps(tool);
    assert(props.skill === "unknown", "expected the unknown fallback skill label");
  });
});
