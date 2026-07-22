import "#veryfront/schemas/_test-setup.ts";
import { CONFIG_INVALID } from "#veryfront/errors";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { DevAgentAgUiFallback } from "./dev-agent-ag-ui-fallback.ts";

function createContext(
  adapter: ReturnType<typeof createMockAdapter>,
  isLocalProject = true,
): HandlerContext {
  return {
    projectDir: "/test/project",
    adapter,
    securityConfig: null,
    cspUserHeader: null,
    isLocalProject,
  };
}

function createMissInput(
  input: {
    adapter: ReturnType<typeof createMockAdapter>;
    url?: string;
    method?: string;
    isLocalProject?: boolean;
  },
) {
  const request = new Request(input.url ?? "http://localhost/api/ag-ui", {
    method: input.method ?? "POST",
  });
  return {
    request,
    pathname: new URL(request.url).pathname,
    ctx: createContext(input.adapter, input.isLocalProject ?? true),
  };
}

describe("DevAgentAgUiFallback", () => {
  it("delegates exact local POST /api/ag-ui misses to the hosted route set", async () => {
    const adapter = createMockAdapter();
    let createCalls = 0;
    let handledUrl = "";
    const fallback = new DevAgentAgUiFallback({
      projectDir: "/test/project",
      adapter,
      createRuntime: (options) => {
        createCalls++;
        assertEquals(options.projectDir, "/test/project");
        assertEquals(options.baseDir, "/test/project");
        return Promise.resolve({
          routeSet: {
            handleAgUiRequest(request: Request) {
              handledUrl = request.url;
              return Response.json({ delegated: true });
            },
          },
          lifecycle: { stop: () => Promise.resolve() },
        } as never);
      },
    });

    const response = await fallback.handle(createMissInput({ adapter }));

    assertEquals(response?.status, 200);
    assertEquals(await response?.json(), { delegated: true });
    assertEquals(handledUrl, "http://localhost/api/ag-ui");
    assertEquals(createCalls, 1);
  });

  it("declines non-local, non-POST, and non-exact AG-UI requests", async () => {
    const adapter = createMockAdapter();
    let createCalls = 0;
    const fallback = new DevAgentAgUiFallback({
      projectDir: "/test/project",
      adapter,
      createRuntime: () => {
        createCalls++;
        throw new Error("should not create runtime");
      },
    });

    assertEquals(
      await fallback.handle(createMissInput({ adapter, method: "GET" })),
      null,
    );
    assertEquals(
      await fallback.handle(createMissInput({ adapter, url: "http://localhost/api/ag-ui/resume" })),
      null,
    );
    assertEquals(
      await fallback.handle(createMissInput({ adapter, isLocalProject: false })),
      null,
    );
    assertEquals(createCalls, 0);
  });

  it("returns a structured 400 when multiple project agents require selection", async () => {
    const adapter = createMockAdapter();
    const fallback = new DevAgentAgUiFallback({
      projectDir: "/test/project",
      adapter,
      createRuntime: () =>
        Promise.reject(
          CONFIG_INVALID.create({
            detail:
              "agentId is required when agent discovery does not resolve to exactly one agent. Discovered agents: alpha, beta.",
          }),
        ),
    });

    const response = await fallback.handle(createMissInput({ adapter }));

    assertEquals(response?.status, 400);
    assertEquals(await response?.json(), {
      error: "AGENT_SELECTION_REQUIRED",
      errorCode: "AGENT_SELECTION_REQUIRED",
      message: "Select an agent for /api/ag-ui when multiple project agents are discovered.",
      agents: ["alpha", "beta"],
    });
  });

  it("keeps zero-agent projects on the normal unmatched-route path", async () => {
    const adapter = createMockAdapter();
    const fallback = new DevAgentAgUiFallback({
      projectDir: "/test/project",
      adapter,
      createRuntime: () =>
        Promise.reject(
          CONFIG_INVALID.create({
            detail:
              "agentId is required when agent discovery does not resolve to exactly one agent. Discovered agents: none.",
          }),
        ),
    });

    assertEquals(await fallback.handle(createMissInput({ adapter })), null);
  });

  it("invalidates the cached hosted runtime", async () => {
    const adapter = createMockAdapter();
    let createCalls = 0;
    let stopCalls = 0;
    const fallback = new DevAgentAgUiFallback({
      projectDir: "/test/project",
      adapter,
      createRuntime: () => {
        createCalls++;
        return Promise.resolve({
          routeSet: {
            handleAgUiRequest: () => Response.json({ createCalls }),
          },
          lifecycle: {
            stop: () => {
              stopCalls++;
              return Promise.resolve();
            },
          },
        } as never);
      },
    });

    const first = await fallback.handle(createMissInput({ adapter }));
    fallback.invalidate();
    await Promise.resolve();
    const second = await fallback.handle(createMissInput({ adapter }));

    assertEquals(await first?.json(), { createCalls: 1 });
    assertEquals(await second?.json(), { createCalls: 2 });
    assertEquals(stopCalls, 1);
  });
});
