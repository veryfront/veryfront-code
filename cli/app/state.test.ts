import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for app state management
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { InputPurpose } from "./state.ts";
import {
  addLog,
  type AppState,
  createInitialState,
  endInput,
  getActiveSelection,
  goBack,
  navigateTo,
  remoteProjectPath,
  scrollLogs,
  setActiveList,
  setProjects,
  setRemoteProjects,
  setRemoteUser,
  setTemplates,
  startInput,
  toggleHelp,
  toggleLogsExpanded,
  updateInputValue,
  updateMCP,
  updateServer,
} from "./state.ts";

const CREATE_MINIMAL: InputPurpose = { kind: "create-project", template: "minimal" };

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

    describe("setRemoteUser", () => {
      it("sets the signed-in user", () => {
        state = freshState();
        const updater = setRemoteUser({ email: "test@example.com" });
        const newState = updater(state);
        assertEquals(newState.remote.user?.email, "test@example.com");
      });
    });

    describe("keeping activeList selectable", () => {
      const signedInWithRemote = (): AppState =>
        setActiveList("remoteProjects")(
          setRemoteProjects([{ slug: "alpha" }])(
            setRemoteUser({ email: "dev@example.com" })(freshState()),
          ),
        );

      it("moves off the remote section when the last remote project goes away", () => {
        // Still signed in, but the dashboard stops rendering an empty section.
        const newState = setRemoteProjects([])(signedInWithRemote());

        assertEquals(newState.activeList, "projects");
      });

      it("keeps the remote section active while it still has projects", () => {
        const newState = setRemoteProjects([{ slug: "beta" }])(signedInWithRemote());

        assertEquals(newState.activeList, "remoteProjects");
      });
    });

    describe("setRemoteUser(null)", () => {
      it("moves the active list off the remote section on sign-out", () => {
        state = setRemoteProjects([{ slug: "alpha" }])(
          setRemoteUser({ email: "dev@example.com" })(freshState()),
        );
        state = setActiveList("remoteProjects")(state);

        const newState = setRemoteUser(null)(state);

        assertEquals(newState.activeList, "projects");
      });

      it("keeps the remote section active when signing in with projects", () => {
        state = setActiveList("remoteProjects")(
          setRemoteProjects([{ slug: "alpha" }])(freshState()),
        );
        assertEquals(
          setRemoteUser({ email: "dev@example.com" })(state).activeList,
          "remoteProjects",
        );
      });

      it("does not activate an empty remote section on sign-in", () => {
        state = setActiveList("remoteProjects")(freshState());
        assertEquals(
          setRemoteUser({ email: "dev@example.com" })(state).activeList,
          "projects",
        );
      });
    });

    describe("setRemoteProjects", () => {
      it("stores remote projects as a selectable list", () => {
        state = freshState();
        const newState = setRemoteProjects([{ slug: "alpha" }, { slug: "beta" }])(state);
        assertEquals(newState.remoteProjects.items.length, 2);
        assertEquals(newState.remoteProjects.items[0]?.label, "alpha");
        assertEquals(newState.remoteProjects.selectedIndex, 0);
      });

      it("gives each remote project the path a pull would use", () => {
        state = freshState();
        const newState = setRemoteProjects([{ slug: "alpha" }])(state);
        assertEquals(newState.remoteProjects.items[0]?.data?.path, remoteProjectPath("alpha"));
        assertEquals(newState.remoteProjects.items[0]?.data?.type, "remote");
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
        const updater = setActiveList("remoteProjects");
        const newState = updater(state);
        assertEquals(newState.activeList, "remoteProjects");
      });
    });

    describe("startInput", () => {
      it("activates input mode and records why", () => {
        state = freshState();
        const updater = startInput("Enter name:", CREATE_MINIMAL);
        const newState = updater(state);
        assertEquals(newState.input.active, true);
        assertEquals(newState.input.prompt, "Enter name:");
        assertEquals(newState.input.purpose, CREATE_MINIMAL);
      });

      it("sets initial value if provided", () => {
        state = freshState();
        const updater = startInput("Enter name:", CREATE_MINIMAL, "default");
        const newState = updater(state);
        assertEquals(newState.input.value, "default");
        assertEquals(newState.input.cursorPos, 7);
      });
    });

    describe("updateInputValue", () => {
      it("updates input value and cursor", () => {
        state = freshState();
        state = startInput("Prompt:", CREATE_MINIMAL)(state);
        const updater = updateInputValue("hello", 5);
        const newState = updater(state);
        assertEquals(newState.input.value, "hello");
        assertEquals(newState.input.cursorPos, 5);
      });
    });

    describe("endInput", () => {
      it("resets input state", () => {
        state = freshState();
        state = startInput("Prompt:", CREATE_MINIMAL)(state);
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
    it("returns undefined when the active list is empty", () => {
      const state = createInitialState();
      state.activeList = "remoteProjects";
      const selection = getActiveSelection(state);
      assertEquals(selection, undefined);
    });

    it("reads through to remote projects when they are active", () => {
      let state = createInitialState();
      state = setRemoteProjects([{ slug: "alpha" }])(state);
      state = setActiveList("remoteProjects")(state);
      assertEquals(getActiveSelection(state)?.data?.slug, "alpha");
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
