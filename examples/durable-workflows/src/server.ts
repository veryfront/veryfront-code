/**
 * Durable Workflows Example - API Server
 *
 * Demonstrates the workflow API endpoints for:
 * - Starting workflows
 * - Getting workflow status
 * - Listing workflow runs
 * - Handling approvals
 *
 * This example uses mock agents that simulate AI responses for demonstration purposes.
 */

import {
  createWorkflowClient,
  MemoryBackend,
  DefaultAgentRegistry,
  DefaultToolRegistry,
  createMockAgent,
  createMockTool,
  type Workflow,
} from "veryfront/ai/workflow";

import { contentPipeline } from "./workflows/content-pipeline.ts";
import { dataProcessingPipeline } from "./workflows/data-processing.ts";

// Configuration
const PORT = parseInt(Deno.env.get("PORT") || "3000");

// Create backend (memory for this demo)
const backend = new MemoryBackend({ debug: true });

// =============================================================================
// Mock Agents for Demo
// =============================================================================

const agentRegistry = new DefaultAgentRegistry();
const toolRegistry = new DefaultToolRegistry();

// Research agent - simulates researching a topic
agentRegistry.registerAgent(createMockAgent("researcher", {
  responseFunc: async (input) => {
    await new Promise(r => setTimeout(r, 500)); // Simulate API delay
    // Extract topic from text prompt like: Research the following topic thoroughly: "AI Safety"
    const topicMatch = input.match(/"([^"]+)"/);
    const topic = topicMatch ? topicMatch[1] : input.slice(0, 50);
    return JSON.stringify({
      research: {
        topic,
        keyPoints: [
          `${topic} is an important field with many applications`,
          `Recent developments in ${topic} include new methodologies`,
          `Experts recommend further exploration of ${topic}`,
        ],
        sources: ["https://example.com/research1", "https://example.com/research2"],
        sentiment: "positive",
      },
    });
  },
}));

// Writer agent - simulates writing content
agentRegistry.registerAgent(createMockAgent("writer", {
  responseFunc: async (input) => {
    await new Promise(r => setTimeout(r, 800)); // Simulate API delay
    return JSON.stringify({
      content: {
        title: "Generated Article",
        body: `This is a generated article about the researched topic.\n\nBased on the research provided, we can see that the subject matter is fascinating and relevant to modern developments.\n\nKey takeaways include the importance of continued study and the potential applications in various fields.`,
        wordCount: 45,
      },
    });
  },
}));

// Editor agent - simulates editing content
agentRegistry.registerAgent(createMockAgent("editor", {
  responseFunc: async (input) => {
    await new Promise(r => setTimeout(r, 400)); // Simulate API delay
    return JSON.stringify({
      edited: {
        improvements: ["Fixed grammatical errors", "Enhanced flow", "Added clarity"],
        readabilityScore: 85,
        approved: true,
      },
    });
  },
}));

// Publisher agent - simulates publishing content
agentRegistry.registerAgent(createMockAgent("publisher", {
  responseFunc: async (input) => {
    await new Promise(r => setTimeout(r, 300)); // Simulate API delay
    return JSON.stringify({
      published: {
        url: "https://example.com/articles/generated-article",
        publishedAt: new Date().toISOString(),
        status: "live",
      },
    });
  },
}));

// Data fetcher tool
toolRegistry.registerTool(createMockTool("dataFetcher", {
  description: "Fetches data from external sources",
  executeFunc: async (args) => {
    await new Promise(r => setTimeout(r, 200));
    return {
      data: { records: 150, source: args.source ?? "default" },
      fetchedAt: new Date().toISOString(),
    };
  },
}));

// Image generator tool
toolRegistry.registerTool(createMockTool("imageGenerator", {
  description: "Generates images for content",
  executeFunc: async (args) => {
    await new Promise(r => setTimeout(r, 600));
    return {
      images: [
        { url: "https://example.com/images/generated-1.jpg", alt: "Generated image 1" },
        { url: "https://example.com/images/generated-2.jpg", alt: "Generated image 2" },
      ],
      prompt: args.prompt ?? "default prompt",
    };
  },
}));

// Auto approver tool (for non-approval workflows)
toolRegistry.registerTool(createMockTool("autoApprover", {
  description: "Auto-approves content when manual approval is not required",
  executeFunc: async (args) => {
    await new Promise(r => setTimeout(r, 100));
    return {
      approved: args.approved ?? true,
      approvedAt: new Date().toISOString(),
      approvedBy: "system",
    };
  },
}));

// =============================================================================
// Create Workflow Client with Mock Agents
// =============================================================================

const client = createWorkflowClient({
  backend,
  debug: true,
  executor: {
    stepExecutor: {
      agentRegistry,
      toolRegistry,
    },
  },
});

// Register workflows (cast to satisfy type variance)
client.register(contentPipeline as Workflow);
client.register(dataProcessingPipeline as Workflow);

console.log("[Server] Backend: Memory (in-process)");
console.log("[Server] Registered workflows:", ["content-pipeline", "data-processing"]);
console.log("[Server] Mock agents:", agentRegistry.listAgentIds());
console.log("[Server] Mock tools:", toolRegistry.listToolNames());

// API Handler
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // POST /api/workflows/:workflowId/start - Start a workflow
    if (method === "POST" && path.match(/^\/api\/workflows\/[\w-]+\/start$/)) {
      const workflowId = path.split("/")[3];
      const body = await request.json();

      console.log(`[API] Starting workflow: ${workflowId}`, body.input);

      const handle = await client.start(workflowId!, body.input);

      return new Response(
        JSON.stringify({ runId: handle.runId, status: "started" }),
        {
          status: 201,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // GET /api/workflows/runs/:runId - Get workflow run
    if (method === "GET" && path.match(/^\/api\/workflows\/runs\/[\w-]+$/)) {
      const runId = path.split("/")[4];
      const run = await backend.getRun(runId!);

      if (!run) {
        return new Response(JSON.stringify({ error: "Run not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      return new Response(JSON.stringify(run), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // GET /api/workflows/runs - List workflow runs
    if (method === "GET" && path === "/api/workflows/runs") {
      const workflowId = url.searchParams.get("workflowId") || undefined;
      const status = url.searchParams.get("status") || undefined;
      const limit = parseInt(url.searchParams.get("limit") || "20");

      const runs = await backend.listRuns({
        workflowId,
        status: status as "pending" | "running" | "completed" | "failed" | undefined,
        limit,
      });

      return new Response(JSON.stringify({ runs, count: runs.length }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // POST /api/workflows/runs/:runId/cancel - Cancel a workflow
    if (method === "POST" && path.match(/^\/api\/workflows\/runs\/[\w-]+\/cancel$/)) {
      const runId = path.split("/")[4];
      await client.cancel(runId!);

      return new Response(JSON.stringify({ status: "cancelled" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // GET /api/workflows/runs/:runId/approvals - Get pending approvals
    if (method === "GET" && path.match(/^\/api\/workflows\/runs\/[\w-]+\/approvals$/)) {
      const runId = path.split("/")[4];
      const approvals = await backend.getPendingApprovals(runId!);

      return new Response(JSON.stringify({ approvals }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // POST /api/workflows/runs/:runId/approvals/:approvalId - Submit approval
    if (
      method === "POST" &&
      path.match(/^\/api\/workflows\/runs\/[\w-]+\/approvals\/[\w-]+$/)
    ) {
      const parts = path.split("/");
      const runId = parts[4];
      const approvalId = parts[6];
      const decision = await request.json();

      if (decision.approved) {
        await client.approve(runId!, approvalId!, decision.approver, decision.comment);
      } else {
        await client.reject(runId!, approvalId!, decision.approver, decision.comment);
      }

      return new Response(JSON.stringify({ status: "decision recorded" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // GET / - Health check
    if (path === "/" || path === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          workflows: ["content-pipeline", "data-processing"],
          backend: "memory",
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
}

// Start server
console.log(`[Server] Starting on port ${PORT}...`);
Deno.serve({ port: PORT }, handleRequest);
