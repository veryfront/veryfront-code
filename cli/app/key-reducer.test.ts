import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for the key transition.
 *
 * Every case goes through reduceKey, the same interface the shell uses. No
 * terminal, no network, no clock.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  addLog,
  type AppState,
  createInitialState,
  navigateTo,
  remoteProjectPath,
  setActiveList,
  setProjects,
  setRemoteProjects,
  setRemoteUser,
  setTemplates,
  toggleLogsExpanded,
} from "./state.ts";
import { type Effect, type KeyEnv, reduceKey } from "./key-reducer.ts";

const ENTER = "\r";
const ESC = "\x1b";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const TAB = "\t";
const CTRL_C = "\x03";

const ENV: KeyEnv = { suggestProjectName: () => "brave-otter" };

function press(state: AppState, ...keys: string[]): { state: AppState; effects: Effect[] } {
  let current = state;
  const effects: Effect[] = [];
  for (const key of keys) {
    const result = reduceKey(current, key, ENV);
    current = result.state;
    effects.push(...result.effects);
  }
  return { state: current, effects };
}

function withProjects(): AppState {
  return setProjects([{ slug: "alpha", path: "/repo/alpha" }])(createInitialState());
}

function withRemote(slugs: string[] = ["one", "two"]): AppState {
  return setRemoteProjects(slugs.map((slug) => ({ slug })))(
    setRemoteUser({ email: "dev@example.com" })(withProjects()),
  );
}

describe("app/key-reducer", () => {
  describe("new-project view", () => {
    it("navigates to templates on Enter over 'From template'", () => {
      const start = navigateTo("new-project")(createInitialState());
      assertEquals(press(start, ENTER).state.view, "templates");
    });

    it("opens the project-name prompt on Enter over 'From scratch'", () => {
      const start = navigateTo("new-project")(createInitialState());
      const { state } = press(start, DOWN, ENTER);

      assertEquals(state.input.active, true);
      assertEquals(state.input.purpose, { kind: "create-project", template: "minimal" });
    });

    it("pre-fills the prompt with the suggested name", () => {
      const start = navigateTo("new-project")(createInitialState());
      const { state } = press(start, DOWN, ENTER);

      assertEquals(state.input.value, "brave-otter");
      assertEquals(state.input.cursorPos, "brave-otter".length);
    });

    it("selects and confirms with a number key", () => {
      const start = navigateTo("new-project")(createInitialState());
      assertEquals(press(start, "1").state.view, "templates");
    });
  });

  describe("templates view", () => {
    const templatesView = (): AppState =>
      navigateTo("templates")(
        setTemplates([
          { id: "ai-agent", name: "AI Chatbot", description: "" },
          { id: "minimal", name: "Minimal", description: "" },
        ])(createInitialState()),
      );

    it("opens the project-name prompt on Enter", () => {
      const { state } = press(templatesView(), ENTER);

      assertEquals(state.input.active, true);
      assertEquals(state.input.purpose, { kind: "create-project", template: "ai-agent" });
    });

    it("carries the highlighted template into the prompt", () => {
      const { state } = press(templatesView(), DOWN, ENTER);

      assertEquals(state.input.purpose, { kind: "create-project", template: "minimal" });
    });
  });

  describe("auth view", () => {
    it("returns to the dashboard and asks for a login on Enter", () => {
      const start = navigateTo("auth")(createInitialState());
      const { state, effects } = press(start, ENTER);

      assertEquals(state.view, "dashboard");
      assertEquals(effects, [{ kind: "login", provider: "google" }]);
    });

    it("logs in with the highlighted provider", () => {
      const start = navigateTo("auth")(createInitialState());
      const { effects } = press(start, DOWN, ENTER);

      assertEquals(effects, [{ kind: "login", provider: "github" }]);
    });

    it("wraps provider selection upward", () => {
      const start = navigateTo("auth")(createInitialState());
      const { effects } = press(start, UP, ENTER);

      assertEquals(effects, [{ kind: "login", provider: "microsoft" }]);
    });

    it("records the pending login in the log", () => {
      const start = navigateTo("auth")(createInitialState());
      const { state } = press(start, ENTER);

      assertEquals(state.logs.length, 1);
      assertEquals(state.logs[0]?.message, "Opening browser for google login...");
    });
  });

  describe("project-name prompt", () => {
    const prompting = (): AppState =>
      press(navigateTo("new-project")(createInitialState()), DOWN, ENTER).state;

    it("asks for creation on submit and returns to the dashboard", () => {
      const { state, effects } = press(prompting(), ENTER);

      assertEquals(state.view, "dashboard");
      assertEquals(state.input.active, false);
      assertEquals(effects, [
        { kind: "create-project", template: "minimal", name: "brave-otter" },
      ]);
    });

    it("uses the typed name over the suggestion", () => {
      const typed = press(prompting(), "\x15", "m", "y", "-", "a", "p", "p");
      const { effects } = press(typed.state, ENTER);

      assertEquals(effects, [{ kind: "create-project", template: "minimal", name: "my-app" }]);
    });

    it("creates nothing when the name is blank", () => {
      const cleared = press(prompting(), "\x15");
      const { state, effects } = press(cleared.state, ENTER);

      assertEquals(effects, []);
      assertEquals(state.view, "dashboard");
    });

    it("cancels without leaving the originating view", () => {
      const { state, effects } = press(prompting(), ESC);

      assertEquals(state.input.active, false);
      assertEquals(state.view, "new-project");
      assertEquals(effects, []);
    });
  });

  describe("dashboard", () => {
    it("opens the selected project on Enter", () => {
      const { effects } = press(withProjects(), ENTER);

      assertEquals(effects, [{
        kind: "open-browser",
        project: { slug: "alpha", path: "/repo/alpha", type: "local" },
      }]);
    });

    it("opens Studio with s and the IDE with i", () => {
      assertEquals(press(withProjects(), "s").effects[0]?.kind, "open-studio");
      assertEquals(press(withProjects(), "i").effects[0]?.kind, "open-ide");
    });

    it("asks to exit on q", () => {
      assertEquals(press(withProjects(), "q").effects, [{ kind: "exit" }]);
    });

    it("asks to exit on ctrl-c", () => {
      assertEquals(press(withProjects(), CTRL_C).effects, [{ kind: "exit" }]);
    });

    it("opens the auth view with a when signed out", () => {
      assertEquals(press(withProjects(), "a").state.view, "auth");
    });

    it("asks to log out with x when signed in", () => {
      assertEquals(press(withRemote(), "x").effects, [{ kind: "logout" }]);
    });

    it("leaves a alone when already signed in", () => {
      assertEquals(press(withRemote(), "a").state.view, "dashboard");
    });

    it("scrolls logs instead of the list when logs are expanded", () => {
      let base = withProjects();
      // scrollLogs clamps to logs.length - 5, so it takes more than five.
      for (let i = 0; i < 10; i++) base = addLog("info", `log ${i}`)(base);
      const { state } = press(toggleLogsExpanded()(base), UP);

      assertEquals(state.logScroll, 1);
      assertEquals(state.projects.selectedIndex, 0);
    });
  });

  describe("remote projects use the same list module", () => {
    it("moves selection with the same keys as local projects", () => {
      const { state } = press(setActiveList("remoteProjects")(withRemote()), DOWN);

      assertEquals(state.remoteProjects.selectedIndex, 1);
      assertEquals(state.projects.selectedIndex, 0);
    });

    it("wraps around at the end of the remote list", () => {
      const { state } = press(setActiveList("remoteProjects")(withRemote()), DOWN, DOWN);

      assertEquals(state.remoteProjects.selectedIndex, 0);
    });

    it("opens a remote project the same way as a local one", () => {
      const { effects } = press(setActiveList("remoteProjects")(withRemote()), ENTER);

      assertEquals(effects, [{
        kind: "open-browser",
        project: { slug: "one", path: remoteProjectPath("one"), type: "remote" },
      }]);
    });

    it("pulls the selected remote project into its pull path", () => {
      const { effects } = press(setActiveList("remoteProjects")(withRemote()), "p");

      assertEquals(effects, [{
        kind: "pull",
        project: { slug: "one", path: remoteProjectPath("one"), type: "remote" },
      }]);
    });

    it("refuses to push a project that has not been pulled", () => {
      assertEquals(press(setActiveList("remoteProjects")(withRemote()), "u").effects, []);
    });

    it("pushes a local project", () => {
      assertEquals(press(withProjects(), "u").effects[0]?.kind, "push");
    });

    it("switches sections with Tab", () => {
      const { state } = press(withRemote(), TAB);
      assertEquals(state.activeList, "remoteProjects");
      assertEquals(press(state, TAB).state.activeList, "projects");
    });

    it("stays put on Tab when there is only one section", () => {
      assertEquals(press(withProjects(), TAB).state.activeList, "projects");
    });

    it("selects by number within whichever list is active", () => {
      const { state, effects } = press(setActiveList("remoteProjects")(withRemote()), "2");

      assertEquals(state.remoteProjects.selectedIndex, 1);
      assertEquals(effects[0]?.kind, "open-browser");
      assertEquals((effects[0] as { project: { slug: string } }).project.slug, "two");
    });

    it("scrolls a number-selected row into view", () => {
      const many = setRemoteProjects(
        ["a", "b", "c", "d", "e", "f", "g"].map((slug) => ({ slug })),
      )(setRemoteUser({ email: "dev@example.com" })(withProjects()));
      const { state } = press(setActiveList("remoteProjects")(many), "7");

      assertEquals(state.remoteProjects.selectedIndex, 6);
      // Only five rows render, so the window has to move or nothing highlights.
      assertEquals(state.remoteProjects.scrollOffset, 2);
    });

    it("ignores a number past the end of the list", () => {
      const { state, effects } = press(setActiveList("remoteProjects")(withRemote()), "5");

      assertEquals(state.remoteProjects.selectedIndex, 0);
      assertEquals(effects, []);
    });
  });

  describe("navigation", () => {
    it("leaves help on any key", () => {
      const help = navigateTo("help")(withProjects());
      assertEquals(press(help, "z").state.view, "dashboard");
    });

    it("goes back from a view with Escape", () => {
      const templates = navigateTo("templates")(withProjects());
      assertEquals(press(templates, ESC).state.view, "dashboard");
    });

    it("does not exit the dashboard on Escape", () => {
      const { state, effects } = press(withProjects(), ESC);
      assertEquals(state.view, "dashboard");
      assertEquals(effects, []);
    });

    it("does not quit on q outside the dashboard", () => {
      const templates = navigateTo("templates")(withProjects());
      assertEquals(press(templates, "q").effects, []);
    });
  });
});
