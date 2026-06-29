import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { discoverSchedules, type ScheduleDefinition } from "veryfront/schedule";
import { outputTriggerList } from "../trigger-utils.ts";

function formatSchedule(schedule: ScheduleDefinition): string {
  return `${schedule.id} -> ${schedule.target.kind}:${schedule.target.id} (${schedule.schedule})`;
}

export async function handleSchedulesCommand(_args: ParsedArgs): Promise<void> {
  const projectDir = Deno.cwd();
  await withProjectSourceContext(projectDir, async ({ adapter, config }) => {
    const result = await discoverSchedules({ projectDir, adapter, config });
    await outputTriggerList({
      command: "schedules",
      items: result.items,
      errors: result.errors,
      formatItem: formatSchedule,
    });
  });
}
