import { assertEquals } from "#veryfront/testing/assert.ts";

import {
  AGENT_CATALOG_ACTIONS,
  AGENT_CATALOG_KINDS,
  isAgentCatalogAction,
  isAgentCatalogKind,
  isInstalledProjectAgentKind,
  isProjectAgentExecutionKind,
  isProjectAgentKind,
  PROJECT_AGENT_EXECUTION_KINDS,
  PROJECT_AGENT_KINDS,
} from "./identity-contracts.ts";

Deno.test("agent identity constants preserve public wire values", () => {
  assertEquals(AGENT_CATALOG_KINDS, [
    "template_agent",
    "installable_agent",
  ]);
  assertEquals(AGENT_CATALOG_ACTIONS, ["fork", "install"]);
  assertEquals(PROJECT_AGENT_KINDS, [
    "source_project_agent",
    "installed_project_agent",
  ]);
  assertEquals(PROJECT_AGENT_EXECUTION_KINDS, ["source", "installed"]);
});

Deno.test("agent identity guards accept current wire values only", () => {
  assertEquals(isAgentCatalogKind("template_agent"), true);
  assertEquals(isAgentCatalogKind("catalog_entry"), false);

  assertEquals(isAgentCatalogAction("install"), true);
  assertEquals(isAgentCatalogAction("run"), false);

  assertEquals(isProjectAgentKind("installed_project_agent"), true);
  assertEquals(isProjectAgentKind("installable_agent"), false);

  assertEquals(isInstalledProjectAgentKind("installed_project_agent"), true);
  assertEquals(isInstalledProjectAgentKind("source_project_agent"), false);

  assertEquals(isProjectAgentExecutionKind("source"), true);
  assertEquals(isProjectAgentExecutionKind("source_project_agent"), false);
});
