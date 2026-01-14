import { useEffect, useState } from "react";
import { Header } from "./components/Header.tsx";
import { TabNav } from "./components/TabNav.tsx";
import { MCPTab } from "./components/MCPTab.tsx";
import { AgentsTab } from "./components/AgentsTab.tsx";
import { FilesTab } from "./components/FilesTab.tsx";
import { HandlersTab } from "./components/HandlersTab.tsx";
import { MetricsTab } from "./components/MetricsTab.tsx";
import { APITab } from "./components/APITab.tsx";
import { DebugTab } from "./components/DebugTab.tsx";

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
  tools: Record<string, boolean>;
  prompts: Record<string, boolean>;
  resources: Record<string, boolean>;
  memory: { type: string; maxTokens: number } | null;
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

export interface Stats {
  mcp: { tools: number; resources: number; prompts: number; total: number };
  agents: number;
}

export type TabId = "mcp" | "agents" | "files" | "handlers" | "metrics" | "api" | "debug";

const TABS: { id: TabId; label: string }[] = [
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
  { id: "files", label: "Files" },
  { id: "handlers", label: "Handlers" },
  { id: "metrics", label: "Metrics" },
  { id: "api", label: "API" },
  { id: "debug", label: "Debug" },
];

export function App() {
  const [currentTab, setCurrentTab] = useState<TabId>("mcp");
  const [stats, setStats] = useState<Stats | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    fetchStats();
    fetchData();
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch("/_dev/api/stats");
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    }
  }

  async function fetchData() {
    try {
      const [t, r, p, a] = await Promise.all([
        fetch("/_dev/api/tools").then((r) => r.json()),
        fetch("/_dev/api/resources").then((r) => r.json()),
        fetch("/_dev/api/prompts").then((r) => r.json()),
        fetch("/_dev/api/agents").then((r) => r.json()),
      ]);
      setTools(t.tools || []);
      setResources(r.resources || []);
      setPrompts(p.prompts || []);
      setAgents(a.agents || []);
    } catch (e) {
      console.error("Failed to fetch data:", e);
    }
  }

  function navigateToMCP(subTab: "tools" | "resources" | "prompts", itemId: string) {
    setCurrentTab("mcp");
    // Pass down to MCP tab via key change to trigger selection
    globalThis.dispatchEvent(new CustomEvent("mcp-navigate", { detail: { subTab, itemId } }));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header stats={stats} />
      <TabNav tabs={TABS} currentTab={currentTab} onTabChange={setCurrentTab} />

      <div className="tab-content">
        {currentTab === "mcp" && <MCPTab tools={tools} resources={resources} prompts={prompts} />}
        {currentTab === "agents" && (
          <AgentsTab
            agents={agents}
            tools={tools}
            resources={resources}
            prompts={prompts}
            onNavigateToMCP={navigateToMCP}
          />
        )}
        {currentTab === "files" && <FilesTab />}
        {currentTab === "handlers" && <HandlersTab />}
        {currentTab === "metrics" && <MetricsTab />}
        {currentTab === "api" && <APITab />}
        {currentTab === "debug" && <DebugTab />}
      </div>
    </div>
  );
}
