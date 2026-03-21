import { ControlPlaneSurfaceSchema } from "#veryfront/channels/control-plane.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema";
import type { HandlerContext } from "#veryfront/types";
import { z, type ZodTypeAny } from "zod";
import {
  discoverWorkflows,
  type WorkflowDiscoveryOptions,
} from "./discovery/workflow-discovery.ts";

export const ControlPlaneWorkflowsListRequestSchema = z.object({
  requestId: z.string().min(1),
  projectId: z.string().min(1),
  surface: ControlPlaneSurfaceSchema,
});

const JsonSchemaRecordSchema = z.record(z.unknown());

export const RuntimeWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  target: z.string().min(1),
  sourcePath: z.string().min(1),
  version: z.string().nullable(),
  inputSchema: JsonSchemaRecordSchema.nullable(),
  outputSchema: JsonSchemaRecordSchema.nullable(),
  schedulable: z.boolean(),
});

export const RuntimeWorkflowListResponseSchema = z.object({
  workflows: z.array(RuntimeWorkflowSchema),
});

export type ControlPlaneWorkflowsListRequest = z.infer<
  typeof ControlPlaneWorkflowsListRequestSchema
>;
export type RuntimeWorkflow = z.infer<typeof RuntimeWorkflowSchema>;
export type RuntimeWorkflowListResponse = z.infer<
  typeof RuntimeWorkflowListResponseSchema
>;

export interface RuntimeWorkflowDiscoveryDeps {
  discoverWorkflows: (
    options: WorkflowDiscoveryOptions,
  ) => ReturnType<typeof discoverWorkflows>;
}

export const defaultRuntimeWorkflowDiscoveryDeps: RuntimeWorkflowDiscoveryDeps = {
  discoverWorkflows,
};

function normalizeJsonSchema(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    const jsonSchema = zodToJsonSchema(value as ZodTypeAny);
    if (jsonSchema != null && typeof jsonSchema === "object" && !Array.isArray(jsonSchema)) {
      return jsonSchema as Record<string, unknown>;
    }
  } catch {
    // Not every Zod schema can be converted; surface null instead of breaking discovery.
  }

  return null;
}

export async function listRuntimeWorkflows(
  ctx: HandlerContext,
  deps: RuntimeWorkflowDiscoveryDeps = defaultRuntimeWorkflowDiscoveryDeps,
): Promise<RuntimeWorkflowListResponse> {
  const discovery = await deps.discoverWorkflows({
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug ?? false,
  });

  const workflows = discovery.workflows
    .map((workflow) =>
      RuntimeWorkflowSchema.parse({
        id: workflow.id,
        name: workflow.id,
        description: workflow.definition.description ?? null,
        target: `workflow:${workflow.id}`,
        sourcePath: workflow.filePath,
        version: workflow.definition.version ?? null,
        inputSchema: normalizeJsonSchema(workflow.definition.inputSchema),
        outputSchema: normalizeJsonSchema(workflow.definition.outputSchema),
        schedulable: true,
      })
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return RuntimeWorkflowListResponseSchema.parse({ workflows });
}
