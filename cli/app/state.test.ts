/**
 * Tests for app state management
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  addLog,
  type AppState,
  clearLogs,
  createInitialState,
  endInput,
  getActiveSelection,
  goBack,
  navigateTo,
  resetWizard,
  scrollLogs,
  selectProject,
  setActiveList,
  setExamples,
  setProjects,
  setTemplates,
  startInput,
  toggleHelp,
  toggleLogsExpanded,
  updateInputValue,
  updateMCP,
  updateRemote,
  updateServer,
  updateWizard,
} from "./state.ts";

describe("app/state", () => {
  describe("createInitialState", () => {
    it("returns AppState object", () => {
      const state = createInitialState();
      assertExists(state);
      assertEquals(typeof state, "object");
    });

    it("initializes with dashboard view", () => {
      const state = createInitialState();
      assertEquals(state.view, "dashboard");
    });

    it("initializes with server not running", () => {
      const state = createInitialState();
      assertEquals(state.server.running, false);
    });

    it("initializes with MCP disabled", () => {
      const state = createInitialState();
      assertEquals(state.mcp.enabled, false);
      assertEquals(state.mcp.connected, false);
    });

    it("initializes with no user logged in", () => {
      const state = createInitialState();
      assertEquals(state.remote.user, null);
    });

    it("initializes with empty logs", () => {
      const state = createInitialState();
      assertEquals(state.logs.length, 0);
      assertEquals(state.maxLogs, 100);
    });

    it("initializes wizard with default values", () => {
      const state = createInitialState();
      assertEquals(state.wizard.step, 0);
      assertEquals(state.wizard.startType, null);
      assertEquals(state.wizard.integrations.length, 0);
    });
  });

  describe("State updaters", () => {
    let state: AppState;

    const freshState = () => createInitialState();

    describe("setProjects", () => {
      it("updates projects list", () => {
        state = freshState();
        const updater = setProjects([{ slug: "test", path: "/test" }]);
        const newState = updater(state);
        assertEquals(newState.projects.items.length, 1);
        assertEquals(newState.projects.items[0]?.data.slug, "test");
      });
    });

    describe("setExamples", () => {
      it("updates examples list", () => {
        state = freshState();
        const updater = setExamples([{ slug: "example", path: "/example" }]);
        const newState = updater(state);
        assertEquals(newState.examples.items.length, 1);
        assertEquals(newState.examples.items[0]?.data.slug, "example");
      });
    });

    describe("setTemplates", () => {
      it("updates templates list", () => {
        state = freshState();
        const updater = setTemplates([{ id: "tmpl", name: "Template", description: "Desc" }]);
        const newState = updater(state);
        assertEquals(newState.templates.items.length, 1);
        assertEquals(newState.templates.items[0]?.data.slug, "tmpl");
      });
    });

    describe("updateServer", () => {
      it("partially updates server status", () => {
        state = freshState();
        const updater = updateServer({ running: true, port: 3000 });
        const newState = updater(state);
        assertEquals(newState.server.running, true);
        assertEquals(newState.server.port, 3000);
        assertEquals(newState.server.errors, 0); // unchanged
      });
    });

    describe("updateMCP", () => {
      it("partially updates MCP status", () => {
        state = freshState();
        const updater = updateMCP({ enabled: true, transport: "stdio" });
        const newState = updater(state);
        assertEquals(newState.mcp.enabled, true);
        assertEquals(newState.mcp.transport, "stdio");
      });
    });

    describe("updateRemote", () => {
      it("partially updates remote state", () => {
        state = freshState();
        const updater = updateRemote({ user: { email: "test@example.com" } });
        const newState = updater(state);
        assertEquals(newState.remote.user?.email, "test@example.com");
      });
    });

    describe("navigateTo", () => {
      it("changes view and stores previous", () => {
        state = freshState();
        const updater = navigateTo("help");
        const newState = updater(state);
        assertEquals(newState.view, "help");
        assertEquals(newState.previousView, "dashboard");
      });
    });

    describe("goBack", () => {
      it("returns to previous view", () => {
        state = freshState();
        state = navigateTo("help")(state);
        const updater = goBack();
        const newState = updater(state);
        assertEquals(newState.view, "dashboard");
        assertEquals(newState.previousView, null);
      });

      it("returns to dashboard if no previous view", () => {
        state = freshState();
        const updater = goBack();
        const newState = updater(state);
        assertEquals(newState.view, "dashboard");
      });
    });

    describe("setActiveList", () => {
      it("sets the active list", () => {
        state = freshState();
        const updater = setActiveList("templates");
        const newState = updater(state);
        assertEquals(newState.activeList, "templates");
      });
    });

    describe("selectProject", () => {
      it("selects a project and navigates to detail view", () => {
        state = freshState();
        const project = { slug: "test", path: "/test", type: "local" as const };
        const updater = selectProject(project);
        const newState = updater(state);
        assertEquals(newState.selectedProject?.slug, "test");
        assertEquals(newState.view, "project-detail");
      });

      it("clears selected project when null", () => {
        state = freshState();
        state = selectProject({ slug: "test", path: "/test", type: "local" })(state);
        const updater = selectProject(null);
        const newState = updater(state);
        assertEquals(newState.selectedProject, null);
      });
    });

    describe("updateWizard", () => {
      it("partially updates wizard state", () => {
        state = freshState();
        const updater = updateWizard({ step: 2, startType: "template" });
        const newState = updater(state);
        assertEquals(newState.wizard.step, 2);
        assertEquals(newState.wizard.startType, "template");
      });
    });

    describe("resetWizard", () => {
      it("resets wizard to initial state", () => {
        state = freshState();
        state = updateWizard({ step: 3, startType: "scratch", projectName: "test" })(state);
        const updater = resetWizard();
        const newState = updater(state);
        assertEquals(newState.wizard.step, 0);
        assertEquals(newState.wizard.startType, null);
        assertEquals(newState.wizard.projectName, "");
      });
    });

    describe("startInput", () => {
      it("activates input mode", () => {
        state = freshState();
        const onSubmit = (_: string) => {};
        const updater = startInput("Enter name:", onSubmit);
        const newState = updater(state);
        assertEquals(newState.input.active, true);
        assertEquals(newState.input.prompt, "Enter name:");
      });

      it("sets initial value if provided", () => {
        state = freshState();
        const updater = startInput("Enter name:", () => {}, undefined, "default");
        const newState = updater(state);
        assertEquals(newState.input.value, "default");
        assertEquals(newState.input.cursorPos, 7);
      });
    });

    describe("updateInputValue", () => {
      it("updates input value and cursor", () => {
        state = freshState();
        state = startInput("Prompt:", () => {})(state);
        const updater = updateInputValue("hello", 5);
        const newState = updater(state);
        assertEquals(newState.input.value, "hello");
        assertEquals(newState.input.cursorPos, 5);
      });
    });

    describe("endInput", () => {
      it("resets input state", () => {
        state = freshState();
        state = startInput("Prompt:", () => {})(state);
        const updater = endInput();
        const newState = updater(state);
        assertEquals(newState.input.active, false);
        assertEquals(newState.input.value, "");
      });
    });

    describe("addLog", () => {
      it("adds log entry", () => {
        state = freshState();
        const updater = addLog("info", "Test message");
        const newState = updater(state);
        assertEquals(newState.logs.length, 1);
        assertEquals(newState.logs[0]?.message, "Test message");
        assertEquals(newState.logs[0]?.level, "info");
      });

      it("enforces max logs limit", () => {
        state = freshState();
        state.maxLogs = 2;
        state = addLog("info", "Log 1")(state);
        state = addLog("info", "Log 2")(state);
        state = addLog("info", "Log 3")(state);
        assertEquals(state.logs.length, 2);
        assertEquals(state.logs[0]?.message, "Log 2");
      });
    });

    describe("clearLogs", () => {
      it("clears all logs", () => {
        state = freshState();
        state = addLog("info", "Test")(state);
        const updater = clearLogs();
        const newState = updater(state);
        assertEquals(newState.logs.length, 0);
        assertEquals(newState.logScroll, 0);
      });
    });

    describe("toggleLogsExpanded", () => {
      it("toggles logs expanded state", () => {
        state = freshState();
        assertEquals(state.logsExpanded, false);
        state = toggleLogsExpanded()(state);
        assertEquals(state.logsExpanded, true);
        state = toggleLogsExpanded()(state);
        assertEquals(state.logsExpanded, false);
      });
    });

    describe("toggleHelp", () => {
      it("toggles help visibility", () => {
        state = freshState();
        assertEquals(state.showHelp, false);
        state = toggleHelp()(state);
        assertEquals(state.showHelp, true);
      });
    });

    describe("scrollLogs", () => {
      it("does nothing when logs not expanded", () => {
        state = freshState();
        state = addLog("info", "Test")(state);
        const updater = scrollLogs("up");
        const newState = updater(state);
        assertEquals(newState.logScroll, 0);
      });

      it("scrolls when logs expanded", () => {
        state = freshState();
        for (let i = 0; i < 10; i++) {
          state = addLog("info", `Log ${i}`)(state);
        }
        state = toggleLogsExpanded()(state);
        state = scrollLogs("up")(state);
        assertEquals(state.logScroll, 1);
      });
    });
  });

  describe("getActiveSelection", () => {
    it("returns undefined for remoteProjects", () => {
      const state = createInitialState();
      state.activeList = "remoteProjects";
      const selection = getActiveSelection(state);
      assertEquals(selection, undefined);
    });

    it("returns selected item from active list", () => {
      let state = createInitialState();
      state = setProjects([{ slug: "test", path: "/test" }])(state);
      state.activeList = "projects";
      const selection = getActiveSelection(state);
      assertEquals(selection?.data.slug, "test");
    });
  });
});
