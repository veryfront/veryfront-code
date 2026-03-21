import { ControlPlaneSurfaceSchema } from "#veryfront/channels/control-plane.ts";
import type { HandlerContext } from "#veryfront/types";
import { z } from "zod";
import { discoverTasks, type TaskDiscoveryOptions } from "./discovery.ts";

export const ControlPlaneTasksListRequestSchema = z.object({
  requestId: z.string().min(1),
  projectId: z.string().min(1),
  surface: ControlPlaneSurfaceSchema,
});

const JsonSchemaRecordSchema = z.record(z.unknown());

export const RuntimeTaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  target: z.string().min(1),
  sourcePath: z.string().min(1),
  inputSchema: JsonSchemaRecordSchema.nullable(),
  outputSchema: JsonSchemaRecordSchema.nullable(),
  schedulable: z.boolean(),
});

export const RuntimeTaskListResponseSchema = z.object({
  tasks: z.array(RuntimeTaskSchema),
});

export type ControlPlaneTasksListRequest = z.infer<typeof ControlPlaneTasksListRequestSchema>;
export type RuntimeTask = z.infer<typeof RuntimeTaskSchema>;
export type RuntimeTaskListResponse = z.infer<typeof RuntimeTaskListResponseSchema>;

export interface RuntimeTaskDiscoveryDeps {
  discoverTasks: (options: TaskDiscoveryOptions) => ReturnType<typeof discoverTasks>;
}

export const defaultRuntimeTaskDiscoveryDeps: RuntimeTaskDiscoveryDeps = {
  discoverTasks,
};

function normalizeJsonSchema(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export async function listRuntimeTasks(
  ctx: HandlerContext,
  deps: RuntimeTaskDiscoveryDeps = defaultRuntimeTaskDiscoveryDeps,
): Promise<RuntimeTaskListResponse> {
  const discovery = await deps.discoverTasks({
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug ?? false,
  });

  const tasks = discovery.tasks
    .map((task) =>
      RuntimeTaskSchema.parse({
        id: task.id,
        name: task.name,
        description: task.definition.description ?? null,
        target: `task:${task.id}`,
        sourcePath: task.filePath,
        inputSchema: normalizeJsonSchema(task.definition.inputSchema),
        outputSchema: normalizeJsonSchema(task.definition.outputSchema),
        schedulable: task.definition.schedulable ?? true,
      })
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return RuntimeTaskListResponseSchema.parse({ tasks });
}
