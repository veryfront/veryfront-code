/**
 * Tests for project detail view
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  addLogLine,
  clearLogs,
  createProjectDetail,
  getItemCount,
  getSelectedFile,
  getSelectedRoute,
  getVisibleFiles,
  handleProjectDetailKey,
  nextProjectTab,
  prevProjectTab,
  ProjectInfoSchema,
  projectMoveDown,
  projectMoveUp,
  ProjectTabSchema,
  renderDashboardTab,
  renderFilesTab,
  renderProjectDetail,
  renderProjectHeader,
  renderProjectTabBar,
  renderRoutesTab,
  setFiles,
  setProject,
  setRoutes,
  setTab,
  toggleFileExpand,
} from "./project-detail.ts";

describe("ProjectTabSchema", () => {
  it("validates tabs", () => {
    expect(ProjectTabSchema.parse("dashboard")).toBe("dashboard");
    expect(ProjectTabSchema.parse("files")).toBe("files");
    expect(ProjectTabSchema.parse("routes")).toBe("routes");
    expect(ProjectTabSchema.parse("agents")).toBe("agents");
    expect(ProjectTabSchema.parse("terminal")).toBe("terminal");
    expect(ProjectTabSchema.parse("logs")).toBe("logs");
  });
});

describe("ProjectInfoSchema", () => {
  it("validates project info", () => {
    const result = ProjectInfoSchema.parse({
      id: "my-app",
      name: "My App",
      path: "/home/user/my-app",
      template: "ai",
      serverStatus: "running",
    });

    expect(result.id).toBe("my-app");
    expect(result.serverStatus).toBe("running");
  });
});

describe("createProjectDetail", () => {
  it("creates empty state", () => {
    const state = createProjectDetail();

    expect(state.project).toBeNull();
    expect(state.activeTab).toBe("dashboard");
    expect(state.files).toEqual([]);
    expect(state.routes).toEqual([]);
  });

  it("creates with project", () => {
    const project = { id: "test", name: "Test", path: "/test" };
    const state = createProjectDetail(project);

    expect(state.project?.id).toBe("test");
  });
});

describe("setProject", () => {
  it("sets project", () => {
    let state = createProjectDetail();
    state = setProject({ id: "app", name: "App", path: "/app" })(state);

    expect(state.project?.id).toBe("app");
  });
});

describe("setTab", () => {
  it("sets active tab", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);

    expect(state.activeTab).toBe("files");
    expect(state.selectedIndex).toBe(0);
  });
});

describe("nextProjectTab/prevProjectTab", () => {
  it("cycles to next tab", () => {
    let state = createProjectDetail();
    state = nextProjectTab()(state);

    expect(state.activeTab).toBe("files");
  });

  it("wraps around", () => {
    let state = createProjectDetail();
    state = setTab("logs")(state);
    state = nextProjectTab()(state);

    expect(state.activeTab).toBe("dashboard");
  });

  it("cycles to previous tab", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);
    state = prevProjectTab()(state);

    expect(state.activeTab).toBe("dashboard");
  });
});

describe("setFiles", () => {
  it("sets files", () => {
    let state = createProjectDetail();
    state = setFiles([
      { path: "src", name: "src", isDirectory: true, depth: 0 },
      { path: "src/index.ts", name: "index.ts", isDirectory: false, depth: 1 },
    ])(state);

    expect(state.files.length).toBe(2);
  });
});

describe("toggleFileExpand", () => {
  it("toggles expansion", () => {
    let state = createProjectDetail();
    state = setFiles([
      { path: "src", name: "src", isDirectory: true, depth: 0, expanded: false },
    ])(state);

    state = toggleFileExpand("src")(state);
    expect(state.files[0]?.expanded).toBe(true);

    state = toggleFileExpand("src")(state);
    expect(state.files[0]?.expanded).toBe(false);
  });
});

describe("setRoutes", () => {
  it("sets routes", () => {
    let state = createProjectDetail();
    state = setRoutes([
      { path: "/", methods: ["GET"], filePath: "pages/index.tsx", type: "page" },
    ])(state);

    expect(state.routes.length).toBe(1);
  });
});

describe("projectMoveUp/projectMoveDown", () => {
  it("moves in files tab", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);
    state = setFiles([
      { path: "a", name: "a", isDirectory: false, depth: 0 },
      { path: "b", name: "b", isDirectory: false, depth: 0 },
    ])(state);

    state = projectMoveDown()(state);
    expect(state.selectedIndex).toBe(1);

    state = projectMoveUp()(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("wraps around", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);
    state = setFiles([
      { path: "a", name: "a", isDirectory: false, depth: 0 },
      { path: "b", name: "b", isDirectory: false, depth: 0 },
    ])(state);

    state = projectMoveUp()(state);
    expect(state.selectedIndex).toBe(1);
  });
});

describe("addLogLine/clearLogs", () => {
  it("adds log lines", () => {
    let state = createProjectDetail();
    state = addLogLine("Line 1")(state);
    state = addLogLine("Line 2")(state);

    expect(state.logs.length).toBe(2);
    expect(state.logs[0]).toBe("Line 1");
  });

  it("clears logs", () => {
    let state = createProjectDetail();
    state = addLogLine("Line 1")(state);
    state = clearLogs()(state);

    expect(state.logs.length).toBe(0);
  });

  it("limits log size", () => {
    let state = createProjectDetail();
    for (let i = 0; i < 600; i++) {
      state = addLogLine(`Line ${i}`)(state);
    }

    expect(state.logs.length).toBe(500);
  });
});

describe("getVisibleFiles", () => {
  it("returns root files", () => {
    let state = createProjectDetail();
    state = setFiles([
      { path: "src", name: "src", isDirectory: true, depth: 0, expanded: false },
      { path: "src/index.ts", name: "index.ts", isDirectory: false, depth: 1 },
      { path: "package.json", name: "package.json", isDirectory: false, depth: 0 },
    ])(state);

    const visible = getVisibleFiles(state);

    expect(visible.length).toBe(2);
    expect(visible[0]?.name).toBe("src");
    expect(visible[1]?.name).toBe("package.json");
  });

  it("shows children of expanded directories", () => {
    let state = createProjectDetail();
    state = setFiles([
      { path: "src", name: "src", isDirectory: true, depth: 0, expanded: true },
      { path: "src/index.ts", name: "index.ts", isDirectory: false, depth: 1 },
    ])(state);

    const visible = getVisibleFiles(state);

    expect(visible.length).toBe(2);
    expect(visible[1]?.name).toBe("index.ts");
  });
});

describe("getItemCount", () => {
  it("returns file count", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);
    state = setFiles([
      { path: "a", name: "a", isDirectory: false, depth: 0 },
      { path: "b", name: "b", isDirectory: false, depth: 0 },
    ])(state);

    expect(getItemCount(state)).toBe(2);
  });

  it("returns route count", () => {
    let state = createProjectDetail();
    state = setTab("routes")(state);
    state = setRoutes([
      { path: "/", methods: ["GET"], filePath: "index.tsx", type: "page" },
    ])(state);

    expect(getItemCount(state)).toBe(1);
  });
});

describe("getSelectedFile", () => {
  it("returns selected file", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);
    state = setFiles([
      { path: "a", name: "a", isDirectory: false, depth: 0 },
    ])(state);

    const file = getSelectedFile(state);
    expect(file?.name).toBe("a");
  });

  it("returns null for other tabs", () => {
    let state = createProjectDetail();
    state = setTab("routes")(state);

    expect(getSelectedFile(state)).toBeNull();
  });
});

describe("getSelectedRoute", () => {
  it("returns selected route", () => {
    let state = createProjectDetail();
    state = setTab("routes")(state);
    state = setRoutes([
      { path: "/api", methods: ["GET"], filePath: "api.ts", type: "api" },
    ])(state);

    const route = getSelectedRoute(state);
    expect(route?.path).toBe("/api");
  });
});

describe("renderProjectTabBar", () => {
  it("renders tabs", () => {
    const state = createProjectDetail();
    const result = renderProjectTabBar(state);

    expect(result).toContain("Dashboard");
    expect(result).toContain("Files");
    expect(result).toContain("Routes");
  });
});

describe("renderProjectHeader", () => {
  it("renders project info", () => {
    let state = createProjectDetail();
    state = setProject({
      id: "my-app",
      name: "My App",
      path: "/home/user/my-app",
      serverStatus: "running",
      serverUrl: "http://localhost:8080",
    })(state);

    const result = renderProjectHeader(state);

    expect(result).toContain("My App");
    expect(result).toContain("/home/user/my-app");
    expect(result).toContain("running");
  });

  it("shows no project message", () => {
    const state = createProjectDetail();
    const result = renderProjectHeader(state);

    expect(result).toContain("No project");
  });
});

describe("renderFilesTab", () => {
  it("renders files", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);
    state = setFiles([
      { path: "src", name: "src", isDirectory: true, depth: 0 },
      { path: "index.ts", name: "index.ts", isDirectory: false, depth: 0 },
    ])(state);

    const result = renderFilesTab(state);

    expect(result).toContain("src");
    expect(result).toContain("index.ts");
  });

  it("shows no files message", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);

    const result = renderFilesTab(state);
    expect(result).toContain("No files");
  });
});

describe("renderRoutesTab", () => {
  it("renders routes", () => {
    let state = createProjectDetail();
    state = setTab("routes")(state);
    state = setRoutes([
      { path: "/api/users", methods: ["GET", "POST"], filePath: "api/users.ts", type: "api" },
    ])(state);

    const result = renderRoutesTab(state);

    expect(result).toContain("/api/users");
    expect(result).toContain("GET,POST");
    expect(result).toContain("[api]");
  });
});

describe("renderDashboardTab", () => {
  it("renders overview", () => {
    let state = createProjectDetail();
    state = setProject({ id: "app", name: "App", path: "/app", template: "ai" })(state);
    state = setFiles([
      { path: "a", name: "a", isDirectory: false, depth: 0 },
    ])(state);
    state = setRoutes([
      { path: "/", methods: ["GET"], filePath: "index.tsx", type: "page" },
    ])(state);

    const result = renderDashboardTab(state);

    expect(result).toContain("Files:");
    expect(result).toContain("Routes:");
    expect(result).toContain("Template:");
    expect(result).toContain("ai");
  });
});

describe("renderProjectDetail", () => {
  it("renders full view", () => {
    let state = createProjectDetail();
    state = setProject({ id: "app", name: "App", path: "/app" })(state);

    const result = renderProjectDetail(state);

    expect(result).toContain("App");
    expect(result).toContain("Dashboard");
    expect(result).toContain("Tab switch");
  });
});

describe("handleProjectDetailKey", () => {
  it("handles escape", () => {
    const state = createProjectDetail();
    const result = handleProjectDetailKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
  });

  it("handles tab", () => {
    const state = createProjectDetail();
    const result = handleProjectDetailKey("\t", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles up/down", () => {
    const state = createProjectDetail();

    expect(handleProjectDetailKey("k", state).updater).toBeDefined();
    expect(handleProjectDetailKey("j", state).updater).toBeDefined();
  });

  it("handles enter for file expansion", () => {
    let state = createProjectDetail();
    state = setTab("files")(state);
    state = setFiles([
      { path: "src", name: "src", isDirectory: true, depth: 0 },
    ])(state);

    const result = handleProjectDetailKey("\r", state);

    expect(result.action).toBe("expand");
    expect(result.updater).toBeDefined();
  });

  it("handles o for browser", () => {
    const state = createProjectDetail();
    const result = handleProjectDetailKey("o", state);

    expect(result.action).toBe("browser");
  });

  it("handles number keys for tab selection", () => {
    const state = createProjectDetail();
    const result = handleProjectDetailKey("2", state);

    expect(result.updater).toBeDefined();
  });
});
