/**
 * Tests for header banner component
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createHeaderState,
  HeaderStateSchema,
  renderCompactHeader,
  renderHeaderBanner,
  renderLogo,
  ServerStatusSchema,
  setAgent,
  setProject,
  setServerStatus,
  setServerUrls,
} from "./header-banner.ts";

describe("ServerStatusSchema", () => {
  it("validates valid statuses", () => {
    expect(ServerStatusSchema.parse("starting")).toBe("starting");
    expect(ServerStatusSchema.parse("running")).toBe("running");
    expect(ServerStatusSchema.parse("error")).toBe("error");
    expect(ServerStatusSchema.parse("stopped")).toBe("stopped");
  });

  it("rejects invalid status", () => {
    expect(() => ServerStatusSchema.parse("invalid")).toThrow();
  });
});

describe("HeaderStateSchema", () => {
  it("validates full state", () => {
    const state = {
      status: "running",
      serverUrl: "http://localhost:8080",
      mcpUrl: "http://localhost:9999/mcp",
      agentName: "Claude Code",
      modelName: "claude-3.5-sonnet",
      projectName: "my-app",
      errorMessage: null,
    };

    const result = HeaderStateSchema.parse(state);
    expect(result.status).toBe("running");
    expect(result.serverUrl).toBe("http://localhost:8080");
  });

  it("validates minimal state", () => {
    const state = {
      status: "stopped",
      serverUrl: null,
      mcpUrl: null,
      agentName: null,
      modelName: null,
      projectName: null,
      errorMessage: null,
    };

    const result = HeaderStateSchema.parse(state);
    expect(result.status).toBe("stopped");
  });
});

describe("createHeaderState", () => {
  it("creates initial state", () => {
    const state = createHeaderState();

    expect(state.status).toBe("stopped");
    expect(state.serverUrl).toBeNull();
    expect(state.mcpUrl).toBeNull();
    expect(state.agentName).toBeNull();
    expect(state.modelName).toBeNull();
    expect(state.projectName).toBeNull();
    expect(state.errorMessage).toBeNull();
  });
});

describe("setServerStatus", () => {
  it("sets running status", () => {
    const state = createHeaderState();
    const updated = setServerStatus("running")(state);

    expect(updated.status).toBe("running");
    expect(updated.errorMessage).toBeNull();
  });

  it("sets error status with message", () => {
    const state = createHeaderState();
    const updated = setServerStatus("error", "Port in use")(state);

    expect(updated.status).toBe("error");
    expect(updated.errorMessage).toBe("Port in use");
  });
});

describe("setServerUrls", () => {
  it("sets server URL", () => {
    const state = createHeaderState();
    const updated = setServerUrls("http://localhost:8080")(state);

    expect(updated.serverUrl).toBe("http://localhost:8080");
    expect(updated.mcpUrl).toBeNull();
  });

  it("sets both URLs", () => {
    const state = createHeaderState();
    const updated = setServerUrls(
      "http://localhost:8080",
      "http://localhost:9999/mcp",
    )(state);

    expect(updated.serverUrl).toBe("http://localhost:8080");
    expect(updated.mcpUrl).toBe("http://localhost:9999/mcp");
  });
});

describe("setAgent", () => {
  it("sets agent name", () => {
    const state = createHeaderState();
    const updated = setAgent("Claude Code")(state);

    expect(updated.agentName).toBe("Claude Code");
    expect(updated.modelName).toBeNull();
  });

  it("sets agent with model", () => {
    const state = createHeaderState();
    const updated = setAgent("Claude Code", "claude-3.5-sonnet")(state);

    expect(updated.agentName).toBe("Claude Code");
    expect(updated.modelName).toBe("claude-3.5-sonnet");
  });
});

describe("setProject", () => {
  it("sets project name", () => {
    const state = createHeaderState();
    const updated = setProject("my-app")(state);

    expect(updated.projectName).toBe("my-app");
  });
});

describe("renderLogo", () => {
  it("returns 7 lines", () => {
    const logo = renderLogo();
    expect(logo.length).toBe(7);
  });

  it("contains filled and empty dots", () => {
    const logo = renderLogo();
    const joined = logo.join("");

    // Should contain both dot types (with ANSI codes)
    expect(joined).toContain("●");
    expect(joined).toContain("○");
  });
});

describe("renderHeaderBanner", () => {
  it("renders stopped state", () => {
    const state = createHeaderState();
    const result = renderHeaderBanner(state);

    expect(result).toContain("Veryfront Code");
    expect(result).toContain("stopped");
    expect(result).toContain("●"); // Logo
  });

  it("renders running state with full info", () => {
    let state = createHeaderState();
    state = setServerStatus("running")(state);
    state = setServerUrls("http://localhost:8080", "http://localhost:9999/mcp")(state);
    state = setAgent("Claude Code", "claude-3.5-sonnet")(state);
    state = setProject("my-app")(state);

    const result = renderHeaderBanner(state);

    expect(result).toContain("running");
    expect(result).toContain("http://localhost:8080");
    expect(result).toContain("http://localhost:9999/mcp");
    expect(result).toContain("Claude Code");
    expect(result).toContain("claude-3.5-sonnet");
    expect(result).toContain("my-app");
  });

  it("renders error state with message", () => {
    let state = createHeaderState();
    state = setServerStatus("error", "Port 8080 in use")(state);

    const result = renderHeaderBanner(state);

    expect(result).toContain("error");
    expect(result).toContain("Port 8080 in use");
  });
});

describe("renderCompactHeader", () => {
  it("renders minimal state", () => {
    const state = createHeaderState();
    const result = renderCompactHeader(state);

    expect(result).toContain("Veryfront");
    expect(result).toContain("stopped");
  });

  it("renders full state", () => {
    let state = createHeaderState();
    state = setServerStatus("running")(state);
    state = setAgent("Claude Code")(state);
    state = setProject("my-app")(state);

    const result = renderCompactHeader(state);

    expect(result).toContain("running");
    expect(result).toContain("Claude Code");
    expect(result).toContain("my-app");
  });
});
