import { z } from "zod";
import type { MCPTool } from "veryfront/mcp";
import { createContext7ToolSource } from "veryfront/tool";

let _source: ReturnType<typeof createContext7ToolSource> | undefined;

function getSource() {
  if (!_source) {
    _source = createContext7ToolSource();
  }
  return _source;
}

function isContext7Available(): boolean {
  return Boolean(Deno.env.get("CONTEXT7_API_KEY"));
}

const c7ResolveLibrary: MCPTool<
  { libraryName: string; query: string },
  unknown
> = {
  name: "c7_resolve_library",
  title: "Context7: Resolve Library ID",
  description: "Resolves a package or product name to a Context7-compatible library ID. " +
    "Call this before c7_query_docs to obtain the correct library ID. " +
    "Returns matching libraries with metadata (name, description, snippet count, reputation).",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: z.object({
    libraryName: z
      .string()
      .describe(
        "Library name to search for. Use the official name with proper punctuation — e.g., 'Next.js' not 'nextjs'.",
      ),
    query: z
      .string()
      .describe(
        "The question or task you need help with. Used to rank results by relevance.",
      ),
  }),
  execute: async (input) => {
    if (!isContext7Available()) {
      return {
        error: "context7_not_configured",
        message: "Context7 API key not configured. Set the CONTEXT7_API_KEY environment variable.",
      };
    }
    try {
      return await getSource().executeTool("resolve-library-id", input);
    } catch (error) {
      return {
        error: "context7_request_failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

const c7QueryDocs: MCPTool<
  { libraryId: string; query: string },
  unknown
> = {
  name: "c7_query_docs",
  title: "Context7: Query Documentation",
  description:
    "Retrieves up-to-date documentation and code examples from Context7 for a library. " +
    "You must call c7_resolve_library first to obtain the library ID, unless the user " +
    "provides one directly in '/org/project' format.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: z.object({
    libraryId: z
      .string()
      .describe(
        "Context7-compatible library ID (e.g., '/vercel/next.js', '/supabase/supabase').",
      ),
    query: z
      .string()
      .describe(
        "The question or task you need help with. Be specific and include relevant details.",
      ),
  }),
  execute: async (input) => {
    if (!isContext7Available()) {
      return {
        error: "context7_not_configured",
        message: "Context7 API key not configured. Set the CONTEXT7_API_KEY environment variable.",
      };
    }
    try {
      return await getSource().executeTool("query-docs", input);
    } catch (error) {
      return {
        error: "context7_request_failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const context7Tools: MCPTool[] = [c7ResolveLibrary, c7QueryDocs];
