/**
 * Code Command - Launch and manage coding agents
 *
 * Launches coding agents (Claude Code, Codex, Gemini, Aider, etc.) with PTY passthrough.
 * Supports listing installed agents and setting default preferences.
 */
import * as dntShim from "../../../_dnt.shims.js";


import { z } from "zod";
import { cwd } from "../../platform/compat/process.js";
import { cliLogger } from "../../utils/index.js";
import {
  buildAgentCommand,
  createAgentRegistry,
  detectInstalledAgents,
  getCLIAgents,
  getIDEAgents,
} from "../app/core/agents.js";
import { spawnAgent, waitForExit } from "../app/core/pty.js";
import { loadConfig, savePreferences } from "../app/core/config.js";
import type { CodingAgentDef } from "../app/core/types.js";
import { brand, dim, error, success } from "../ui/colors.js";
import type { ParsedArgs } from "../index/types.js";

// ============================================================================
// Types
// ============================================================================

export const CodeArgsSchema = z.object({
  agent: z.string().optional(),
  model: z.string().optional(),
  list: z.boolean().optional(),
  set: z.boolean().optional(),
  projectDir: z.string().optional(),
});

export type CodeArgs = z.infer<typeof CodeArgsSchema>;

export function parseCodeArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<CodeArgs, CodeArgs> {
  return CodeArgsSchema.safeParse({
    agent: args._[1] as string | undefined,
    model: args.model ?? args.m,
    list: Boolean(args.list ?? args.l),
    set: Boolean(args.set ?? args.s),
    projectDir: args.dir ?? args.d ?? cwd(),
  });
}

// ============================================================================
// List Command
// ============================================================================

function printAgentList(
  agents: CodingAgentDef[],
  installed: string[],
  label: string,
): void {
  console.log(`  ${dim(label)}`);
  for (const agent of agents) {
    const isInstalled = installed.includes(agent.id);
    const status = isInstalled ? success("[✓]") : error("[✗]");
    const name = isInstalled ? agent.name : dim(agent.name);
    const provider = dim(`(${agent.provider})`);
    console.log(`    ${status} ${name} ${provider}`);
  }
  console.log();
}

async function listAgents(): Promise<void> {
  const registry = createAgentRegistry();
  const installed = await detectInstalledAgents(registry);

  console.log();
  console.log(`  ${brand("Coding Agents")}`);
  console.log();

  printAgentList(getCLIAgents(registry), installed, "CLI Agents (embedded terminal):");
  printAgentList(getIDEAgents(registry), installed, "IDE Agents (opens external):");

  const config = await loadConfig();
  if (config.preferences.defaultAgent) {
    console.log(`  ${dim("Default:")} ${brand(config.preferences.defaultAgent)}`);
    if (config.preferences.defaultModel) {
      console.log(`  ${dim("Model:")} ${brand(config.preferences.defaultModel)}`);
    }
    console.log();
  }
}

// ============================================================================
// Set Default Command
// ============================================================================

async function setDefaultAgent(agentId: string, model?: string): Promise<void> {
  const registry = createAgentRegistry();
  const agent = registry.agents.find((a) => a.id === agentId);

  if (!agent) {
    cliLogger.error(`Unknown agent: ${agentId}`);
    cliLogger.info(`Run 'veryfront code --list' to see available agents`);
    return;
  }

  const installed = await detectInstalledAgents(registry);
  if (!installed.includes(agentId)) {
    cliLogger.warn(`Agent '${agentId}' is not installed`);
    cliLogger.info(`Command: ${agent.command}`);
  }

  // Validate model if provided
  if (model && agent.models && !agent.models.includes(model)) {
    cliLogger.warn(`Model '${model}' not in agent's model list`);
    cliLogger.info(`Available: ${agent.models.join(", ")}`);
  }

  const config = await loadConfig();
  await savePreferences({
    ...config.preferences,
    defaultAgent: agentId,
    defaultModel: model ?? agent.defaultModel ?? null,
  });

  console.log();
  console.log(`  ${success("✓")} Default agent set to ${brand(agent.name)}`);
  if (model) {
    console.log(`  ${success("✓")} Default model set to ${brand(model)}`);
  }
  console.log();
}

// ============================================================================
// Launch Agent
// ============================================================================

async function launchAgent(
  agentId: string,
  projectDir: string,
  model?: string,
): Promise<void> {
  const registry = createAgentRegistry();

  // Find agent by id or name
  const agent = registry.agents.find(
    (a) => a.id === agentId || a.name.toLowerCase() === agentId.toLowerCase(),
  );

  if (!agent) {
    cliLogger.error(`Unknown agent: ${agentId}`);
    cliLogger.info(`Run 'veryfront code --list' to see available agents`);
    return;
  }

  const installed = await detectInstalledAgents(registry);
  if (!installed.includes(agent.id)) {
    cliLogger.error(`Agent '${agent.name}' is not installed`);
    cliLogger.info(`Install with: ${agent.command.split(" ")[0]}`);
    return;
  }

  // Handle IDE agents - open externally
  if (agent.type === "ide") {
    console.log(`  ${dim("Opening")} ${brand(agent.name)} ${dim("...")}`);

    const { command, args } = buildAgentCommand(agent, projectDir);

    try {
      const proc = new dntShim.Deno.Command(command, {
        args,
        cwd: projectDir,
        stdin: "null",
        stdout: "null",
        stderr: "null",
      });
      proc.spawn();
      console.log(`  ${success("✓")} Opened ${agent.name}`);
    } catch (err) {
      cliLogger.error(`Failed to open ${agent.name}: ${err}`);
    }
    return;
  }

  // CLI agents - PTY passthrough
  console.log();
  console.log(`  ${dim("Launching")} ${brand(agent.name)} ${dim("...")}`);
  if (model) {
    console.log(`  ${dim("Model:")} ${brand(model)}`);
  }
  console.log(`  ${dim("Project:")} ${brand(projectDir)}`);
  console.log();

  // Build command with model - buildAgentCommand handles model flags per agent
  const { command, args } = buildAgentCommand(agent, projectDir, model);
  const agentWithCommand: CodingAgentDef = { ...agent, command: [command, ...args].join(" ") };

  const result = spawnAgent(agentWithCommand, { cwd: projectDir });

  if (!result.success) {
    cliLogger.error(`Failed to start agent: ${result.error}`);
    return;
  }

  // Wait for agent to exit
  if (result.process) {
    const finalSession = await waitForExit(result.process, result.session);
    if (finalSession.state === "error") {
      cliLogger.error(`Agent error: ${finalSession.error}`);
    }
  }
}

// ============================================================================
// Main Command
// ============================================================================

export async function codeCommand(args: CodeArgs): Promise<void> {
  const projectDir = args.projectDir ?? cwd();

  // List agents
  if (args.list) {
    await listAgents();
    return;
  }

  // Set default agent
  if (args.set && args.agent) {
    await setDefaultAgent(args.agent, args.model);
    return;
  }

  // If no agent specified, check for default
  let agentId = args.agent;
  let model = args.model;

  if (!agentId) {
    const config = await loadConfig();
    if (config.preferences.defaultAgent) {
      agentId = config.preferences.defaultAgent;
      model = model ?? config.preferences.defaultModel ?? undefined;
    } else {
      // Show list and prompt
      await listAgents();
      console.log(`  ${dim("Usage:")} veryfront code <agent> [--model <model>]`);
      console.log(`  ${dim("Set default:")} veryfront code --set <agent> [--model <model>]`);
      console.log();
      return;
    }
  }

  // Launch the agent
  await launchAgent(agentId, projectDir, model);
}
