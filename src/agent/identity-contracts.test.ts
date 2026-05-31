import { assertEquals } from "#veryfront/testing/assert.ts";

import {
  AGENT_CATALOG_ACTIONS,
  AGENT_CATALOG_SOURCE_TYPES,
  AGENT_CUSTOMIZATION_MODES,
  AGENT_INSTALL_TARGETS,
  isAgentCatalogAction,
  isAgentCatalogSourceType,
  isAgentCustomizationMode,
  isAgentInstallTarget,
  isInstalledProjectAgentKind,
  isProjectAgentExecutionKind,
  isProjectAgentKind,
  PROJECT_AGENT_EXECUTION_KINDS,
  PROJECT_AGENT_KINDS,
} from "./identity-contracts.ts";

Deno.test("agent identity constants preserve public wire values", () => {
  assertEquals(AGENT_CATALOG_SOURCE_TYPES, [
    "project_agent",
    "catalog_entry",
  ]);
  assertEquals(AGENT_INSTALL_TARGETS, ["project", "account"]);
  assertEquals(AGENT_CUSTOMIZATION_MODES, [
    "none",
    "configure",
    "fork_to_project",
  ]);
  assertEquals(AGENT_CATALOG_ACTIONS, [
    "install_to_project",
    "install_to_account",
    "fork_to_project",
  ]);
  assertEquals(PROJECT_AGENT_KINDS, [
    "source_project_agent",
    "installed_project_agent",
  ]);
  assertEquals(PROJECT_AGENT_EXECUTION_KINDS, ["source", "installed"]);
});

Deno.test("agent identity guards accept current wire values only", () => {
  assertEquals(isAgentCatalogSourceType("project_agent"), true);
  assertEquals(isAgentCatalogSourceType("template_agent"), false);

  assertEquals(isAgentInstallTarget("project"), true);
  assertEquals(isAgentInstallTarget("workspace"), false);

  assertEquals(isAgentCustomizationMode("fork_to_project"), true);
  assertEquals(isAgentCustomizationMode("template_agent"), false);

  assertEquals(isAgentCatalogAction("install_to_project"), true);
  assertEquals(isAgentCatalogAction("install"), false);
  assertEquals(isAgentCatalogAction("run"), false);

  assertEquals(isProjectAgentKind("installed_project_agent"), true);
  assertEquals(isProjectAgentKind("installable_agent"), false);

  assertEquals(isInstalledProjectAgentKind("installed_project_agent"), true);
  assertEquals(isInstalledProjectAgentKind("source_project_agent"), false);

  assertEquals(isProjectAgentExecutionKind("source"), true);
  assertEquals(isProjectAgentExecutionKind("source_project_agent"), false);
});
