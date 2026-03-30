import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cicdTools } from "./cicd-tools.ts";

describe("CI/CD MCP Tools", () => {
  it("exports vf_get_pipeline_status tool", () => {
    const tool = cicdTools.find((t) => t.name === "vf_get_pipeline_status");
    assertEquals(tool !== undefined, true);
  });

  it("exports vf_get_deploy_history tool", () => {
    const tool = cicdTools.find((t) => t.name === "vf_get_deploy_history");
    assertEquals(tool !== undefined, true);
  });

  it("exports vf_get_build_logs tool", () => {
    const tool = cicdTools.find((t) => t.name === "vf_get_build_logs");
    assertEquals(tool !== undefined, true);
  });

  it("exports vf_trigger_deploy tool", () => {
    const tool = cicdTools.find((t) => t.name === "vf_trigger_deploy");
    assertEquals(tool !== undefined, true);
  });
});
