import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { discoverAll } from "#veryfront/discovery";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import type { ExtensionLoader } from "./loader.ts";
import { createBuiltinExtensions } from "./builtin-extensions.ts";
import { reset, tryResolve } from "./contracts.ts";
import { createEvalReportExporterRegistry, EvalReportExporterRegistryName } from "./eval/index.ts";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "./llm/index.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "./parser/skill-document-parser.ts";
import { orchestrateExtensions } from "./orchestrate.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("built-in Skill YAML discovery integration", () => {
  let loader: ExtensionLoader | undefined;

  afterEach(async () => {
    await loader?.teardownAll();
    loader = undefined;
    reset();
    skillRegistryInternal.clearAll();
  });

  it("registers the first-party decoder before discovering a real SKILL.md", async () => {
    reset();
    skillRegistryInternal.clearAll();
    assertEquals(
      tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName),
      undefined,
    );

    const projectDir = await Deno.makeTempDir({
      prefix: "vf-builtin-skill-yaml-",
    });
    try {
      await Deno.mkdir(`${projectDir}/skills/demo`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/skills/demo/SKILL.md`,
        `---
name: demo
description: |
  Parsed by the built-in YAML extension
  before Skill discovery runs.
allowed-tools:
  - Read
  - api:*
metadata:
  display_name: Built-in YAML Demo
---
Use the discovered skill.
`,
      );

      loader = await orchestrateExtensions({
        projectDir,
        config: {},
        logger: noopLogger,
        primeContracts: {
          [LLMProviderRegistryName]: createLLMProviderRegistry(),
          [EvalReportExporterRegistryName]: createEvalReportExporterRegistry(),
        },
        builtinExtensions: createBuiltinExtensions(),
      });

      assertExists(
        tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName),
      );

      const result = await discoverAll({
        baseDir: projectDir,
        toolDirs: [],
        agentDirs: [],
        resourceDirs: [],
        promptDirs: [],
        workflowDirs: [],
        taskDirs: [],
        scheduleDirs: [],
        webhookDirs: [],
        evalDirs: [],
        skillDirs: ["skills"],
      });

      const skill = result.skills.get("demo");
      assertEquals(result.errors, []);
      assertExists(skill);
      assertEquals(
        skill.metadata.description,
        "Parsed by the built-in YAML extension\nbefore Skill discovery runs.",
      );
      assertEquals(skill.metadata.allowedTools, ["Read", "api:*"]);
      assertEquals(skill.metadata.displayName, "Built-in YAML Demo");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
