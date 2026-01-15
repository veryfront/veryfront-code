import { useEffect, useState } from "react";
import type { Prompt, Resource, Tool } from "../App.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Card } from "./Card.tsx";
import { ActionButton, DetailHeader, EmptyState, ResultBox, TwoColumnLayout } from "./shared.tsx";

type SubTab = "tools" | "resources" | "prompts";

interface MCPTabProps {
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
}

export function MCPTab({ tools, resources, prompts }: MCPTabProps) {
  const [subTab, setSubTab] = useState<SubTab>("tools");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function handleNavigate(e: CustomEvent<{ subTab: SubTab; itemId: string }>) {
      setSubTab(e.detail.subTab);
      setSelectedId(e.detail.itemId);
    }
    globalThis.addEventListener("mcp-navigate", handleNavigate as EventListener);
    return () => globalThis.removeEventListener("mcp-navigate", handleNavigate as EventListener);
  }, []);

  const items = subTab === "tools" ? tools : subTab === "resources" ? resources : prompts;
  const filteredItems = items.filter((item) => {
    const id = "id" in item ? item.id : (item as Resource).pattern;
    return id.toLowerCase().includes(search.toLowerCase());
  });

  const selectedItem = items.find((item) => {
    const id = "id" in item ? item.id : (item as Resource).pattern;
    return id === selectedId;
  });

  const sidebar = (
    <Sidebar
      search={search}
      onSearchChange={setSearch}
      subTabs={[
        { id: "tools", label: `Tools (${tools.length})` },
        { id: "resources", label: `Resources (${resources.length})` },
        { id: "prompts", label: `Prompts (${prompts.length})` },
      ]}
      currentSubTab={subTab}
      onSubTabChange={(id) => {
        setSubTab(id as SubTab);
        setSelectedId(null);
      }}
      items={filteredItems.map((item) => {
        const id = "id" in item ? item.id : (item as Resource).pattern;
        return { id, label: id };
      })}
      selectedId={selectedId}
      onSelect={setSelectedId}
      emptyMessage={`No ${subTab} registered`}
    />
  );

  function renderDetail() {
    if (!selectedItem) return <EmptyState message="Select an item to inspect" />;
    if (subTab === "tools") return <ToolDetail tool={selectedItem as Tool} />;
    if (subTab === "resources") return <ResourceDetail resource={selectedItem as Resource} />;
    return <PromptDetail prompt={selectedItem as Prompt} />;
  }

  return <TwoColumnLayout sidebar={sidebar}>{renderDetail()}</TwoColumnLayout>;
}

/**
 * Generate example values from a JSON schema
 */
function generateExampleFromSchema(schema: Tool["schema"]): Record<string, unknown> {
  if (!schema?.properties) return {};

  const example: Record<string, unknown> = {};

  for (const [name, prop] of Object.entries(schema.properties)) {
    const propDef = prop as {
      type?: string;
      default?: unknown;
      enum?: unknown[];
      description?: string;
    };

    // Use default value if available
    if (propDef.default !== undefined) {
      example[name] = propDef.default;
      continue;
    }

    // Use first enum value if available
    if (propDef.enum && propDef.enum.length > 0) {
      example[name] = propDef.enum[0];
      continue;
    }

    // Generate example based on type
    switch (propDef.type) {
      case "string":
        example[name] = `example-${name}`;
        break;
      case "number":
      case "integer":
        example[name] = 1;
        break;
      case "boolean":
        example[name] = true;
        break;
      case "array":
        example[name] = [];
        break;
      case "object":
        example[name] = {};
        break;
      default:
        example[name] = null;
    }
  }

  return example;
}

function ToolDetail({ tool }: { tool: Tool }) {
  const [args, setArgs] = useState(() => {
    const example = generateExampleFromSchema(tool.schema);
    return JSON.stringify(example, null, 2);
  });
  const [result, setResult] = useState<
    { success: boolean; data: string; duration?: number } | null
  >(null);
  const [loading, setLoading] = useState(false);

  // Update args when tool changes
  useEffect(() => {
    const example = generateExampleFromSchema(tool.schema);
    setArgs(JSON.stringify(example, null, 2));
    setResult(null);
  }, [tool.id]);

  async function execute() {
    let parsed;
    try {
      parsed = JSON.parse(args);
    } catch (e) {
      setResult({ success: false, data: (e as Error).message });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/_dev/api/execute-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: tool.id, args: parsed }),
      });
      const d = await res.json();
      if (d.error) setResult({ success: false, data: d.error });
      else {setResult({
          success: true,
          data: JSON.stringify(d.result, null, 2),
          duration: d.duration,
        });}
    } catch (e) {
      setResult({ success: false, data: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <DetailHeader title={tool.id} description={tool.description || "No description"} />

      {tool.schema?.properties && (
        <Card title="Input Schema" className="mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Name
                </th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Type
                </th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(tool.schema.properties).map(([name, prop]) => (
                <tr key={name} className="border-b last:border-0">
                  <td className="px-3 py-2.5">
                    <code className="text-xs text-sky-600 font-medium">{name}</code>
                    {tool.schema?.required?.includes(name) && (
                      <span className="ml-1.5 px-1 py-0.5 bg-red-50 text-red-600 text-[9px] font-semibold uppercase rounded">
                        required
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-medium font-mono rounded">
                      {(prop as { type?: string }).type || "any"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">
                    {(prop as { description?: string }).description || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Execute">
        <div className="p-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-600 mb-1">
            Arguments (JSON)
          </label>
          <textarea
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm font-mono focus:outline-none focus:border-sky-500 focus:bg-white min-h-[80px] resize-y"
          />
          <ActionButton onClick={execute} loading={loading} loadingText="Running...">
            Run
          </ActionButton>
          {result && (
            <ResultBox
              success={result.success}
              label={result.success ? "Success" : "Error"}
              duration={result.duration}
            >
              {result.data}
            </ResultBox>
          )}
        </div>
      </Card>
    </div>
  );
}

function ResourceDetail({ resource }: { resource: Resource }) {
  const [uri, setUri] = useState(resource.pattern);
  const [result, setResult] = useState<
    { success: boolean; data: string; duration?: number } | null
  >(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUri(resource.pattern);
    setResult(null);
  }, [resource.pattern]);

  async function read() {
    setLoading(true);
    try {
      const res = await fetch("/_dev/api/read-resource", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri }),
      });
      const d = await res.json();
      if (d.error) setResult({ success: false, data: d.error });
      else {setResult({
          success: true,
          data: JSON.stringify(d.data, null, 2),
          duration: d.duration,
        });}
    } catch (e) {
      setResult({ success: false, data: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <DetailHeader
        title={resource.pattern}
        description={resource.description || "No description"}
      />

      <Card title="Read Resource">
        <div className="p-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-600 mb-1">
            URI
          </label>
          <input
            type="text"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm focus:outline-none focus:border-sky-500 focus:bg-white"
          />
          <ActionButton onClick={read} loading={loading} loadingText="Reading...">
            Read
          </ActionButton>
          {result && (
            <ResultBox
              success={result.success}
              label={result.success ? "Success" : "Error"}
              duration={result.duration}
            >
              {result.data}
            </ResultBox>
          )}
        </div>
      </Card>
    </div>
  );
}

function PromptDetail({ prompt }: { prompt: Prompt }) {
  const [variables, setVariables] = useState("{}");
  const [result, setResult] = useState<{ success: boolean; data: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function render() {
    let parsed;
    try {
      parsed = JSON.parse(variables);
    } catch (e) {
      setResult({ success: false, data: (e as Error).message });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/_dev/api/render-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: prompt.id, variables: parsed }),
      });
      const d = await res.json();
      if (d.error) setResult({ success: false, data: d.error });
      else setResult({ success: true, data: d.content });
    } catch (e) {
      setResult({ success: false, data: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <DetailHeader title={prompt.id} description={prompt.description || "No description"} />

      <Card title="Render Prompt">
        <div className="p-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-600 mb-1">
            Variables (JSON)
          </label>
          <textarea
            value={variables}
            onChange={(e) => setVariables(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm font-mono focus:outline-none focus:border-sky-500 focus:bg-white min-h-[80px] resize-y"
          />
          <ActionButton onClick={render} loading={loading} loadingText="Rendering...">
            Render
          </ActionButton>
          {result && (
            <ResultBox success={result.success} label={result.success ? "Rendered" : "Error"}>
              {result.data}
            </ResultBox>
          )}
        </div>
      </Card>
    </div>
  );
}
