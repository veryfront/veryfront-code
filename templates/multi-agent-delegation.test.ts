/**
 * Runtime wiring gate for the `multi-agent-system` starter.
 *
 * The template's whole subject is delegation, and it shipped with a
 * coordinator that had no one to coordinate: the orchestrator built its
 * delegate tools from a top-level `getAgentsAsTools()`, but `agent()`
 * registers on call and discovery loads `agents/orchestrator.ts` before
 * `researcher.ts` and `writer.ts` — so that call ran against an empty
 * registry and produced nothing.
 *
 * Neither of the gates beside this one could see it. `deno check` and
 * `deno lint` in `scaffold-quality.test.ts` grade the scaffold's syntax and
 * types, and both were happy with a coordinator wired to nothing; the
 * delegation tests under `src/agent` use synthetic agents, so they never
 * touch this template.
 *
 * These tests load the template's own agent modules — orchestrator FIRST,
 * the order that used to break it — and assert the delegate tools exist and
 * resolve to the specialists the template ships. Execution is stubbed: the
 * point is the wiring, and resolving a delegate is the step that was broken.
 *
 * @module templates/multi-agent-delegation.test
 */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildAgentDelegateTools, getAgent } from "#veryfront/agent/index.ts";
import type { Agent } from "#veryfront/agent/types.ts";

const TEMPLATE_AGENTS = "./files/multi-agent-system/agents";

/** The specialists the orchestrator names in `delegates`. */
const DELEGATE_IDS = ["researcher", "writer"] as const;

/**
 * Load the template exactly the way project discovery does — coordinator
 * first. Load order is the failure this file exists to catch, so it is fixed
 * here rather than left to whatever order the imports happen to run in.
 */
async function loadTemplateAgents(): Promise<Agent> {
  const orchestrator = (await import(`${TEMPLATE_AGENTS}/orchestrator.ts`)).default as Agent;
  await import(`${TEMPLATE_AGENTS}/researcher.ts`);
  await import(`${TEMPLATE_AGENTS}/writer.ts`);
  return orchestrator;
}

function delegateToolNames(agent: Agent): string[] {
  const tools = agent.config?.tools;
  if (!tools || typeof tools !== "object") return [];
  return Object.keys(tools).filter((name) => name.startsWith("agent_")).sort();
}

describe("multi-agent-system template delegation", () => {
  it("gives the orchestrator a delegate tool per specialist, loaded coordinator-first", async () => {
    const orchestrator = await loadTemplateAgents();

    assertEquals(
      delegateToolNames(orchestrator),
      ["agent_researcher", "agent_writer"],
      "the coordinator must ship with tools for the agents it coordinates",
    );
  });

  it("resolves each delegate to the agent the template registers", async () => {
    await loadTemplateAgents();

    for (const id of DELEGATE_IDS) {
      const resolved = getAgent(id);
      assert(resolved !== undefined, `delegate "${id}" is not registered`);
      assertEquals(resolved.id, id);
    }
  });

  /**
   * The delegate tool resolves its target when it runs, not when it is built.
   * Executing it with a stub proves the lookup reaches the registered agent
   * instead of the "not available" branch it took when the registry was empty
   * at build time.
   */
  it("hands the registered specialist to the executor when a delegate runs", async () => {
    await loadTemplateAgents();

    const delegatedTo: string[] = [];
    const tools = buildAgentDelegateTools({
      delegates: [...DELEGATE_IDS],
      selfId: "orchestrator",
      executeDelegate: ({ delegateId, agent }) => {
        delegatedTo.push(`${delegateId}:${agent.id}`);
        return Promise.resolve({ text: "stubbed", toolCalls: 0 });
      },
    });

    for (const id of DELEGATE_IDS) {
      const tool = tools[`agent_${id}`];
      assert(tool !== undefined, `no agent_${id} tool was built`);
      await tool.execute?.({
        description: "test",
        prompt: "test",
        context: {},
      }, undefined);
    }

    assertEquals(delegatedTo, ["researcher:researcher", "writer:writer"]);
  });
});
