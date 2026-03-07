import { useEffect, useState } from "react";
import { Header } from "./components/Header.tsx";
import { TabNav } from "./components/TabNav.tsx";
import { AITab } from "./components/AITab.tsx";
import { ServerTab } from "./components/ServerTab.tsx";
import { RuntimeTab } from "./components/RuntimeTab.tsx";
import { FilesTab } from "./components/FilesTab.tsx";
import { ErrorsTab } from "./components/ErrorsTab.tsx";
import { ConfigTab } from "./components/ConfigTab.tsx";
import { APITab } from "./components/APITab.tsx";

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

export type TabId = "ai" | "server" | "runtime" | "files" | "errors" | "config" | "api";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "ai", label: "AI" },
  { id: "server", label: "Server" },
  { id: "runtime", label: "Runtime" },
  { id: "files", label: "Files" },
  { id: "errors", label: "Errors" },
  { id: "config", label: "Config" },
  { id: "api", label: "API" },
];

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

export function App(): JSX.Element {
  const [currentTab, setCurrentTab] = useState<TabId>("ai");
  const [tools, setTools] = useState<Tool[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect((): void => {
    async function fetchData(): Promise<void> {
      try {
        const [t, r, p, a] = await Promise.all([
          fetchJson("/_dev/api/tools"),
          fetchJson("/_dev/api/resources"),
          fetchJson("/_dev/api/prompts"),
          fetchJson("/_dev/api/agents"),
        ]);

        const asRecord = (v: unknown): Record<string, unknown> =>
          v && typeof v === "object" ? (v as Record<string, unknown>) : {};
        setTools((asRecord(t).tools as Tool[]) ?? []);
        setResources((asRecord(r).resources as Resource[]) ?? []);
        setPrompts((asRecord(p).prompts as Prompt[]) ?? []);
        setAgents((asRecord(a).agents as Agent[]) ?? []);
      } catch (e) {
        console.error("Failed to fetch data:", e);
      }
    }

    void fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <TabNav tabs={TABS} currentTab={currentTab} onTabChange={setCurrentTab} />

      <div className="tab-content">
        {currentTab === "ai" && (
          <AITab tools={tools} resources={resources} prompts={prompts} agents={agents} />
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
