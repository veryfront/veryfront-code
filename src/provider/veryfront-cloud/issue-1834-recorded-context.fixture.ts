import type {
  ModelRuntimePromptMessage,
  ModelRuntimeToolDefinition,
} from "#veryfront/provider/types.ts";

/**
 * Sanitized structural reproduction of issue 1834, run event sequence 33.
 *
 * The local diagnostic capture remains untracked. Customer text, file contents,
 * project identifiers, and original tool-call IDs are replaced here. The role
 * order, call/result pairing, visible tool set, schemas, and request options
 * match the recorded model-call context.
 */

const loadSkillSchema = {
  type: "object",
  properties: {
    load: {
      type: "object",
      required: ["skillId"],
      properties: {
        file: {
          type: "string",
          minLength: 1,
          maxLength: 1024,
          description:
            "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
        },
        skillId: {
          type: "string",
          pattern: "^[a-zA-Z0-9_-]+(?:\\.md)?$",
          maxLength: 259,
          description:
            'The listed skill ID to load. A lowercase ".md" suffix is accepted for a listed ID.',
        },
      },
      additionalProperties: false,
    },
    inventory: {
      type: "object",
      properties: {
        cursor: {
          type: "integer",
          minimum: 0,
          maximum: 1000,
          description: "Pagination cursor from the prompt or a previous skill inventory response.",
        },
      },
      additionalProperties: false,
    },
  },
  minProperties: 1,
  maxProperties: 1,
  additionalProperties: false,
} as const;

const toolSearchSchema = {
  type: "object",
  required: ["query"],
  properties: {
    query: {
      type: "string",
      description:
        "One exact tool name when known, or one short capability phrase. UTF-8 input must be at most 256 bytes. Do not combine alternatives.",
    },
  },
  additionalProperties: false,
} as const;

const updateFileSchema = {
  type: "object",
  $schema: "http://json-schema.org/draft-07/schema#",
  required: ["path"],
  properties: {
    path: { type: "string", description: "File path" },
    content: {
      type: "string",
      description: "Full new file content. Do not combine with str_replace.",
    },
    branch_id: { type: "string", description: "Branch ID (omit for main branch)" },
    str_replace: {
      type: "object",
      required: ["old_string", "new_string"],
      properties: {
        new_string: {
          type: "string",
          description: "Replacement text. Use an empty string to delete the matched text.",
        },
        old_string: {
          type: "string",
          minLength: 1,
          description: "Exact current text. It must match exactly once.",
        },
      },
      description: "Replace one exact occurrence in the current file. Do not combine with content.",
      additionalProperties: false,
    },
    expected_checksum: {
      type: "string",
      description:
        "Checksum returned by get_file. Provide it to avoid overwriting concurrent edits.",
    },
    project_reference: { type: "string", description: "Project ID or slug" },
    expected_version_id: {
      type: "string",
      description:
        "Version ID returned by get_file. Provide it to avoid overwriting concurrent edits.",
    },
  },
  description: "Arguments for the update_file tool.",
  additionalProperties: false,
} as const;

const updateFileDescription =
  "Update an existing file. Send content to replace the whole file, or send str_replace to replace one exact occurrence. Always read the file first.";

export const issue1834RecordedTools = [
  {
    type: "function",
    name: "load_skill",
    description:
      "Load the full instructions for a skill. Use this when you need detailed guidance for a specific task type. load_skill does not perform the task by itself. Continue the same turn after calling it. Keep the root assistant visibly owning the work. Delegate only when isolation, parallelism, or a different tool/model budget materially helps. If invoke_agent is available, pass through any returned model, thinking, or maxSteps overrides when delegating to it. To discover authorized skill IDs, use the inventory object. Use a cursor listed in context when present, then follow each nextCursor value. To load a skill, use the load object with only skillId. Add the optional `file` field only after the skill is loaded and only for a reference file listed by that loaded skill. Skill IDs may be listed in the <available_skills> or <authorized_skill_ids> context block. Direct consumers can omit skillId to page authorized IDs or provide equivalent context. You must not invent IDs.",
    inputSchema: loadSkillSchema,
  },
  {
    type: "function",
    name: "tool_search",
    description:
      "Search authorized tools by exact name or capability before declaring a requested tool unavailable. Matching authorized tools become available on the next model step.",
    inputSchema: toolSearchSchema,
  },
  {
    type: "function",
    name: "update_file",
    description: updateFileDescription,
    inputSchema: updateFileSchema,
  },
  {
    type: "function",
    name: "veryfront__update_file",
    description: updateFileDescription,
    inputSchema: updateFileSchema,
  },
] as const satisfies readonly ModelRuntimeToolDefinition[];

export const issue1834RecordedMessages: readonly ModelRuntimePromptMessage[] = [
  { role: "system", content: "Follow the agent policy." },
  { role: "system", content: "Use only authorized project tools." },
  { role: "system", content: "Continue from explicit tool results." },
  { role: "system", content: "Available tools are listed in this request." },
  { role: "user", content: [{ type: "text", text: "Update the requested project file." }] },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "search001",
        toolName: "tool_search",
        input: { query: "get_file" },
      },
      {
        type: "tool-call",
        toolCallId: "read00001",
        toolName: "get_file",
        input: { path: "src/example.ts", project_reference: "example-project" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "search001",
        toolName: "tool_search",
        output: { type: "json", value: { loadedCount: 1, matches: ["get_file"] } },
      },
      {
        type: "tool-result",
        toolCallId: "read00001",
        toolName: "get_file",
        output: {
          type: "json",
          value: {
            type: "text",
            value: "[File read: src/example.ts - content omitted (6400 chars)]",
          },
        },
      },
    ],
  },
  { role: "assistant", content: [{ type: "text", text: "Here is the current file." }] },
  { role: "user", content: [{ type: "text", text: "Apply the requested change." }] },
  {
    role: "assistant",
    content: [
      { type: "text", text: "I will update the file." },
      {
        type: "tool-call",
        toolCallId: "search002",
        toolName: "tool_search",
        input: { query: "update_file" },
      },
    ],
  },
  {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "search002",
      toolName: "tool_search",
      output: {
        type: "json",
        value: {
          resultCount: 1,
          loadedCount: 1,
          miss: false,
          matches: ["update_file"],
          nextStep: "Call update_file.",
        },
      },
    }],
  },
] as const;

export const issue1834RecordedRequest = {
  temperature: 0,
  maxOutputTokens: 16_384,
} as const;

/**
 * Captured Vertex partner Mistral response with private id and timestamp replaced.
 * The reconstructed replay counted 6,505 prompt tokens; the historical event
 * counted 6,509, so this fixture proves response shape rather than byte identity.
 */
export const issue1834CapturedEmptyVertexSse = [
  'data: {"id":"00000000000000000000000000000000","object":"chat.completion.chunk","created":0,"model":"mistral-small-2503","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
  'data: {"id":"00000000000000000000000000000000","object":"chat.completion.chunk","created":0,"model":"mistral-small-2503","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":6505,"total_tokens":6505,"completion_tokens":0}}',
  "data: [DONE]",
  "",
].join("\n\n");
