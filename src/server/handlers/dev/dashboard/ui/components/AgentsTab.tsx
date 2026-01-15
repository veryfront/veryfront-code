import { useState } from "react";
import type { Agent, Tool } from "../App.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Card } from "./Card.tsx";
import { DetailHeader, EmptyState, TwoColumnLayout } from "./shared.tsx";

interface AgentsTabProps {
  agents: Agent[];
  tools: Tool[];
  onNavigateToMCP: (subTab: "tools" | "resources" | "prompts", itemId: string) => void;
}

export function AgentsTab({ agents, tools, onNavigateToMCP }: AgentsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredAgents = agents.filter((a) => a.id.toLowerCase().includes(search.toLowerCase()));
  const selectedAgent = agents.find((a) => a.id === selectedId);

  const sidebar = (
    <Sidebar
      search={search}
      onSearchChange={setSearch}
      items={filteredAgents.map((a) => ({ id: a.id, label: a.id }))}
      selectedId={selectedId}
      onSelect={setSelectedId}
      emptyMessage="No agents registered"
    />
  );

  return (
    <TwoColumnLayout sidebar={sidebar}>
      {selectedAgent
        ? (
          <AgentDetail
            agent={selectedAgent}
            tools={tools}
            onNavigateToMCP={onNavigateToMCP}
          />
        )
        : <EmptyState message="Select an agent" />}
    </TwoColumnLayout>
  );
}

interface AgentDetailProps {
  agent: Agent;
  tools: Tool[];
  onNavigateToMCP: (subTab: "tools" | "resources" | "prompts", itemId: string) => void;
}

function AgentDetail({ agent, tools, onNavigateToMCP }: AgentDetailProps) {
  const toolIds = Object.keys(agent.tools || {}).filter((k) => agent.tools[k]);

  return (
    <div>
      <DetailHeader title={agent.id} description={agent.description || "No description"} />

      <Card title="Configuration" className="mb-6">
        <table className="w-full text-sm">
          <tbody>
            <ConfigRow label="Model" value={agent.model} />
            <ConfigRow label="Streaming" value={agent.streaming ? "Enabled" : "Disabled"} />
            <ConfigRow label="Max Steps" value={agent.maxSteps ?? "Default"} last />
          </tbody>
        </table>
      </Card>

      {agent.system && (
        <Card title="System Prompt" className="mb-6">
          <div className="p-4">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-3 rounded-lg max-h-64 overflow-auto">
              {agent.system}
            </pre>
          </div>
        </Card>
      )}

      <Card title={`Tools (${toolIds.length})`} className="mb-6">
        <div className="p-3">
          {toolIds.length === 0
            ? <span className="text-sm text-gray-400">No tools configured</span>
            : (
              <div className="flex flex-wrap gap-1.5">
                {toolIds.map((id) => {
                  const exists = tools.some((t) => t.id === id);
                  return (
                    <Badge
                      key={id}
                      label={id}
                      exists={exists}
                      onClick={exists ? () => onNavigateToMCP("tools", id) : undefined}
                    />
                  );
                })}
              </div>
            )}
        </div>
      </Card>

      {agent.memory && (
        <Card title="Memory">
          <table className="w-full text-sm">
            <tbody>
              <ConfigRow label="Type" value={agent.memory.type || "-"} />
              <ConfigRow label="Max Tokens" value={agent.memory.maxTokens || "-"} last />
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function ConfigRow(
  { label, value, last }: { label: string; value: string | number; last?: boolean },
) {
  return (
    <tr className={last ? "" : "border-b"}>
      <td className="px-3 py-2.5 w-28 font-medium text-gray-600">{label}</td>
      <td className="px-3 py-2.5 text-gray-900">{value}</td>
    </tr>
  );
}

function Badge(
  { label, exists, onClick }: { label: string; exists: boolean; onClick?: () => void },
) {
  const base = "px-2.5 py-1 text-xs font-medium rounded transition-colors";
  if (!exists) {
    return <span className={`${base} bg-gray-100 text-gray-400`}>{label} (not found)</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} bg-sky-50 text-sky-600 hover:bg-sky-500 hover:text-white cursor-pointer`}
    >
      {label}
    </button>
  );
}
