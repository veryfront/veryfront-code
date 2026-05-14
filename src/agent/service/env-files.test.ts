import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { loadAgentServiceEnvFiles, loadHostedAgentServiceEnvFiles } from "./env-files.ts";

const TEST_KEYS = [
  "VF_AGENT_ENV_FILE_TEST_SHARED",
  "VF_AGENT_ENV_FILE_TEST_LOCAL_ONLY",
  "VF_AGENT_ENV_FILE_TEST_PROTECTED",
  "VF_AGENT_ENV_FILE_TEST_EMPTY",
];

describe("loadAgentServiceEnvFiles", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "hosted-agent-env-files-" });
    for (const key of TEST_KEYS) {
      deleteEnv(key);
    }
  });

  afterEach(async () => {
    for (const key of TEST_KEYS) {
      deleteEnv(key);
    }

    if (tempDir) {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("loads .env then .env.local while preserving existing process env", async () => {
    setEnv("VF_AGENT_ENV_FILE_TEST_PROTECTED", "from-process");
    await Deno.writeTextFile(
      `${tempDir}/.env`,
      [
        "VF_AGENT_ENV_FILE_TEST_SHARED=from-env",
        "VF_AGENT_ENV_FILE_TEST_PROTECTED=from-env",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      `${tempDir}/.env.local`,
      [
        "VF_AGENT_ENV_FILE_TEST_SHARED=from-local",
        "VF_AGENT_ENV_FILE_TEST_LOCAL_ONLY=local",
      ].join("\n"),
    );

    const result = await loadAgentServiceEnvFiles({ cwd: tempDir });

    assertEquals(result.loadedFiles, [`${tempDir}/.env`, `${tempDir}/.env.local`]);
    assertEquals(result.loadedVariables, 3);
    assertEquals(getEnv("VF_AGENT_ENV_FILE_TEST_SHARED"), "from-local");
    assertEquals(getEnv("VF_AGENT_ENV_FILE_TEST_LOCAL_ONLY"), "local");
    assertEquals(getEnv("VF_AGENT_ENV_FILE_TEST_PROTECTED"), "from-process");
  });

  it("supports empty values from env files", async () => {
    await Deno.writeTextFile(`${tempDir}/.env`, "VF_AGENT_ENV_FILE_TEST_EMPTY=");

    const result = await loadAgentServiceEnvFiles({ cwd: tempDir });

    assertEquals(result.loadedVariables, 1);
    assertEquals(getEnv("VF_AGENT_ENV_FILE_TEST_EMPTY"), "");
  });

  it("supports explicit env file lists", async () => {
    await Deno.writeTextFile(`${tempDir}/custom.env`, "VF_AGENT_ENV_FILE_TEST_SHARED=custom");

    const result = await loadAgentServiceEnvFiles({
      cwd: tempDir,
      files: ["custom.env"],
    });

    assertEquals(result.loadedFiles, [`${tempDir}/custom.env`]);
    assertEquals(getEnv("VF_AGENT_ENV_FILE_TEST_SHARED"), "custom");
  });

  it("exposes an agent service env loader alias without the hosted prefix", async () => {
    assertEquals(loadAgentServiceEnvFiles, loadHostedAgentServiceEnvFiles);

    await Deno.writeTextFile(`${tempDir}/custom.env`, "VF_AGENT_ENV_FILE_TEST_LOCAL_ONLY=alias");

    const result = await loadAgentServiceEnvFiles({
      cwd: tempDir,
      files: ["custom.env"],
    });

    assertEquals(result.loadedVariables, 1);
    assertEquals(getEnv("VF_AGENT_ENV_FILE_TEST_LOCAL_ONLY"), "alias");
  });
});
