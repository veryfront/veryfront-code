import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createProjectSelector } from "./project-selector.ts";
import { PromptInterruptedError } from "../../utils/terminal-select.ts";

const PROJECTS = [
  { id: "project-1", slug: "one", name: "Project One" },
  { id: "project-2", slug: "two", name: "Project Two" },
];

describe("dev project selector", () => {
  it("opens once and restores keyboard input when Escape cancels", async () => {
    let resolveSelection: (value: string | null) => void = () => {};
    const selection = new Promise<string | null>((resolve) => {
      resolveSelection = resolve;
    });
    let promptCount = 0;
    let pauseCount = 0;
    let resumeCount = 0;
    let selectedCount = 0;

    const selector = createProjectSelector({
      getProjects: () => PROJECTS,
      getSelectedProjectId: () => null,
      pauseKeyboard: () => pauseCount++,
      resumeKeyboard: () => resumeCount++,
      onSelect: () => selectedCount++,
      selectOption: () => {
        promptCount++;
        return selection;
      },
    });

    const firstOpen = selector.open();
    const repeatedOpen = selector.open();

    assertEquals(promptCount, 1);
    assertEquals(pauseCount, 1);

    resolveSelection(null);
    await Promise.all([firstOpen, repeatedOpen]);

    assertEquals(selectedCount, 0);
    assertEquals(resumeCount, 1);
  });

  it("waits for initial project discovery before opening", async () => {
    let resolvePreparation: () => void = () => {};
    const preparation = new Promise<void>((resolve) => {
      resolvePreparation = resolve;
    });
    let promptCount = 0;
    let pauseCount = 0;

    const selector = createProjectSelector({
      prepare: () => preparation,
      getProjects: () => PROJECTS,
      getSelectedProjectId: () => null,
      pauseKeyboard: () => pauseCount++,
      resumeKeyboard: () => {},
      onSelect: () => {},
      selectOption: () => {
        promptCount++;
        return Promise.resolve(null);
      },
    });

    const opening = selector.open();

    assertEquals(pauseCount, 1);
    assertEquals(promptCount, 0);

    resolvePreparation();
    await opening;

    assertEquals(promptCount, 1);
  });

  it("shuts down when Ctrl-C interrupts the selector", async () => {
    let interruptCount = 0;
    let resumeCount = 0;
    const selector = createProjectSelector({
      getProjects: () => PROJECTS,
      getSelectedProjectId: () => null,
      pauseKeyboard: () => {},
      resumeKeyboard: () => resumeCount++,
      onSelect: () => {},
      onInterrupt: () => interruptCount++,
      selectOption: () => Promise.reject(new PromptInterruptedError()),
    });

    await selector.open();

    assertEquals(interruptCount, 1);
    assertEquals(resumeCount, 0);
  });

  it("selects a project without starting another action", async () => {
    const selected: string[] = [];
    const selector = createProjectSelector({
      getProjects: () => PROJECTS,
      getSelectedProjectId: () => "project-1",
      pauseKeyboard: () => {},
      resumeKeyboard: () => {},
      onSelect: (project) => selected.push(project.id),
      selectOption: (_question, _options, defaultIndex, display) => {
        assertEquals(defaultIndex, 0);
        assertEquals(display, {
          showMarker: false,
          showInstructions: false,
          showDescriptions: false,
          clearOnCancel: true,
          interruptOnCtrlC: true,
        });
        return Promise.resolve("project-2");
      },
    });

    await selector.open();

    assertEquals(selected, ["project-2"]);
  });
});
