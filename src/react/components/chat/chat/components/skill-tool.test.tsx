import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart } from "#veryfront/agent/react";
import { CHILD_TOOL_STOPPED_STATE, getSkillToolProps, SkillTool } from "./skill-tool.tsx";

describe("SkillTool", () => {
  it("renders the loaded label with a check icon by default", () => {
    const html = renderToString(<SkillTool skill="review" />);
    assertStringIncludes(html, "Loaded skill: review");
    assertStringIncludes(html, 'points="20 6 9 17 4 12"', "loaded rows render the check polyline");
    assertEquals(html.includes("animate-pulse"), false, "loaded rows do not pulse");
  });

  it("renders the loading label with a shimmer while loading", () => {
    const html = renderToString(<SkillTool skill="review" state="loading" />);
    assertStringIncludes(html, "Loading skill: review");
    assertStringIncludes(html, "animate-pulse");
    assertEquals(
      html.includes('points="20 6 9 17 4 12"'),
      false,
      "loading rows do not show the check",
    );
  });

  it("renders a terminal label with no animation once stopped", () => {
    const html = renderToString(<SkillTool skill="review" state="stopped" />);
    assertStringIncludes(html, "Stopped loading skill: review");
    // A frozen row must not keep shimmering, and must not claim it loaded.
    assertEquals(html.includes("animate-pulse"), false);
    assertEquals(html.includes("Loaded skill"), false);
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

  it("derives a stopped state from an interrupted child tool part", () => {
    const tool = {
      type: "dynamic-tool",
      toolCallId: "tool-load-skill",
      toolName: "load_skill",
      state: CHILD_TOOL_STOPPED_STATE,
      input: { skillId: "review" },
    } as unknown as ChatDynamicToolPart;
    assertEquals(
      getSkillToolProps(tool),
      { skill: "review", state: "stopped" },
      "stopped parts must not be reported as loading",
    );
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
