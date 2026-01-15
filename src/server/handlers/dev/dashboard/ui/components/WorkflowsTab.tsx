import { useEffect, useState } from "react";
import type { Agent, Tool } from "../App.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Card } from "./Card.tsx";
import { ActionButton, DetailHeader, EmptyState, ResultBox, TwoColumnLayout } from "./shared.tsx";

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

interface WorkflowsTabProps {
  workflows: WorkflowMetadata[];
  agents: Agent[];
  tools: Tool[];
  onNavigateToAgent?: (agentId: string) => void;
  onNavigateToTool?: (toolId: string) => void;
}

export function WorkflowsTab({
  workflows,
  agents,
  tools,
  onNavigateToAgent,
  onNavigateToTool,
}: WorkflowsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredWorkflows = workflows.filter((wf) =>
    wf.id.toLowerCase().includes(search.toLowerCase())
  );

  const selectedWorkflow = workflows.find((wf) => wf.id === selectedId);

  const sidebar = (
    <Sidebar
      search={search}
      onSearchChange={setSearch}
      items={filteredWorkflows.map((wf) => ({
        id: wf.id,
        label: wf.id,
        badge: wf.nodeCount > 0 ? `${wf.nodeCount} nodes` : "dynamic",
      }))}
      selectedId={selectedId}
      onSelect={setSelectedId}
      emptyMessage="No workflows registered"
    />
  );

  return (
    <TwoColumnLayout sidebar={sidebar}>
      {selectedWorkflow
        ? (
          <WorkflowDetail
            workflow={selectedWorkflow}
            agents={agents}
            tools={tools}
            onNavigateToAgent={onNavigateToAgent}
            onNavigateToTool={onNavigateToTool}
          />
        )
        : <EmptyState message="Select a workflow to inspect" />}
    </TwoColumnLayout>
  );
}

function WorkflowDetail({
  workflow,
  agents,
  tools,
  onNavigateToAgent,
  onNavigateToTool,
}: {
  workflow: WorkflowMetadata;
  agents: Agent[];
  tools: Tool[];
  onNavigateToAgent?: (agentId: string) => void;
  onNavigateToTool?: (toolId: string) => void;
}) {
  // Check if referenced agents/tools exist
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const toolMap = new Map(tools.map((t) => [t.id, t]));

  return (
    <div>
      <DetailHeader
        title={workflow.id}
        description={workflow.description || "No description"}
      />

      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="text-2xl font-bold text-gray-900">{workflow.nodeCount || "dynamic"}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Nodes</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-gray-900">{workflow.agentRefs.length}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Agents</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold text-gray-900">{workflow.toolRefs.length}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Tools</div>
        </Card>
        <Card className="p-4">
          <div className="text-lg font-bold text-gray-900">
            {workflow.timeout || "-"}
          </div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Timeout</div>
        </Card>
      </div>

      {/* Node Types */}
      {workflow.nodeTypes.length > 0 && (
        <Card title="Node Types" className="mb-6">
          <div className="p-4 flex flex-wrap gap-2">
            {workflow.nodeTypes.map((type) => (
              <span
                key={type}
                className="px-2.5 py-1 bg-purple-50 text-purple-700 text-sm font-medium rounded-full"
              >
                {type}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Workflow Steps/Nodes */}
      {workflow.nodes.length > 0
        ? (
          <Card title="Workflow Steps" className="mb-6">
            <div className="divide-y">
              {workflow.nodes.map((node, index) => (
                <div key={node.id} className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Step number */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Node header */}
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-sm font-medium text-gray-900">{node.id}</code>
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded ${
                            node.type === "step"
                              ? "bg-blue-50 text-blue-600"
                              : node.type === "parallel"
                              ? "bg-green-50 text-green-600"
                              : node.type === "branch"
                              ? "bg-yellow-50 text-yellow-700"
                              : node.type === "wait"
                              ? "bg-orange-50 text-orange-600"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {node.type}
                        </span>
                      </div>

                      {/* Node details */}
                      <div className="text-sm text-gray-600 space-y-1">
                        {/* Agent reference */}
                        {node.agent && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Agent:</span>
                            {agentMap.has(node.agent)
                              ? (
                                <button
                                  type="button"
                                  onClick={() => onNavigateToAgent?.(node.agent!)}
                                  className="text-sky-600 hover:underline"
                                >
                                  {node.agent}
                                </button>
                              )
                              : <span className="text-red-500">{node.agent} (not found)</span>}
                          </div>
                        )}

                        {/* Tool reference */}
                        {node.tool && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Tool:</span>
                            {toolMap.has(node.tool)
                              ? (
                                <button
                                  type="button"
                                  onClick={() => onNavigateToTool?.(node.tool!)}
                                  className="text-sky-600 hover:underline"
                                >
                                  {node.tool}
                                </button>
                              )
                              : <span className="text-red-500">{node.tool} (not found)</span>}
                          </div>
                        )}

                        {/* Dependencies */}
                        {node.dependsOn && node.dependsOn.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Depends on:</span>
                            <span className="text-gray-600">{node.dependsOn.join(", ")}</span>
                          </div>
                        )}

                        {/* Children (for parallel/branch) */}
                        {node.children && node.children.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">Contains:</span>
                            <span className="text-gray-600">{node.children.join(", ")}</span>
                          </div>
                        )}

                        {/* Message (for wait nodes) */}
                        {node.message && (
                          <div className="flex items-start gap-2">
                            <span className="text-gray-400">Message:</span>
                            <span className="text-gray-600 italic">"{node.message}"</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
        : (
          <Card title="Workflow Steps" className="mb-6">
            <div className="p-8 text-center text-gray-400">
              <div className="mb-2">Dynamic steps</div>
              <div className="text-sm text-gray-500">
                This workflow uses a function to generate steps at runtime
              </div>
            </div>
          </Card>
        )}

      {/* DAG Visualization */}
      {workflow.nodes.length > 0 && (
        <Card title="Workflow Flow" className="mb-6">
          <div className="p-4 font-mono text-sm bg-gray-50 overflow-x-auto">
            <WorkflowDAG nodes={workflow.nodes} />
          </div>
        </Card>
      )}

      {/* References Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Agent References */}
        <Card title={`Agents Used (${workflow.agentRefs.length})`}>
          {workflow.agentRefs.length > 0
            ? (
              <div className="divide-y">
                {workflow.agentRefs.map((agentId) => {
                  const agent = agentMap.get(agentId);
                  return (
                    <div key={agentId} className="p-3 flex items-center justify-between">
                      <div>
                        <button
                          type="button"
                          onClick={() => onNavigateToAgent?.(agentId)}
                          className="text-sm text-sky-600 hover:underline font-medium"
                        >
                          {agentId}
                        </button>
                        {agent && <div className="text-xs text-gray-500">{agent.model}</div>}
                      </div>
                      {agent
                        ? <span className="w-2 h-2 rounded-full bg-green-500" title="Found" />
                        : <span className="w-2 h-2 rounded-full bg-red-500" title="Not found" />}
                    </div>
                  );
                })}
              </div>
            )
            : (
              <div className="p-4 text-center text-gray-400 text-sm">
                No agents referenced
              </div>
            )}
        </Card>

        {/* Tool References */}
        <Card title={`Tools Used (${workflow.toolRefs.length})`}>
          {workflow.toolRefs.length > 0
            ? (
              <div className="divide-y">
                {workflow.toolRefs.map((toolId) => {
                  const tool = toolMap.get(toolId);
                  return (
                    <div key={toolId} className="p-3 flex items-center justify-between">
                      <div>
                        <button
                          type="button"
                          onClick={() => onNavigateToTool?.(toolId)}
                          className="text-sm text-sky-600 hover:underline font-medium"
                        >
                          {toolId}
                        </button>
                        {tool && (
                          <div className="text-xs text-gray-500 truncate max-w-[200px]">
                            {tool.description}
                          </div>
                        )}
                      </div>
                      {tool
                        ? <span className="w-2 h-2 rounded-full bg-green-500" title="Found" />
                        : <span className="w-2 h-2 rounded-full bg-red-500" title="Not found" />}
                    </div>
                  );
                })}
              </div>
            )
            : (
              <div className="p-4 text-center text-gray-400 text-sm">
                No tools referenced
              </div>
            )}
        </Card>
      </div>

      {/* Schema info */}
      <Card title="Schema" className="mt-6">
        <div className="p-4 flex gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                workflow.hasInputSchema ? "bg-green-500" : "bg-gray-300"
              }`}
            />
            <span className="text-sm text-gray-600">Input Schema</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                workflow.hasOutputSchema ? "bg-green-500" : "bg-gray-300"
              }`}
            />
            <span className="text-sm text-gray-600">Output Schema</span>
          </div>
        </div>
      </Card>

      {/* Execute Workflow */}
      <WorkflowExecutor workflowId={workflow.id} inputSchema={workflow.inputSchemaJson} />
    </div>
  );
}

/**
 * Generate example values from a JSON schema (recursive for nested objects)
 */
function generateExampleFromSchema(schema?: Record<string, unknown>): Record<string, unknown> {
  if (!schema || schema.type !== "object") return {};

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return {};

  const example: Record<string, unknown> = {};

  for (const [name, prop] of Object.entries(properties)) {
    // Use default value if available
    if (prop.default !== undefined) {
      example[name] = prop.default;
      continue;
    }

    // Use first enum value if available
    if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
      example[name] = prop.enum[0];
      continue;
    }

    // Generate example based on type
    switch (prop.type) {
      case "string":
        // Check for URL-like field names
        if (name.toLowerCase().includes("url") || name.toLowerCase().includes("uri")) {
          example[name] = "https://example.com/data";
        } else if (name.toLowerCase().includes("email")) {
          example[name] = "user@example.com";
        } else {
          example[name] = `example-${name}`;
        }
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
        // Recursively generate nested object examples
        example[name] = generateExampleFromSchema(prop as Record<string, unknown>);
        break;
      default:
        example[name] = null;
    }
  }

  return example;
}

function WorkflowExecutor(
  { workflowId, inputSchema }: { workflowId: string; inputSchema?: Record<string, unknown> },
) {
  const [input, setInput] = useState(() => {
    const example = generateExampleFromSchema(inputSchema);
    return JSON.stringify(example, null, 2);
  });
  const [result, setResult] = useState<
    {
      success: boolean;
      data: string;
      duration?: number;
      runId?: string;
      status?: string;
    } | null
  >(null);
  const [loading, setLoading] = useState(false);

  // Update input when workflow or schema changes
  useEffect(() => {
    const example = generateExampleFromSchema(inputSchema);
    setInput(JSON.stringify(example, null, 2));
    setResult(null);
  }, [workflowId, inputSchema]);

  async function startWorkflow() {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      setResult({ success: false, data: (e as Error).message });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/_dev/api/start-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, input: parsed }),
      });
      const d = await res.json();
      if (d.error) {
        setResult({
          success: false,
          data: d.error + (d.hint ? `\n\n${d.hint}` : ""),
        });
      } else {
        setResult({
          success: true,
          data: JSON.stringify(d.result, null, 2),
          duration: d.duration,
          runId: d.runId,
          status: d.status,
        });
      }
    } catch (e) {
      setResult({ success: false, data: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Start Workflow" className="mt-6">
      <div className="p-4">
        <label className="block text-xs font-medium uppercase tracking-wide text-gray-600 mb-1">
          Input (JSON)
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='{"topic": "AI Safety", "requiresApproval": false}'
          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm font-mono focus:outline-none focus:border-sky-500 focus:bg-white min-h-[80px] resize-y"
        />
        <ActionButton onClick={startWorkflow} loading={loading} loadingText="Running...">
          Start
        </ActionButton>
        {result && (
          <div>
            {result.runId && (
              <div className="mt-2 text-xs text-gray-500">
                Run ID: <code className="text-sky-600">{result.runId}</code>
                {result.status && (
                  <span className="ml-2">
                    Status:{" "}
                    <span
                      className={result.status === "completed"
                        ? "text-green-600"
                        : "text-yellow-600"}
                    >
                      {result.status}
                    </span>
                  </span>
                )}
              </div>
            )}
            <ResultBox
              success={result.success}
              label={result.success ? "Result" : "Error"}
              duration={result.duration}
            >
              {result.data}
            </ResultBox>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Visual DAG component showing workflow flow with boxes and arrows
 */
function WorkflowDAG({ nodes }: { nodes: NodeInfo[] }) {
  if (nodes.length === 0) {
    return (
      <div className="text-gray-400 text-center py-4">
        (dynamic - steps generated at runtime)
      </div>
    );
  }

  // Build adjacency and reverse adjacency maps
  const dependsOnMap = new Map<string, string[]>();
  const dependentsMap = new Map<string, string[]>();
  const nodeMap = new Map<string, NodeInfo>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    dependsOnMap.set(node.id, node.dependsOn || []);
    dependentsMap.set(node.id, []);
  }

  // Build dependents (reverse of dependsOn)
  for (const node of nodes) {
    for (const dep of node.dependsOn || []) {
      const deps = dependentsMap.get(dep) || [];
      deps.push(node.id);
      dependentsMap.set(dep, deps);
    }
  }

  // Find root nodes (no dependencies)
  const rootNodes = nodes.filter((n) => !n.dependsOn || n.dependsOn.length === 0);

  // Compute levels using BFS
  const levels = new Map<string, number>();
  const queue = [...rootNodes.map((n) => n.id)];
  for (const id of queue) {
    levels.set(id, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const _currentLevel = levels.get(current)!;

    for (const dependent of dependentsMap.get(current) || []) {
      const deps = dependsOnMap.get(dependent) || [];
      const allDepsResolved = deps.every((d) => levels.has(d));
      if (allDepsResolved && !levels.has(dependent)) {
        const maxDepLevel = Math.max(...deps.map((d) => levels.get(d) || 0));
        levels.set(dependent, maxDepLevel + 1);
        queue.push(dependent);
      }
    }
  }

  // Group nodes by level
  const levelGroups = new Map<number, NodeInfo[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    const group = levelGroups.get(level) || [];
    group.push(node);
    levelGroups.set(level, group);
  }

  const maxLevel = Math.max(...Array.from(levels.values()), 0);

  // Color coding for node types
  const getNodeStyle = (type: string) => {
    switch (type) {
      case "step":
        return "bg-blue-50 border-blue-200 text-blue-700";
      case "parallel":
        return "bg-green-50 border-green-200 text-green-700";
      case "branch":
        return "bg-yellow-50 border-yellow-200 text-yellow-700";
      case "wait":
        return "bg-orange-50 border-orange-200 text-orange-700";
      default:
        return "bg-gray-50 border-gray-200 text-gray-700";
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {Array.from({ length: maxLevel + 1 }, (_, level) => {
        const nodesAtLevel = levelGroups.get(level) || [];
        const isParallel = nodesAtLevel.length > 1;

        return (
          <div key={level}>
            {/* Arrow from previous level */}
            {level > 0 && (
              <div className="flex justify-center py-1">
                <svg width="24" height="20" viewBox="0 0 24 20" className="text-gray-400">
                  <path
                    d="M12 0 L12 14 M6 10 L12 16 L18 10"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                  />
                </svg>
              </div>
            )}

            {/* Nodes at this level */}
            <div className={`flex gap-3 ${isParallel ? "items-start" : "justify-center"}`}>
              {isParallel && (
                <div className="flex items-center text-gray-400 text-xs font-mono self-center">
                  [
                </div>
              )}
              {nodesAtLevel.map((node, idx) => (
                <div key={node.id} className="flex items-center gap-2">
                  <div
                    className={`px-3 py-2 rounded-lg border text-sm font-medium ${
                      getNodeStyle(node.type)
                    }`}
                  >
                    <div className="font-semibold">{node.id}</div>
                    {node.tool && (
                      <div className="text-xs opacity-75 mt-0.5">tool: {node.tool}</div>
                    )}
                    {node.agent && (
                      <div className="text-xs opacity-75 mt-0.5">agent: {node.agent}</div>
                    )}
                  </div>
                  {isParallel && idx < nodesAtLevel.length - 1 && (
                    <div className="text-gray-400 text-xs font-mono">,</div>
                  )}
                </div>
              ))}
              {isParallel && (
                <div className="flex items-center text-gray-400 text-xs font-mono self-center">
                  ]
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
