import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as discoveryModule from "./discovery.ts";
import * as factoryModule from "./factory.ts";
import * as scheduleModule from "./index.ts";
import * as publicScheduleModule from "veryfront/schedule";
import * as typesModule from "./types.ts";

const expectedRuntimeExports = [
  "discoverSchedules",
  "isScheduleDefinition",
  "schedule",
];

describe("schedule/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/schedule", () => {
    assertEquals(Object.keys(scheduleModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicScheduleModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(scheduleModule.schedule, factoryModule.schedule);
    assertStrictEquals(scheduleModule.discoverSchedules, discoveryModule.discoverSchedules);
    assertStrictEquals(scheduleModule.isScheduleDefinition, typesModule.isScheduleDefinition);
    assertStrictEquals(publicScheduleModule.schedule, scheduleModule.schedule);
    assertStrictEquals(publicScheduleModule.discoverSchedules, scheduleModule.discoverSchedules);
    assertStrictEquals(
      publicScheduleModule.isScheduleDefinition,
      scheduleModule.isScheduleDefinition,
    );
  });
});
