import type { ScheduleDefinition } from "#veryfront/schedule";
import { isScheduleDefinition } from "#veryfront/schedule";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const scheduleHandler: DiscoveryHandler<ScheduleDefinition> = {
  typeName: "schedule",
  validate: (item): item is ScheduleDefinition => isScheduleDefinition(item),
  getId: (definition) => definition.id,
  register: (_id, definition) => definition,
  getResultMap: (result: DiscoveryResult) => result.schedules,
};
