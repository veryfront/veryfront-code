import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EvalRecord } from "veryfront/eval";

import { getTemplate, templateConfigs } from "./index.ts";
import { STARTER_TEMPLATE_NAMES, type TemplateName } from "./types.ts";

const STYLED_STARTER_TEMPLATES: TemplateName[] = [
  "ai-agent",
  "docs-agent",
  "multi-agent-system",
  "agentic-workflow",
  "coding-agent",
  "saas-starter",
];

async function collectTemplateTsFiles(dir: URL): Promise<URL[]> {
  const files: URL[] = [];

  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);

    if (entry.isDirectory) {
      files.push(...await collectTemplateTsFiles(child));
    } else if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(child);
    }
  }

  return files;
}

describe("cli/templates", () => {
  it("keeps starter npm dependencies out of root package template files", async () => {
    const offenders: string[] = [];

    for (const templateName of STARTER_TEMPLATE_NAMES) {
      const files = await getTemplate(templateName);
      assertExists(files, `${templateName} should load from the template registry`);

      if (files.some((file) => file.path === "package.json")) {
        offenders.push(templateName);
      }
    }

    assertEquals(
      offenders,
      [],
      `Starter templates must use template config for npm dependencies, not root package.json files. Offenders: ${
        offenders.join(", ")
      }`,
    );
    assertEquals(templateConfigs["docs-agent"]?.npmDependencies?.["@kreuzberg/node"], "^4.4.2");
    assertEquals(templateConfigs["docs-agent"]?.npmDependencies?.["@kreuzberg/wasm"], "4.5.2");
    assertEquals(templateConfigs["docs-agent"]?.firstPartyExtensions, [
      "@veryfront/ext-document-kreuzberg",
    ]);
  });

  it("ships a Tailwind entry stylesheet for styled starter templates", async () => {
    for (const templateName of STYLED_STARTER_TEMPLATES) {
      const globalsPath = new URL(`./files/${templateName}/globals.css`, import.meta.url);
      const globals = await Deno.readTextFile(globalsPath);
      assertExists(globals, `${templateName} should include globals.css`);
      assertEquals(
        globals.includes('@import "tailwindcss";'),
        true,
        `${templateName} globals.css should import tailwindcss`,
      );
    }
  });

  it("does not make baseline framework extensions starter-specific", async () => {
    const files = await getTemplate("saas-starter");
    assertExists(files);

    assertEquals(files.some((file) => file.path === "veryfront.config.ts"), false);
    assertEquals(templateConfigs["saas-starter"], undefined);
  });

  it("imports globals.css from each styled starter root layout", async () => {
    for (const templateName of STYLED_STARTER_TEMPLATES) {
      const layoutPath = new URL(`./files/${templateName}/app/layout.tsx`, import.meta.url);
      const layout = await Deno.readTextFile(layoutPath);
      assertExists(layout, `${templateName} should include app/layout.tsx`);
      assertEquals(
        layout.includes('import "../globals.css";') ||
          layout.includes('import "./globals.css";') ||
          layout.includes('import "@/globals.css";'),
        true,
        `${templateName} layout should import globals.css`,
      );
    }
  });

  it("keeps the ai-agent calculator template lint-clean", async () => {
    const calculatorPath = new URL("./files/ai-agent/tools/calculator.ts", import.meta.url);
    const calculator = await Deno.readTextFile(calculatorPath);

    assertEquals(calculator.includes("execute: async"), false);
    assertEquals(calculator.includes("execute: ({ operation, a, b }) =>"), true);
    assertEquals(
      calculator.includes('v.enum(["add", "subtract", "multiply", "divide", "round"])'),
      true,
    );
    assertEquals(
      calculator.includes("const precision = Math.min(100, Math.max(0, Math.trunc(b)));"),
      true,
    );
    assertEquals(
      calculator.includes(
        "const offset = Math.sign(a) * Number.EPSILON * Math.max(1, Math.abs(a));",
      ),
      true,
    );
    assertEquals(
      calculator.includes("return { result: Number((a + offset).toFixed(precision)) };"),
      true,
    );
  });

  it("rounds positive and negative half cents away from zero", async () => {
    const { default: calculator } = await import(
      "./files/ai-agent/tools/calculator.ts"
    );

    assertEquals(
      await calculator.execute({ operation: "round", a: 1.005, b: 2 }),
      { result: 1.01 },
    );
    assertEquals(
      await calculator.execute({ operation: "round", a: -1.005, b: 2 }),
      { result: -1.01 },
    );
  });

  it("gives the ai-agent enough steps to finish tool-backed answers", async () => {
    const { default: assistant } = await import(
      "./files/ai-agent/agents/assistant.ts"
    );

    assertEquals(assistant.config.maxSteps, 20);
    assertEquals(
      typeof assistant.config.system === "string" &&
        assistant.config.system.includes(
          "Plan the calculation before calling the calculator, use the fewest calls needed, and answer immediately after you have the result.",
        ),
      true,
    );
  });

  it("uses Studio-aligned flat suggestions in the ai-agent starter", async () => {
    const { default: assistant } = await import(
      "./files/ai-agent/agents/assistant.ts"
    );

    assertEquals(assistant.config.suggestions, [
      {
        type: "prompt",
        title: "Shape an idea",
        prompt: "Turn this rough idea into a focused plan with the first three steps: ",
      },
      {
        type: "prompt",
        title: "Run the numbers",
        prompt:
          "Calculate an 18% tip on $84.50, split the total among three people, and explain the result briefly.",
      },
    ]);
  });

  it("accepts sentence punctuation without accepting longer monetary values", async () => {
    const { default: assistantEval } = await import(
      "./files/ai-agent/evals/assistant.eval.ts"
    );
    const moneyMetrics = assistantEval.metrics.slice(0, 4);
    assertEquals(moneyMetrics.map((metric) => metric.name), [
      "answer.regex",
      "answer.regex",
      "answer.regex",
      "answer.regex",
    ]);
    const createRecord = (text: string): EvalRecord => ({
      id: "calculator:1",
      evalId: "eval:assistant",
      exampleId: "calculator",
      repetition: 1,
      input: "Calculate the tip and split.",
      output: { text },
      reference: "$99.71 total; two people pay $33.24 and one pays $33.23.",
      metadata: {},
      trace: { events: [], toolCalls: [] },
      usage: {},
      durationMs: 1,
      completed: true,
    });

    const validResults = await Promise.all(
      moneyMetrics.map((metric) =>
        metric.evaluate(
          createRecord(
            "The tip is $15.21. The total is $99.71. Two people pay $33.24, and one pays $33.23.",
          ),
        )
      ),
    );
    assertEquals(validResults.map((result) => result.pass), [true, true, true, true]);

    const tipMetric = moneyMetrics[0];
    assertExists(tipMetric);
    for (const valid of ["$15.21.", String.raw`\$15.21`, "($15.21)", "**$15.21**"]) {
      assertEquals((await tipMetric.evaluate(createRecord(valid))).pass, true);
    }
    for (
      const invalid of [
        "-15.21",
        "-$15.21",
        String.raw`-\$15.21`,
        "115.21",
        "$15.210",
        "$15.21.0",
      ]
    ) {
      assertEquals((await tipMetric.evaluate(createRecord(invalid))).pass, false);
    }
  });

  it("keeps the ai-agent starter slim, actionable, and viewport-bound", async () => {
    const agent = await Deno.readTextFile(
      new URL("./files/ai-agent/agents/assistant.ts", import.meta.url),
    );
    const assistantEval = await Deno.readTextFile(
      new URL("./files/ai-agent/evals/assistant.eval.ts", import.meta.url),
    );
    const layout = await Deno.readTextFile(
      new URL("./files/ai-agent/app/layout.tsx", import.meta.url),
    );
    const page = await Deno.readTextFile(
      new URL("./files/ai-agent/app/page.tsx", import.meta.url),
    );
    assertEquals(agent.includes('name: "Assistant"'), true);
    assertEquals(agent.includes('description: "Turn a rough idea into a clear next move."'), true);
    assertEquals(
      agent.includes("Use the calculator tool for arithmetic instead of calculating mentally."),
      true,
    );
    assertEquals(
      agent.includes(
        "For currency splits, make rounded shares add exactly to the total and explain any remainder.",
      ),
      true,
    );
    assertEquals(
      agent.includes(
        'prompt: "Turn this rough idea into a focused plan with the first three steps: "',
      ),
      true,
    );
    assertEquals(
      agent.includes(
        '"Calculate an 18% tip on $84.50, split the total among three people, and explain the result briefly."',
      ),
      true,
    );
    assertEquals(agent.includes('title: "Shape an idea"'), true);
    assertEquals(agent.includes('title: "Run the numbers"'), true);
    assertEquals(assistantEval.includes('target: "agent:assistant"'), true);
    assertEquals(
      assistantEval.includes(
        '"Calculate an 18% tip on $84.50, split the total among three people, and explain the result briefly."',
      ),
      true,
    );
    assertEquals(assistantEval.includes('metrics.agent.calledTool("calculator").gate()'), true);
    assertEquals(assistantEval.includes("metrics.agent.noFailedTools().gate()"), true);
    assertEquals(assistantEval.includes("metrics.answer.contains("), false);
    assertEquals(assistantEval.includes("judge: judges.llm.rubric()"), true);
    assertEquals(assistantEval.includes("metrics.judge.rubric({"), true);
    assertEquals(layout.includes("className="), false);
    assertEquals(layout.includes("bg-white"), false);
    assertEquals(layout.includes("dark:bg-neutral-900"), false);
    assertEquals(page.includes('className="h-screen"'), true);
    assertEquals(page.includes("api="), false);
    assertEquals(page.includes("placeholder="), false);
  });

  it("uses the current app-mode chat surface in starter templates", async () => {
    const simpleStarters: Array<{ template: TemplateName; page: string; agentId: string }> = [
      { template: "ai-agent", page: "app/page.tsx", agentId: "assistant" },
      { template: "multi-agent-system", page: "app/page.tsx", agentId: "orchestrator" },
      { template: "coding-agent", page: "app/page.tsx", agentId: "coder" },
      { template: "saas-starter", page: "app/dashboard/page.tsx", agentId: "assistant" },
    ];

    for (const { template, page, agentId } of simpleStarters) {
      const pageSource = await Deno.readTextFile(
        new URL(`./files/${template}/${page}`, import.meta.url),
      );
      assertEquals(
        pageSource.includes("useChat"),
        false,
        `${template} should use app-mode Chat instead of wiring useChat manually`,
      );
      assertEquals(
        pageSource.includes(`agentId="${agentId}"`),
        true,
        `${template} should pass its generated agent id to Chat`,
      );
    }

    const featureChat = await Deno.readTextFile(
      new URL("./features/ai/files/app/chat/page.tsx", import.meta.url),
    );
    assertEquals(featureChat.includes("useChat"), false);
    assertEquals(featureChat.includes('agentId="assistant"'), true);
  });

  it("keeps docs-agent on the shared chat shell and uploads components", async () => {
    const layout = await Deno.readTextFile(
      new URL("./files/docs-agent/app/layout.tsx", import.meta.url),
    );
    const page = await Deno.readTextFile(
      new URL("./files/docs-agent/app/page.tsx", import.meta.url),
    );
    const uploadsPage = await Deno.readTextFile(
      new URL("./files/docs-agent/app/uploads/page.tsx", import.meta.url),
    );
    const agent = await Deno.readTextFile(
      new URL("./files/docs-agent/agents/rag.ts", import.meta.url),
    );

    for (
      const needle of [
        "ChatThemeScope",
        "ConversationsProvider",
        "AppShell",
        "ChatSidebar",
        "Tabs",
      ]
    ) {
      assertEquals(layout.includes(needle), true, `docs-agent layout should use ${needle}`);
    }
    assertEquals(layout.includes("<ChatSidebar.Root"), true);
    assertEquals(layout.includes("<ChatSidebar fill"), false);

    assertEquals(page.includes("useChat"), false);
    assertEquals(page.includes('agentId="rag"'), true);
    assertEquals(
      page.includes("uploadApi"),
      false,
      "the RAG ingestion route does not return a runtime-fetchable Chat attachment URL",
    );
    assertEquals(uploadsPage.includes("AttachmentsPanel"), true);
    assertEquals(uploadsPage.includes("useUploadsRegistry"), true);
    assertEquals(uploadsPage.includes('role="alert"'), true);
    assertEquals(uploadsPage.includes("refreshError"), true);
    assertEquals(uploadsPage.includes("removeError"), true);
    assertEquals(uploadsPage.includes("storageError"), true);
    assertEquals(agent.includes("suggestions:"), true);
  });

  it("keeps docs-agent consumer TypeScript configuration clean", async () => {
    const files = await getTemplate("docs-agent");
    assertExists(files);

    const tsconfig = files.find((file) => file.path === "tsconfig.json");
    assertExists(tsconfig, "docs-agent should declare consumer TypeScript options");
    assertEquals(
      tsconfig.content.includes('"allowImportingTsExtensions": true'),
      true,
      "docs-agent should allow Deno-native .ts app route imports during consumer tsc",
    );
    assertEquals(
      tsconfig.content.includes('"noEmit": true'),
      true,
      "docs-agent should keep allowImportingTsExtensions valid for consumer tsc",
    );

    const globalTypes = files.find((file) => file.path === "globals.d.ts");
    assertExists(globalTypes, "docs-agent should declare stylesheet imports for consumer tsc");
    assertEquals(globalTypes.content.includes('declare module "*.css";'), true);

    const layout = files.find((file) => file.path === "app/layout.tsx");
    assertExists(layout);
    assertEquals(
      layout.content.includes("onValueChange={(value: string) =>"),
      true,
      "docs-agent should type the Tabs callback against published consumer declarations",
    );
  });

  it("keeps docs-agent app route modules importable by Deno", async () => {
    const routePaths = [
      "app/api/ag-ui/route.ts",
      "app/api/ingest/route.ts",
      "app/api/uploads/route.ts",
    ];

    for (const routePath of routePaths) {
      await import(new URL(`./files/docs-agent/${routePath}`, import.meta.url).href);
    }
  });

  it("integration token store fails closed instead of silently using memory in production", async () => {
    const tokenStorePath = new URL(
      "./integrations/_base/files/lib/token-store.ts",
      import.meta.url,
    );
    const tokenStore = await Deno.readTextFile(tokenStorePath);

    assertEquals(
      tokenStore.includes("createDefaultTokenStore"),
      true,
      "token-store.ts should centralize default store selection",
    );
    assertEquals(
      tokenStore.includes("only when NODE_ENV is explicitly development or test"),
      true,
      "token-store.ts should fail closed outside explicit development and test modes",
    );
    assertEquals(
      tokenStore.includes("getDefaultTokenStore"),
      true,
      "token-store.ts should resolve the default store lazily",
    );
    assertEquals(
      tokenStore.includes("type RefreshCapableTokenStore"),
      true,
      "token-store.ts should require the production refresh-capable contract",
    );
    assertEquals(
      tokenStore.includes("return store.compareAndSetTokens"),
      true,
      "token-store.ts should delegate atomic token replacement",
    );
    assertEquals(
      tokenStore.includes("return store.withTokenRefreshLock"),
      true,
      "token-store.ts should delegate refresh locking to the configured backend",
    );
    assertEquals(
      tokenStore.includes("return store.consumeState"),
      true,
      "token-store.ts should keep one-shot state in the configured shared backend",
    );
    assertEquals(
      tokenStore.includes("export const tokenStore: TokenStore = {"),
      true,
      "token-store.ts should expose a lazy proxy that is safe to import in production",
    );
  });

  it("generated OAuth refresh helpers use the shared lock and CAS protocol", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const offenders: string[] = [];
    let helperCount = 0;

    for (const file of await collectTemplateTsFiles(integrationTemplates)) {
      const source = await Deno.readTextFile(file);
      if (!source.includes("export async function getValidToken(")) continue;

      helperCount++;
      if (
        !source.includes("getRefreshableAccessToken(") ||
        source.includes("tokenStore.setToken(") ||
        source.includes("tokenStore.revokeToken(")
      ) {
        offenders.push(file.pathname.replace(integrationTemplates.pathname, ""));
      }
    }

    assertEquals(helperCount, 3, "Expected every generated getValidToken implementation");
    assertEquals(
      offenders,
      [],
      `OAuth refresh helpers must use the shared lock/CAS protocol. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("OAuth route templates use the central shared token store", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const offenders: string[] = [];
    let routeCount = 0;

    for (const file of await collectTemplateTsFiles(integrationTemplates)) {
      const source = await Deno.readTextFile(file);
      if (
        !source.includes("createOAuthInitHandler") &&
        !source.includes("createOAuthCallbackHandler")
      ) continue;

      routeCount++;
      const isCallbackRoute = source.includes("createOAuthCallbackHandler");
      const expectedStoreImport = isCallbackRoute
        ? 'import { tokenStore } from "../../../../../lib/token-store.ts";'
        : 'import { tokenStore } from "../../../../lib/token-store.ts";';
      if (
        !source.includes(expectedStoreImport) ||
        (!isCallbackRoute &&
          (!source.includes(
            'import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";',
          ) ||
            !source.includes("getUserId: requireUserIdFromRequest") ||
            source.includes("function getUserId("))) ||
        source.includes("oauthMemoryTokenStore") ||
        source.includes("hybridTokenStore")
      ) {
        offenders.push(file.pathname.replace(integrationTemplates.pathname, ""));
      }
    }

    assertEquals(routeCount, 46, "Expected every generated OAuth init and callback route");
    assertEquals(
      offenders,
      [],
      `OAuth routes must share the central refresh-capable store. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("integration templates do not use hardcoded shared user ids", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const offenders: string[] = [];
    const forbiddenUserIds = [
      '"current-user"',
      "'current-user'",
      '"demo-user"',
      "'demo-user'",
      '"dev-user"',
      "'dev-user'",
      "DEFAULT_USER_ID",
      "CURRENT_USER_ID",
      "VERYFRONT_DEV_USER_ID",
    ];

    for (const file of await collectTemplateTsFiles(integrationTemplates)) {
      const source = await Deno.readTextFile(file);
      for (const userId of forbiddenUserIds) {
        if (source.includes(userId)) {
          offenders.push(
            `${file.pathname.replace(integrationTemplates.pathname, "")}: ${userId}`,
          );
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `Integration templates must resolve authenticated user ids from requests or tool contexts. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("Google workspace tools resolve authenticated users from execution context", async () => {
    const integrations = [
      { name: "drive", clientFactory: "createDriveClient" },
      { name: "docs-google", clientFactory: "createDocsClient" },
      { name: "sheets", clientFactory: "createSheetsClient" },
    ];
    const offenders: string[] = [];
    let toolCount = 0;

    for (const { name, clientFactory } of integrations) {
      const toolsDirectory = new URL(`./integrations/${name}/files/tools/`, import.meta.url);
      for (const file of await collectTemplateTsFiles(toolsDirectory)) {
        const source = await Deno.readTextFile(file);
        if (!source.includes(`${clientFactory}(`)) continue;

        toolCount++;
        if (
          !source.includes(
            'import { requireUserIdFromContext } from "../lib/user-id.ts";',
          ) ||
          !source.includes("requireUserIdFromContext(context)") ||
          !source.includes(`${clientFactory}(userId)`)
        ) {
          offenders.push(`${name}/${file.pathname.split("/").at(-1)}`);
        }
      }
    }

    assertEquals(toolCount, 26, "Expected every Drive, Docs, and Sheets tool");
    assertEquals(
      offenders,
      [],
      `Google workspace tools must use authenticated tool execution context. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("integration content tools do not impose fixed text caps", async () => {
    const checkedFiles = [
      "./integrations/github/files/tools/get-pr-diff.ts",
      "./integrations/sharepoint/files/tools/get-file.ts",
    ];
    const forbidden = [
      "50000",
      "50_000",
      "contentMaxLength",
      "maxDiffLength",
      "Content truncated",
      "diff truncated",
      "maximum content length",
    ];
    const offenders: string[] = [];

    for (const filePath of checkedFiles) {
      const source = await Deno.readTextFile(new URL(filePath, import.meta.url));
      for (const needle of forbidden) {
        if (source.includes(needle)) {
          offenders.push(`${filePath}: ${needle}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `Integration content tools must return full requested text by default. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("base integration tools do not read legacy endUserId from tool context", async () => {
    const userIdTemplatePath = new URL(
      "./integrations/_base/files/lib/user-id.ts",
      import.meta.url,
    );
    const userIdTemplate = await Deno.readTextFile(userIdTemplatePath);

    assertEquals(
      userIdTemplate.includes("context?.endUserId"),
      false,
      "base integration tools must use app-authenticated userId rather than legacy endUserId",
    );
  });

  it("keeps the shared identity boundary fail-closed and free of provider overrides", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const userIdTemplates = (await collectTemplateTsFiles(integrationTemplates))
      .filter((file) => file.pathname.endsWith("/files/lib/user-id.ts"))
      .map((file) => file.pathname.replace(integrationTemplates.pathname, ""));

    assertEquals(userIdTemplates, ["_base/files/lib/user-id.ts"]);

    const sharedTemplate = await Deno.readTextFile(
      new URL("./integrations/_base/files/lib/user-id.ts", import.meta.url),
    );
    assertEquals(sharedTemplate.includes("request.headers"), false);
    assertEquals(
      sharedTemplate.includes("Authenticated request identity is not configured"),
      true,
    );
    assertEquals(sharedTemplate.includes("resolveAuthenticatedUserId"), true);
    // The identity boundary must have no ambient fallback: an environment-gated
    // default collapses every visitor onto one token owner.
    for (
      const ambient of [
        "isDevelopmentRuntime",
        "VERYFRONT_DEV_USER_ID",
        '"dev-user"',
        "'dev-user'",
        "NODE_ENV",
        "DENO_ENV",
      ]
    ) {
      assertEquals(
        sharedTemplate.includes(ambient),
        false,
        `shared identity template must not derive a user id from ${ambient}`,
      );
    }
  });

  it("keeps authenticated identity documentation within ASCII copy rules", async () => {
    for (
      const path of [
        "./integrations/_base/files/SETUP.md",
        "./integrations/sheets/README.md",
      ]
    ) {
      const source = await Deno.readTextFile(new URL(path, import.meta.url));
      assertEquals(
        /[\u2013\u2014]/.test(source),
        false,
        `${path} must use ASCII punctuation`,
      );
    }
  });

  it("requires an implemented resolver and never trusts identity headers", async () => {
    const { requireUserIdFromRequest } = await import(
      "./integrations/_base/files/lib/user-id.ts"
    );
    const request = new Request("https://app.example.test/api/auth/example", {
      headers: {
        "x-veryfront-user-id": "client-controlled-user",
        "x-user-id": "client-controlled-user",
      },
    });

    // Fails closed until the application implements a verified resolver, in every
    // runtime mode — there is no development escape hatch.
    await assertRejects(
      () => requireUserIdFromRequest(request),
      Error,
      "Authenticated request identity is not configured",
    );
  });

  it("requires an authenticated tool context user id with no ambient default", async () => {
    const { requireUserIdFromContext } = await import(
      "./integrations/_base/files/lib/user-id.ts"
    );

    assertEquals(requireUserIdFromContext({ userId: "ctx-user" }), "ctx-user");
    const maximumUserId = "u".repeat(1_024);
    assertEquals(requireUserIdFromContext({ userId: maximumUserId }), maximumUserId);

    for (
      const context of [
        undefined,
        {},
        { userId: "" },
        { userId: " padded " },
        { userId: "u".repeat(1_025) },
      ]
    ) {
      assertThrows(
        () => requireUserIdFromContext(context),
        Error,
        "Authenticated tool context userId is required",
      );
    }
  });

  it("keeps generated AI rules focused on current project primitives", async () => {
    const aiRulesRoot = new URL("./ai-rules/", import.meta.url);
    const forbidden = [
      "`tasks/`",
      "`prompts/`",
      "`resources/`",
      "`integrations/`",
      "Veryfront MCP",
      "vf_bootstrap",
      "http://localhost:3002/mcp",
      "tasks, resources, prompts",
    ];
    const offenders: string[] = [];

    for await (const entry of Deno.readDir(aiRulesRoot)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const content = await Deno.readTextFile(new URL(entry.name, aiRulesRoot));
      for (const needle of forbidden) {
        if (content.includes(needle)) {
          offenders.push(`${entry.name}: ${needle}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `AI-rule templates must not teach legacy project folders or MCP setup. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("does not depend on the global JSX namespace in template files", async () => {
    const checkedRoots = [
      new URL("./files/", import.meta.url),
      new URL("./features/", import.meta.url),
      new URL("./integrations/", import.meta.url),
    ];
    const offenders: string[] = [];

    for (const root of checkedRoots) {
      for (const file of await collectTemplateTsFiles(root)) {
        const source = await Deno.readTextFile(file);
        if (/(^|[^.\w])JSX\./.test(source)) {
          offenders.push(file.pathname.replace(root.pathname, ""));
        }
      }
    }

    const manifest = await Deno.readTextFile(new URL("./manifest.json", import.meta.url));
    if (/(^|[^.\w])JSX\./.test(manifest)) {
      offenders.push("manifest.json");
    }

    assertEquals(
      offenders,
      [],
      `Template files must use React.JSX or inferred JSX return types for Deno checks. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });
});
