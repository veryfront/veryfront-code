import { useEffect, useState } from "react";
import { Header } from "./components/Header.tsx";
import { TabNav } from "./components/TabNav.tsx";
import { AgentTab } from "./components/AgentTab.tsx";
import { ServerTab } from "./components/ServerTab.tsx";
import { RuntimeTab } from "./components/RuntimeTab.tsx";
import { FilesTab } from "./components/FilesTab.tsx";
import { ErrorsTab } from "./components/ErrorsTab.tsx";
import { ConfigTab } from "./components/ConfigTab.tsx";
import { APITab } from "./components/APITab.tsx";
import {
  expectFiniteJsonNumber,
  expectJsonArray,
  expectJsonBoolean,
  expectJsonObject,
  expectJsonString,
  requestJson,
  runOwnedRequest,
  useLatestRequestOwner,
} from "../browser-request.ts";

export interface Tool {
  id: string;
  type: string;
  description: string;
  schema: { properties?: Record<string, unknown>; required?: string[] } | null;
  mcp: { enabled: boolean };
}

export interface Resource {
  id: string;
  pattern: string;
  description: string;
  mcp: { enabled: boolean };
}

export interface Prompt {
  id: string;
  description: string;
}

export interface Agent {
  id: string;
  description: string;
  model: string;
  system: string | null;
  tools: Record<string, boolean>;
  memory: { type: string; maxTokens?: number } | null;
  streaming: boolean;
  maxSteps: number | null;
}

export interface FileItem {
  name: string;
  type: "file" | "directory";
  path: string;
}

export interface Handler {
  name: string;
  priority: number;
  patterns: Array<{ pattern: string; exact?: boolean; prefix?: boolean; method?: string }>;
  enabled: string;
}

export type TabId = "agent" | "server" | "runtime" | "files" | "errors" | "config" | "api";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "agent", label: "Agent" },
  { id: "server", label: "Server" },
  { id: "runtime", label: "Runtime" },
  { id: "files", label: "Files" },
  { id: "errors", label: "Errors" },
  { id: "config", label: "Config" },
  { id: "api", label: "API" },
];

const MAX_DASHBOARD_ITEMS = 1_000;
const MAX_DASHBOARD_ID_CHARACTERS = 512;
const MAX_DASHBOARD_TEXT_CHARACTERS = 16_384;

function dashboardString(value: unknown, label: string, allowEmpty = true): string {
  return expectJsonString(value, label, MAX_DASHBOARD_TEXT_CHARACTERS, allowEmpty);
}

function admitMcp(value: unknown, label: string): { enabled: boolean } {
  const mcp = expectJsonObject(value, label);
  return {
    enabled: mcp.enabled === undefined ? true : expectJsonBoolean(mcp.enabled, `${label}.enabled`),
  };
}

function admitTool(value: unknown, index: number): Tool {
  const label = `tools response.tools[${index}]`;
  const tool = expectJsonObject(value, label);
  let schema: Tool["schema"] = null;
  if (tool.schema !== null) {
    const schemaRecord = expectJsonObject(tool.schema, `${label}.schema`);
    let properties: Record<string, unknown> | undefined;
    if (schemaRecord.properties !== undefined) {
      properties = expectJsonObject(schemaRecord.properties, `${label}.schema.properties`);
    }
    let required: string[] | undefined;
    if (schemaRecord.required !== undefined) {
      required = expectJsonArray(
        schemaRecord.required,
        `${label}.schema.required`,
        MAX_DASHBOARD_ITEMS,
      ).map((entry, requiredIndex) =>
        dashboardString(entry, `${label}.schema.required[${requiredIndex}]`, false)
      );
    }
    schema = {
      ...(properties === undefined ? {} : { properties }),
      ...(required ? { required } : {}),
    };
  }

  return {
    id: expectJsonString(tool.id, `${label}.id`, MAX_DASHBOARD_ID_CHARACTERS, false),
    type: dashboardString(tool.type, `${label}.type`, false),
    description: dashboardString(tool.description, `${label}.description`),
    schema,
    mcp: admitMcp(tool.mcp, `${label}.mcp`),
  };
}

function admitResource(value: unknown, index: number): Resource {
  const label = `resources response.resources[${index}]`;
  const resource = expectJsonObject(value, label);
  return {
    id: expectJsonString(resource.id, `${label}.id`, MAX_DASHBOARD_ID_CHARACTERS, false),
    pattern: dashboardString(resource.pattern, `${label}.pattern`, false),
    description: dashboardString(resource.description, `${label}.description`),
    mcp: admitMcp(resource.mcp, `${label}.mcp`),
  };
}

function admitPrompt(value: unknown, index: number): Prompt {
  const label = `prompts response.prompts[${index}]`;
  const prompt = expectJsonObject(value, label);
  return {
    id: expectJsonString(prompt.id, `${label}.id`, MAX_DASHBOARD_ID_CHARACTERS, false),
    description: dashboardString(prompt.description, `${label}.description`),
  };
}

function admitAgent(value: unknown, index: number): Agent {
  const label = `agents response.agents[${index}]`;
  const agent = expectJsonObject(value, label);
  const toolsRecord = expectJsonObject(agent.tools, `${label}.tools`);
  const tools = Object.create(null) as Record<string, boolean>;
  for (const [toolId, enabled] of Object.entries(toolsRecord)) {
    tools[toolId] = expectJsonBoolean(enabled, `${label}.tools.${toolId}`);
  }

  let memory: Agent["memory"] = null;
  if (agent.memory !== null) {
    const memoryRecord = expectJsonObject(agent.memory, `${label}.memory`);
    const maxTokens = memoryRecord.maxTokens === undefined
      ? undefined
      : expectFiniteJsonNumber(memoryRecord.maxTokens, `${label}.memory.maxTokens`);
    memory = {
      type: dashboardString(memoryRecord.type, `${label}.memory.type`, false),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    };
  }

  let system: string | null = null;
  if (agent.system !== null) system = dashboardString(agent.system, `${label}.system`);

  let maxSteps: number | null = null;
  if (agent.maxSteps !== null) {
    maxSteps = expectFiniteJsonNumber(agent.maxSteps, `${label}.maxSteps`);
  }

  return {
    id: expectJsonString(agent.id, `${label}.id`, MAX_DASHBOARD_ID_CHARACTERS, false),
    description: dashboardString(agent.description, `${label}.description`),
    model: dashboardString(agent.model, `${label}.model`, false),
    system,
    tools,
    memory,
    streaming: expectJsonBoolean(agent.streaming, `${label}.streaming`),
    maxSteps,
  };
}

function admitCollection<T>(
  value: unknown,
  responseLabel: string,
  property: string,
  admitItem: (entry: unknown, index: number) => T,
): T[] {
  const response = expectJsonObject(value, responseLabel);
  return expectJsonArray(response[property], `${responseLabel}.${property}`, MAX_DASHBOARD_ITEMS)
    .map(admitItem);
}

export const admitToolsResponse = (value: unknown): Tool[] =>
  admitCollection(value, "tools response", "tools", admitTool);
export const admitResourcesResponse = (value: unknown): Resource[] =>
  admitCollection(value, "resources response", "resources", admitResource);
export const admitPromptsResponse = (value: unknown): Prompt[] =>
  admitCollection(value, "prompts response", "prompts", admitPrompt);
export const admitAgentsResponse = (value: unknown): Agent[] =>
  admitCollection(value, "agents response", "agents", admitAgent);

interface DashboardOverview {
  readonly tools: Tool[];
  readonly resources: Resource[];
  readonly prompts: Prompt[];
  readonly agents: Agent[];
}

export function App(): React.JSX.Element {
  const [currentTab, setCurrentTab] = useState<TabId>("agent");
  const [tools, setTools] = useState<Tool[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const overviewRequests = useLatestRequestOwner();

  useEffect((): void => {
    void runOwnedRequest(
      overviewRequests,
      async (signal): Promise<DashboardOverview> => {
        const [tools, resources, prompts, agents] = await Promise.all([
          requestJson("/_dev/api/tools", {
            responseLabel: "Dashboard tools",
            admit: admitToolsResponse,
            init: { signal },
          }),
          requestJson("/_dev/api/resources", {
            responseLabel: "Dashboard resources",
            admit: admitResourcesResponse,
            init: { signal },
          }),
          requestJson("/_dev/api/prompts", {
            responseLabel: "Dashboard prompts",
            admit: admitPromptsResponse,
            init: { signal },
          }),
          requestJson("/_dev/api/agents", {
            responseLabel: "Dashboard agents",
            admit: admitAgentsResponse,
            init: { signal },
          }),
        ]);
        return { tools, resources, prompts, agents };
      },
      {
        success: (overview) => {
          setTools(overview.tools);
          setResources(overview.resources);
          setPrompts(overview.prompts);
          setAgents(overview.agents);
        },
        error: (requestError) => console.error("Failed to load dashboard overview:", requestError),
      },
    );
  }, [overviewRequests]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <TabNav tabs={TABS} currentTab={currentTab} onTabChange={setCurrentTab} />

      <div className="tab-content">
        {currentTab === "agent" && (
          <AgentTab tools={tools} resources={resources} prompts={prompts} agents={agents} />
        )}
        {currentTab === "server" && <ServerTab />}
        {currentTab === "runtime" && <RuntimeTab />}
        {currentTab === "files" && <FilesTab />}
        {currentTab === "errors" && <ErrorsTab />}
        {currentTab === "config" && <ConfigTab />}
        {currentTab === "api" && <APITab />}
      </div>
    </div>
  );
}
