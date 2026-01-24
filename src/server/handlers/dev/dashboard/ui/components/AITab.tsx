import { useEffect, useState } from "react";
import type { Agent, Prompt, Resource, Tool } from "../App.tsx";
import { MCPTab } from "./MCPTab.tsx";
import { AgentsTab } from "./AgentsTab.tsx";
import { WorkflowsTab } from "./WorkflowsTab.tsx";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState, PageLayout } from "./shared.tsx";

type SubTab = "mcp" | "agents" | "workflows" | "providers";

interface Provider {
  name: string;
  configured: boolean;
}

interface NodeInfo {
  id: string;
  type: string;
  agent?: string;
  tool?: string;
  dependsOn?: string[];
  children?: string[];
  message?: string;
}

interface WorkflowMetadata {
  id: string;
  description?: string;
  version?: string;
  timeout?: string | number;
  nodeCount: number;
  nodeTypes: string[];
  nodes: NodeInfo[];
  agentRefs: string[];
  toolRefs: string[];
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
  inputSchemaJson?: Record<string, unknown>;
  registeredAt: string;
}

interface AITabProps {
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  agents: Agent[];
}

export function AITab({ tools, resources, prompts, agents }: AITabProps): React.ReactElement {
  const [subTab, setSubTab] = useState<SubTab>("mcp");

  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState<string | null>(null);

  const [workflows, setWorkflows] = useState<WorkflowMetadata[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/_dev/api/infrastructure")
      .then((res) => res.json())
      .then((d) => {
        setProviders(d.providers ?? []);
        setProvidersError(null);
      })
      .catch((e: unknown) => setProvidersError((e as Error).message))
      .finally(() => setProvidersLoading(false));

    fetch("/_dev/api/workflows")
      .then((res) => res.json())
      .then((d) => {
        setWorkflows(d.workflows ?? []);
        setWorkflowsError(null);
      })
      .catch((e: unknown) => setWorkflowsError((e as Error).message))
      .finally(() => setWorkflowsLoading(false));
  }, []);

  function navigateToMCP(mcpSubTab: "tools" | "resources" | "prompts", itemId: string): void {
    setSubTab("mcp");
    globalThis.dispatchEvent(
      new CustomEvent("mcp-navigate", { detail: { subTab: mcpSubTab, itemId } }),
    );
  }

  const mcpCount = tools.length + resources.length + prompts.length;
  const configuredProvidersCount = providers.filter((p) => p.configured).length;

  return (
    <div className="min-h-screen">
      <div className="bg-white border-b">
        <div className="px-6 py-4">
          <div className="mb-3">
            <h1 className="text-xl font-semibold text-gray-900">AI</h1>
            <p className="text-sm text-gray-500">MCP, agents, workflows, and providers</p>
          </div>
          <div className="flex gap-1 border border-gray-200 rounded-lg p-1 bg-gray-50 w-fit">
            <TabButton
              active={subTab === "mcp"}
              onClick={() => setSubTab("mcp")}
              label={`MCP (${mcpCount})`}
            />
            <TabButton
              active={subTab === "agents"}
              onClick={() => setSubTab("agents")}
              label={`Agents (${agents.length})`}
            />
            <TabButton
              active={subTab === "workflows"}
              onClick={() => setSubTab("workflows")}
              label={`Workflows (${workflows.length})`}
            />
            <TabButton
              active={subTab === "providers"}
              onClick={() => setSubTab("providers")}
              label={`Providers (${configuredProvidersCount})`}
            />
          </div>
        </div>
      </div>

      {subTab === "mcp" && <MCPTab tools={tools} resources={resources} prompts={prompts} />}

      {subTab === "agents" && (
        <AgentsTab agents={agents} tools={tools} onNavigateToMCP={navigateToMCP} />
      )}

      {subTab === "workflows" && (
        <WorkflowsSection
          loading={workflowsLoading}
          error={workflowsError}
          workflows={workflows}
          agents={agents}
          tools={tools}
          onNavigateToTool={(toolId) => navigateToMCP("tools", toolId)}
          onNavigateToAgent={() => {
            setSubTab("agents");
            // AgentsTab will need to handle this
          }}
        />
      )}

      {subTab === "providers" && (
        <ProvidersSection providers={providers} loading={providersLoading} error={providersError} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active ? "bg-white text-sky-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {label}
    </button>
  );
}

function WorkflowsSection({
  loading,
  error,
  workflows,
  agents,
  tools,
  onNavigateToAgent,
  onNavigateToTool,
}: {
  loading: boolean;
  error: string | null;
  workflows: WorkflowMetadata[];
  agents: Agent[];
  tools: Tool[];
  onNavigateToAgent: (agentId: string) => void;
  onNavigateToTool: (toolId: string) => void;
}): React.ReactElement {
  if (loading) {
    return (
      <PageLayout title="" description="">
        <Card>
          <LoadingState message="Loading workflows..." />
        </Card>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout title="" description="">
        <Card>
          <ErrorState error={error} />
        </Card>
      </PageLayout>
    );
  }

  return (
    <WorkflowsTab
      workflows={workflows}
      agents={agents}
      tools={tools}
      onNavigateToAgent={onNavigateToAgent}
      onNavigateToTool={onNavigateToTool}
    />
  );
}

function ProvidersSection({
  providers,
  loading,
  error,
}: {
  providers: Provider[];
  loading: boolean;
  error: string | null;
}): React.ReactElement {
  if (loading) {
    return (
      <PageLayout title="" description="">
        <Card>
          <LoadingState message="Loading providers..." />
        </Card>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout title="" description="">
        <Card>
          <ErrorState error={error} />
        </Card>
      </PageLayout>
    );
  }

  const configured = providers.filter((p) => p.configured);
  const notConfigured = providers.filter((p) => !p.configured);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <div className="text-2xl font-bold text-gray-900">{configured.length}</div>
          <div className="text-sm text-gray-500">Configured</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-gray-400">{notConfigured.length}</div>
          <div className="text-sm text-gray-500">Not Configured</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-gray-900">{providers.length}</div>
          <div className="text-sm text-gray-500">Total Available</div>
        </Card>
      </div>

      <Card title="AI PROVIDERS">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Provider
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Status
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                API Key
              </th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.name} className="border-b last:border-0">
                <td className="px-3 py-3">
                  <code className="text-sm text-sky-600 font-medium">{provider.name}</code>
                </td>
                <td className="px-3 py-3">
                  {provider.configured
                    ? (
                      <span className="inline-flex items-center gap-1.5 text-green-600">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        Ready
                      </span>
                    )
                    : (
                      <span className="inline-flex items-center gap-1.5 text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-gray-300" />
                        Not configured
                      </span>
                    )}
                </td>
                <td className="px-3 py-3 text-gray-500 text-sm">
                  {provider.configured
                    ? <span className="text-green-600">(set)</span>
                    : <span className="text-gray-400">(not set)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
