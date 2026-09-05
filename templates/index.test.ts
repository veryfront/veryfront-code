import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#veryfront/compat/path";
import { docsGoogleConfig, MemoryTokenStore, type OAuthTokens } from "veryfront/oauth";

import { getTemplate, getTemplateConfig, templateConfigs } from "#veryfront/templates/index.ts";
import { getIntegrationTemplate } from "#veryfront/templates/loader.ts";
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

function hasEmbeddedCredential(content: string): boolean {
  const credentialPatterns = [
    /=sk-[A-Za-z0-9]/,
    /Bearer [A-Za-z0-9._-]+/,
    /client[_-]?secret\s*[:=]\s*["']?(?!<)[A-Za-z0-9._~+/=-]{12,}/i,
    /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    /[A-Za-z0-9+/]{48,}={0,2}/,
  ];
  return credentialPatterns.some((pattern) => pattern.test(content));
}

describe("templates", () => {
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

  it("ships a tsconfig for every starter template", async () => {
    // The generated package.json carries a `typecheck` script for every
    // starter. Without a tsconfig.json next to it, `tsc --noEmit` prints its
    // help text and exits 0 - a typecheck that passes by checking nothing.
    const missing: string[] = [];

    for (const templateName of STARTER_TEMPLATE_NAMES) {
      const files = await getTemplate(templateName);
      assertExists(files, `${templateName} should load from the template registry`);
      if (!files.some((file) => file.path === "tsconfig.json")) missing.push(templateName);
    }

    assertEquals(missing, [], `starters without a tsconfig.json: ${missing.join(", ")}`);
  });

  it("allows the TypeScript-extension imports each starter actually writes", async () => {
    // Discovered, not listed. `tsc --noEmit` rejects a `./x.ts` specifier with
    // TS5097 unless `allowImportingTsExtensions` is on, and that option needs
    // `noEmit` to be legal. Now that every scaffold ships a `typecheck` script,
    // a starter that writes Deno-native extensions without both options fails
    // its own typecheck on the first run. `agentic-workflow` did: three route
    // modules import `sample-runs.ts` and its tsconfig set neither option.
    //
    // The chat starters are covered by name further down, but a starter that
    // never renders `<Chat>` was not covered at all, which is how this reached
    // a release.
    const offenders: string[] = [];

    for (const templateName of STARTER_TEMPLATE_NAMES) {
      const files = await getTemplate(templateName);
      assertExists(files, `${templateName} should load from the template registry`);

      const importing = files.filter((file) =>
        (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) &&
        /\bfrom\s+["'][^"']+\.tsx?["']/.test(file.content)
      );
      if (importing.length === 0) continue;

      const tsconfig = files.find((file) => file.path === "tsconfig.json");
      assertExists(tsconfig, `${templateName} should declare consumer TypeScript options`);

      for (const option of ["allowImportingTsExtensions", "noEmit"]) {
        if (!tsconfig.content.includes(`"${option}": true`)) {
          offenders.push(`${templateName} (${importing[0]?.path}) is missing ${option}`);
        }
      }
    }

    assertEquals(
      offenders.toSorted(),
      [],
      "a starter imports a .ts/.tsx specifier its own tsconfig rejects with TS5097",
    );
  });

  // @veryfront/ext-content-mdx is an optional peer of the npm package, so it is
  // no longer installed by a plain `npm install veryfront`. A starter that ships
  // a .mdx route has to ask for it, or `npx veryfront dev` serves every route
  // except that one and reports a missing ContentProcessor for it.
  it("installs the MDX content extension for every starter that ships an .mdx route", async () => {
    for (const templateName of STARTER_TEMPLATE_NAMES) {
      const files = await getTemplate(templateName);
      assertExists(files);
      if (!files.some((file) => file.path.endsWith(".mdx"))) continue;

      assertEquals(
        templateConfigs[templateName]?.firstPartyExtensions?.includes(
          "@veryfront/ext-content-mdx",
        ),
        true,
        `${templateName} ships an .mdx route but does not install @veryfront/ext-content-mdx`,
      );
    }
  });

  it("does not make baseline framework extensions starter-specific", async () => {
    const files = await getTemplate("saas-starter");
    assertExists(files);

    assertEquals(files.some((file) => file.path === "veryfront.config.ts"), false);
    // The starter may declare its own npm dependencies; it renders `<Chat>`, so
    // it installs a Markdown renderer like the other chat starters. What it must
    // not do is pin baseline framework extensions, which the CLI resolves.
    assertEquals(templateConfigs["saas-starter"]?.firstPartyExtensions, undefined);
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

  it("scaffolds an ambient CSS module declaration beside the stylesheet import", async () => {
    // `import "../globals.css"` is framework-authored, so without an ambient
    // declaration the very first `tsc --noEmit` on an untouched scaffold is red:
    // `app/layout.tsx(1,8): error TS2882: Cannot find module or type
    // declarations for side-effect import of '../globals.css'`.
    //
    // Discovered from the scaffolded files, not from a list: a starter that
    // starts importing a stylesheet later needs the declaration just as much.
    // Read through `getTemplate` rather than off disk, because a declaration
    // that exists in `files/` but never reaches the manifest leaves the
    // developer with the same red compiler.
    const CSS_SIDE_EFFECT_IMPORT = /^\s*import\s+["'][^"']+\.css["']/m;
    const AMBIENT_CSS_MODULE = /declare\s+module\s+["']\*\.css["']/;

    for (const templateName of STARTER_TEMPLATE_NAMES) {
      const files = await getTemplate(templateName);
      assertExists(files, `${templateName} should load from the template registry`);

      if (!files.some((file) => CSS_SIDE_EFFECT_IMPORT.test(file.content))) continue;

      assertEquals(
        files.some((file) => file.path.endsWith(".d.ts") && AMBIENT_CSS_MODULE.test(file.content)),
        true,
        `${templateName} imports a stylesheet and must scaffold a "*.css" module declaration`,
      );
    }
  });

  it("keeps the ai-agent calculator template lint-clean", async () => {
    const calculatorPath = new URL("./files/ai-agent/tools/calculator.ts", import.meta.url);
    const calculator = await Deno.readTextFile(calculatorPath);

    assertEquals(calculator.includes("execute: async"), false);
    assertEquals(calculator.includes("execute: ({ operation, a, b }) =>"), true);
    assertEquals(
      calculator.includes('v.enum(["add", "subtract", "multiply", "divide", "split"])'),
      true,
    );
  });

  it("keeps one meaning for every calculator argument", async () => {
    const calculator = await Deno.readTextFile(
      new URL("./files/ai-agent/tools/calculator.ts", import.meta.url),
    );

    assertEquals(calculator.includes('"round"'), false);
    assertEquals(calculator.includes("decimals"), false);
  });

  it("splits money into shares that add up to the total exactly", async () => {
    const { default: calculator } = await import(
      "./files/ai-agent/tools/calculator.ts"
    );

    assertEquals(
      await calculator.execute({ operation: "split", a: 99.71, b: 3 }),
      { result: [33.24, 33.24, 33.23] },
    );

    for (const [total, ways] of [[99.71, 3], [0.01, 3], [10, 4], [-99.71, 3]] as const) {
      const { result } = await calculator.execute({ operation: "split", a: total, b: ways });
      if (!Array.isArray(result)) throw new Error("split should return one share per part");
      assertEquals(result.length, ways);
      assertEquals(
        Math.round(result.reduce((sum, share) => sum + share, 0) * 100),
        Math.round(total * 100),
        `shares for ${total} split ${ways} ways should add back to the total`,
      );
    }
  });

  it("refuses a split count it cannot allocate", async () => {
    const { default: calculator } = await import(
      "./files/ai-agent/tools/calculator.ts"
    );

    await assertRejects(
      () => calculator.execute({ operation: "split", a: 10, b: 2 ** 32 }),
      Error,
      "Cannot split into more than 1000 shares",
    );
    await assertRejects(
      () => calculator.execute({ operation: "split", a: 10, b: 0 }),
      Error,
      "Cannot divide by zero",
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
          "Use the calculator tool for arithmetic instead of calculating mentally, and answer as soon as you have the result.",
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

  it("grades the starter's money answer with a rubric a reader can follow", async () => {
    // The starter eval is the first eval most people ever read, so it has to be
    // legible. It used to gate each amount with a hand-rolled lookaround regex
    // (`(?<![-\d.\\])\\?\$33\.23(?!\d|\.\d)`) to reject near-misses like
    // $33.2366 and $133.23. That was exact but unreadable, and copy-pasting it
    // is the wrong lesson to teach. A rubric judge grades the amounts instead.
    const { default: assistantEval } = await import(
      "./files/ai-agent/evals/assistant.eval.ts"
    );

    assertEquals(assistantEval.metrics.map((metric) => metric.name), [
      "agent.calledTool",
      "agent.noFailedTools",
      "judge.rubric",
    ]);

    const source = await Deno.readTextFile(
      new URL("./files/ai-agent/evals/assistant.eval.ts", import.meta.url),
    );
    assertEquals(
      source.includes("metrics.answer.regex"),
      false,
      "the starter eval should not teach hand-rolled regex assertions",
    );
    assertEquals(
      source.includes("String.raw"),
      false,
      "the starter eval should not need raw strings to express an assertion",
    );

    const rubricMetric = assistantEval.metrics.at(-1);
    assertExists(rubricMetric);
    const rubric = String(rubricMetric.config?.rubric ?? "");
    for (const amount of ["$15.21", "$99.71", "$33.24", "$33.23"]) {
      assertEquals(
        rubric.includes(amount),
        true,
        `the rubric should name the expected ${amount}`,
      );
    }
    for (const overreach of ["$33.2366", "$133.23"]) {
      assertEquals(
        rubric.includes(overreach),
        false,
        `the rubric should not gate on the ${overreach} near-miss the starter cannot meet`,
      );
    }
  });

  it("offers every tool its eval gates on", async () => {
    // `tools: true` does not expose project tools to the model. It authorizes
    // the scoped catalog behind `tool_search`, so the model has to go looking
    // first, and for easy work it simply will not. The ai-agent starter shipped
    // that way: its prompt said to use the calculator and its eval gated on
    // `calledTool("calculator")`, but the tool was never offered, so the demo
    // failed its own eval while answering correctly.
    const templatesDir = fromFileUrl(new URL("./files/", import.meta.url));
    const offences: string[] = [];

    for await (const entry of Deno.readDir(templatesDir)) {
      if (!entry.isDirectory) continue;
      const evalsDir = `${templatesDir}${entry.name}/evals`;

      const gated = new Set<string>();
      try {
        for await (const file of Deno.readDir(evalsDir)) {
          if (!file.name.endsWith(".ts")) continue;
          const source = await Deno.readTextFile(`${evalsDir}/${file.name}`);
          for (const match of source.matchAll(/calledTool\(\s*"([^"]+)"/g)) {
            if (match[1]) gated.add(match[1]);
          }
        }
      } catch {
        continue;
      }
      if (gated.size === 0) continue;

      let agents = "";
      try {
        for await (const file of Deno.readDir(`${templatesDir}${entry.name}/agents`)) {
          if (!file.name.endsWith(".ts")) continue;
          agents += await Deno.readTextFile(`${templatesDir}${entry.name}/agents/${file.name}`);
        }
      } catch {
        // No agents directory: the gate cannot be satisfied at all.
      }

      for (const tool of gated) {
        if (!new RegExp(`\\b${tool}\\s*:`).test(agents)) {
          offences.push(`${entry.name} gates on ${tool}`);
        }
      }
    }

    assertEquals(
      offences.toSorted(),
      [],
      "an eval gates on a tool the agent never names. `tools: true` is not " +
        "enough: list the tool explicitly, as `tools: { name: true }`.",
    );
  });

  it("keeps the eval's expected answers out of the system prompt", async () => {
    // A worked example in the prompt lets the model copy the answer instead of
    // computing it, which passes the money gates and the rubric while the
    // calculator is never called. The gates then measure the prompt, not the
    // agent.
    const agent = await Deno.readTextFile(
      new URL("./files/ai-agent/agents/assistant.ts", import.meta.url),
    );
    const system = /system:\s*\n?\s*"([\s\S]*?)",\n/.exec(agent)?.[1] ?? "";
    assertEquals(system.length > 0, true, "could not read the system prompt");

    const leaked = ["15.21", "99.71", "33.24", "33.23"].filter((amount) => system.includes(amount));
    assertEquals(
      leaked,
      [],
      "the system prompt states amounts the eval asserts the agent should derive",
    );
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
      agent.includes("Use the calculator tool for arithmetic instead of calculating mentally"),
      true,
    );
    assertEquals(
      agent.includes(
        "For currency splits use the calculator's split operation, then state every share it returns.",
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
    assertEquals(uploadsPage.includes("useAttachments"), true);
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
    const tokenStoreExamplesPath = new URL(
      "./integrations/_base/files/lib/token-store-examples.ts",
      import.meta.url,
    );
    const tokenStore = await Deno.readTextFile(tokenStorePath);
    const tokenStoreExamples = await Deno.readTextFile(tokenStoreExamplesPath);

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
      tokenStore.includes("The built-in memory store is for development and test."),
      true,
      "token-store.ts header should match the development/test memory-store guard",
    );
    assertEquals(
      tokenStoreExamples.includes("Development/test in-memory backend."),
      true,
      "token-store-examples.ts should match the development/test memory-store guard",
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

  it("keeps scaffolded Google Docs OAuth scopes aligned with the runtime contract", async () => {
    const docsFiles = await getIntegrationTemplate("docs-google");
    assertExists(docsFiles);
    const docsClient = docsFiles.find((file) => file.path === "lib/docs-client.ts");
    assertExists(docsClient);

    const scopeBlock = docsClient.content.match(
      /scopes:\s*\[([\s\S]*?)\],\s*callbackPath:/,
    )?.[1];
    assertExists(scopeBlock);
    const scaffoldedScopes = [...scopeBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assertEquals(scaffoldedScopes, docsGoogleConfig.defaultScopes);

    const baseFiles = await getIntegrationTemplate("_base");
    assertExists(baseFiles);
    const setup = baseFiles.find((file) => file.path === "SETUP.md");
    assertExists(setup);
    const docsScopeRow = setup.content.split("\n").find((line) => line.startsWith("| Docs"));
    assertExists(docsScopeRow);
    assertEquals(
      [...docsScopeRow.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
      docsGoogleConfig.defaultScopes.map((scope) => scope.slice(scope.lastIndexOf("/") + 1)),
    );
  });

  it("generated OAuth token store invalidates superseded broad grants before use", async () => {
    const { createTokenStore, getRefreshableAccessToken } = await import(
      "./integrations/_base/files/lib/token-store.ts"
    );
    const backend = new MemoryTokenStore();
    const store = createTokenStore(backend);
    await backend.setTokens("drive", "alice", {
      accessToken: "legacy-drive-token",
      refreshToken: "legacy-drive-refresh",
      scope: "https://www.googleapis.com/auth/drive",
      expiresAt: Date.now() + 60_000,
    });
    await backend.setTokens("outlook", "alice", {
      accessToken: "legacy-outlook-token",
      refreshToken: "legacy-outlook-refresh",
      scope: "Mail.Read Group.Read.All Group-Conversation.Read.All offline_access",
      expiresAt: Date.now() - 1,
    });
    let refreshCalls = 0;
    const refresh = (_refreshToken: string): Promise<OAuthTokens> => {
      refreshCalls++;
      return Promise.resolve({ accessToken: "unexpected" });
    };

    assertEquals(
      await store.isConnected("alice", "drive", [
        "https://www.googleapis.com/auth/drive.readonly",
      ]),
      false,
    );
    assertEquals(await backend.getTokens("drive", "alice"), null);
    assertEquals(
      await getRefreshableAccessToken(
        store,
        "outlook",
        "alice",
        ["Mail.Read", "offline_access"],
        refresh,
      ),
      null,
    );
    assertEquals(refreshCalls, 0);
    assertEquals(await backend.getTokens("outlook", "alice"), null);
  });

  it("keeps Gmail on the shared refresh-capable token store", async () => {
    const gmailClient = await Deno.readTextFile(
      new URL("./integrations/gmail/files/lib/gmail-client.ts", import.meta.url),
    );

    assertEquals(
      gmailClient.includes("new OAuthService(gmailConfig, tokenStore)"),
      true,
      "Gmail must preserve the shared store's refresh lock and revisioned CAS methods",
    );
    assertEquals(
      gmailClient.includes("tokenStoreAdapter"),
      false,
      "Gmail must not narrow the refresh-capable token store contract",
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

  it("lists auth templates separately from starter and integration templates", async () => {
    const { getAuthTemplate, listAuthTemplates, listIntegrations, listTemplates } = await import(
      "./loader.ts"
    );

    assertEquals(await listAuthTemplates(), ["authelia", "microsoft-entra", "oidc"]);
    assertEquals((await listTemplates()).some((name) => name.startsWith("auth:")), false);
    assertEquals((await listIntegrations()).some((name) => name.startsWith("auth:")), false);
    assertEquals(await getAuthTemplate("missing"), null);
  });

  it("layers auth templates over the base files with deterministic paths", async () => {
    const { getAuthTemplate } = await import("./loader.ts");
    const authelia = await getAuthTemplate("authelia");
    const oidc = await getAuthTemplate("oidc");
    const entra = await getAuthTemplate("microsoft-entra");

    assertEquals(authelia?.map((file) => file.path), [
      ".env.auth.example",
      "AUTH_PROVIDER_SETUP.md",
      "AUTH_SETUP.md",
      "authelia.client.example.yml",
      "veryfront.auth.config.example.ts",
    ]);
    assertEquals(oidc?.map((file) => file.path), [
      ".env.auth.example",
      "AUTH_PROVIDER_SETUP.md",
      "AUTH_SETUP.md",
      "veryfront.auth.config.example.ts",
    ]);
    assertEquals(entra?.map((file) => file.path), [
      ".env.auth.example",
      "AUTH_PROVIDER_SETUP.md",
      "AUTH_SETUP.md",
      "veryfront.auth.config.example.ts",
    ]);
  });

  it("keeps auth templates provider-neutral and free of generated auth handlers", async () => {
    const { getAuthTemplate } = await import("./loader.ts");
    for (const preset of ["authelia", "oidc", "microsoft-entra"]) {
      const files = await getAuthTemplate(preset);
      assert(files !== null, `${preset} must exist`);
      const paths = files.map((file) => file.path);
      const forbiddenPathPattern =
        /(^|\/)(?:middleware|proxy)\.[cm]?[tj]sx?$|(^|\/)(?:app|pages)\/api\/auth(?:\/|$)|(^|\/)(?:callback|token|session|logout)(?:\.|\/)/;
      assertEquals(
        paths.filter((path) => forbiddenPathPattern.test(path)),
        [],
        `${preset} must not generate auth handlers, middleware, callbacks, token, session, logout, or proxy files`,
      );

      const config = files.find((file) => file.path === "veryfront.auth.config.example.ts")
        ?.content ?? "";
      assertStringIncludes(config, "security:");
      assertStringIncludes(config, "oidc:");
      assertEquals(config.includes("adapter"), false);
      assertEquals(config.includes("authelia:"), false);

      const joined = files.map((file) => file.content).join("\n");
      assertStringIncludes(joined, "APP_URL=https://<APP_HOST>");
      assertStringIncludes(
        joined,
        "VERYFRONT_AUTH_SESSION_SECRET=<RANDOM_32_BYTE_OR_LONGER_SECRET>",
      );
      assertEquals(hasEmbeddedCredential(joined), false, `${preset} must not embed credentials`);
      assertStringIncludes(joined, "issuer");
      assertStringIncludes(joined, "callback");
      assertStringIncludes(joined, "PKCE");
      assertStringIncludes(joined, "Active Directory");
      assertStringIncludes(joined, "AD FS");
      if (preset === "authelia") {
        assertStringIncludes(joined, "Authelia");
        assertStringIncludes(joined, "openid");
      }
      if (preset === "microsoft-entra") {
        assertStringIncludes(joined, "Microsoft Entra");
      }
    }
  });

  it("presents standalone inference before the optional Cloud gateway", async () => {
    const aiRulesRoot = new URL("./ai-rules/", import.meta.url);

    for await (const entry of Deno.readDir(aiRulesRoot)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const content = await Deno.readTextFile(new URL(entry.name, aiRulesRoot));
      const providerKey = content.indexOf("Use a provider API key");
      const localServer = content.indexOf("OpenAI-compatible local server");
      const cloudGateway = content.indexOf("optional Veryfront Cloud gateway");

      assert(providerKey >= 0, `${entry.name} must document direct provider keys`);
      assert(localServer > providerKey, `${entry.name} must document local inference`);
      assert(
        cloudGateway > localServer,
        `${entry.name} must present the optional Cloud gateway after standalone inference`,
      );
    }
  });

  it("does not depend on the global JSX namespace in template files", async () => {
    const checkedRoots = [
      new URL("./files/", import.meta.url),
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

describe("chat starters scaffold a Markdown renderer", () => {
  /**
   * Discovered, not listed. A starter that renders `<Chat>` anywhere needs a
   * renderer, and a hardcoded list silently misses one added later or nested
   * below `app/` (which is how `saas-starter` was missed).
   */
  // `<Chat` alone also matches `<ChatThemeScope` and `<ChatSidebar`, neither of
  // which renders Markdown.
  const RENDERS_CHAT = /<Chat[\s/>]/;

  async function chatTemplates(): Promise<TemplateName[]> {
    const found: TemplateName[] = [];
    for (const name of STARTER_TEMPLATE_NAMES) {
      const files = await getTemplate(name);
      if (files?.some((file) => RENDERS_CHAT.test(file.content))) found.push(name);
    }
    return found;
  }

  it("finds every starter that renders chat", async () => {
    const names = await chatTemplates();

    assertEquals(
      names.toSorted(),
      ["ai-agent", "coding-agent", "docs-agent", "multi-agent-system", "saas-starter"],
      "update this list when a starter starts or stops rendering <Chat>",
    );
  });

  it("ships the renderer alongside the parser it imports", async () => {
    for (const name of await chatTemplates()) {
      const files = await getTemplate(name);
      assertExists(files, `${name} should load`);

      const renderer = files.find((file) => file.path === "app/markdown-renderer.tsx");
      assertExists(renderer, `${name} should scaffold app/markdown-renderer.tsx`);

      const dependencies = getTemplateConfig(name)?.npmDependencies ?? {};
      for (const dependency of ["react-markdown", "remark-gfm"]) {
        assertEquals(
          typeof dependencies[dependency],
          "string",
          `${name} imports ${dependency} but does not install it`,
        );
      }
    }
  });

  const MARKDOWN_PARSERS = ["react-markdown", "remark-gfm"] as const;

  /** Every module specifier the file imports from, in source order. */
  function importSpecifiers(source: string): string[] {
    // Static pattern: building one per package name from a variable is what
    // the ReDoS lint flags, and it reads the file once per dependency anyway.
    const specifiers: string[] = [];
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      if (match[1]) specifiers.push(match[1]);
    }
    return specifiers;
  }

  /** The specifier the renderer imports `packageName` under, if any. */
  function parserSpecifier(source: string, packageName: string): string | undefined {
    return importSpecifiers(source).find((specifier) =>
      specifier === packageName || specifier.startsWith(`${packageName}@`)
    );
  }

  it("imports the parser at the exact version it installs", async () => {
    for (const name of await chatTemplates()) {
      const files = await getTemplate(name);
      const renderer = files?.find((file) => file.path === "app/markdown-renderer.tsx");
      assertExists(renderer, `${name} should scaffold app/markdown-renderer.tsx`);

      const dependencies = getTemplateConfig(name)?.npmDependencies ?? {};
      for (const dependency of MARKDOWN_PARSERS) {
        // The module pipeline resolves browser imports from the specifier, not
        // from package.json, so a bare specifier is an unpinned CDN fetch and
        // the dev server warns about it on the first request. Carrying the
        // version inline is what makes the scaffold reproducible.
        //
        // Compared against the whole specifier, not as a substring: `9.0.3` is
        // a prefix of `9.0.31`, so a substring check would accept an import
        // that installs one version and fetches another.
        assertEquals(
          parserSpecifier(renderer.content, dependency),
          `${dependency}@${dependencies[dependency]}`,
          `${name} must import ${dependency} at exactly the version it installs`,
        );
      }
    }
  });

  it("hardens the URLs the renderer emits", async () => {
    // Assistant answers are untrusted input. A bare `<ReactMarkdown>` renders
    // Markdown images as auto-loading `<img>` tags and links with any
    // http(s) URL, so a prompt-injected answer becomes a zero-click beacon to
    // an attacker-controlled host. Every scaffolded renderer must pass a URL
    // policy (`urlTransform`), stop images from auto-loading (an `img`
    // component override), and emit links that neither leak the opener nor
    // pass referrers (`rel="noopener noreferrer ..."`).
    for (const name of await chatTemplates()) {
      const files = await getTemplate(name);
      const renderer = files?.find((file) => file.path === "app/markdown-renderer.tsx");
      assertExists(renderer, `${name} should scaffold app/markdown-renderer.tsx`);

      assertStringIncludes(
        renderer.content,
        "urlTransform",
        `${name} renderer must constrain URL schemes with urlTransform`,
      );
      assertStringIncludes(
        renderer.content,
        "img:",
        `${name} renderer must override img so images do not auto-load`,
      );
      assertStringIncludes(
        renderer.content,
        "noopener noreferrer",
        `${name} renderer must emit rel="noopener noreferrer" links`,
      );

      // A Markdown image can carry its own link (`[![alt](src)](href)`), which
      // react-markdown renders through the `a` override. An anchor in the `img`
      // override would nest inside it: invalid HTML that the browser repairs
      // into a different tree than React rendered, so hydration mismatches.
      const imgStart = renderer.content.indexOf("img:");
      const imgOverride = renderer.content.slice(
        imgStart,
        renderer.content.indexOf("),", imgStart),
      );
      assertEquals(
        imgOverride.includes("<a"),
        false,
        `${name} img override must render inert markup, not a nested anchor`,
      );
    }
  });

  /**
   * Pull `sanitizeUrl` out of a scaffolded renderer so its policy can be
   * exercised directly. The renderer itself imports npm parsers and JSX, so it
   * cannot be imported here; the URL policy is a self-contained function.
   */
  async function loadSanitizeUrl(source: string): Promise<(url: string) => string> {
    const start = source.indexOf("function sanitizeUrl");
    assertEquals(start >= 0, true, "renderer must declare a top-level sanitizeUrl");
    const end = source.indexOf("\n}", start);
    assertEquals(end > start, true, "sanitizeUrl must close at column zero");
    const declaration = source.slice(start, end + 2);
    const module = await import(
      `data:application/typescript;charset=utf-8,${encodeURIComponent(`export ${declaration}`)}`
    ) as { sanitizeUrl: (url: string) => string };
    return module.sanitizeUrl;
  }

  it("drops dangerous schemes even when they are obfuscated", async () => {
    // Passing `urlTransform` replaces react-markdown's own defaultUrlTransform,
    // so this function is the only scheme guard left in the scaffold. Browsers
    // ignore ASCII spaces and control characters while parsing a URL, so a
    // destination written as `[x](java&#9;script:alert(1))` arrives here as
    // `java\tscript:alert(1)` and still navigates to `javascript:` when
    // clicked. The policy has to normalize before it matches.
    for (const name of await chatTemplates()) {
      const files = await getTemplate(name);
      const renderer = files?.find((file) => file.path === "app/markdown-renderer.tsx");
      assertExists(renderer, `${name} should scaffold app/markdown-renderer.tsx`);
      const sanitizeUrl = await loadSanitizeUrl(renderer.content);

      for (
        const blocked of [
          "javascript:alert(1)",
          "java\tscript:alert(1)",
          "java\nscript:alert(1)",
          " javascript:alert(1)",
          "\u0001javascript:alert(1)",
          "JaVaScRiPt:alert(1)",
          "data:text/html,<script>alert(1)</script>",
          " data:text/html,x",
          "vbscript:msgbox(1)",
          "file:///etc/passwd",
        ]
      ) {
        assertEquals(
          sanitizeUrl(blocked),
          "",
          `${name} renderer must drop ${JSON.stringify(blocked)}`,
        );
      }

      for (
        const allowed of [
          "https://example.com/a?b=1#c",
          "http://example.com/a",
          "mailto:someone@example.com",
          "/relative/path",
          "./sibling.md#anchor",
          "#anchor-only",
          "path/to/a:b",
        ]
      ) {
        assertEquals(
          sanitizeUrl(allowed),
          allowed,
          `${name} renderer must keep ${JSON.stringify(allowed)}`,
        );
      }
    }
  });

  it("aliases the pinned parser specifiers for consumer tsc", async () => {
    for (const name of await chatTemplates()) {
      const files = await getTemplate(name);
      const tsconfig = files?.find((file) => file.path === "tsconfig.json");
      assertExists(tsconfig, `${name} should declare consumer TypeScript options`);

      // TypeScript cannot resolve `react-markdown@9.0.3` on its own, so without
      // these aliases the scaffold opens with unresolved-module errors in the
      // editor. The wildcard keeps them correct across a version bump.
      //
      // Read through `compilerOptions.paths` rather than scanning the file, so
      // an alias parked in the wrong object, or one pointing at nothing, fails
      // here instead of in the editor of whoever runs `npm create` next.
      const parsed = JSON.parse(tsconfig.content) as {
        compilerOptions?: { paths?: Record<string, unknown> };
      };
      const paths = parsed.compilerOptions?.paths;
      assertExists(paths, `${name} should declare compilerOptions.paths`);

      for (const dependency of MARKDOWN_PARSERS) {
        assertEquals(
          paths[`${dependency}@*`],
          [`./node_modules/${dependency}`],
          `${name} imports a pinned ${dependency} and must alias it to the installed package`,
        );
      }
    }
  });

  it("allows the relative .tsx import during consumer tsc", async () => {
    for (const name of await chatTemplates()) {
      const files = await getTemplate(name);
      const tsconfig = files?.find((file) => file.path === "tsconfig.json");
      assertExists(tsconfig, `${name} should declare consumer TypeScript options`);

      // `app/page.tsx` imports `./markdown-renderer.tsx`, which consumer tsc
      // rejects with TS5097 unless both options are set.
      assertEquals(
        tsconfig.content.includes('"allowImportingTsExtensions": true'),
        true,
        `${name} imports a .tsx module and must allow the extension`,
      );
      assertEquals(
        tsconfig.content.includes('"noEmit": true'),
        true,
        `${name} needs noEmit to keep allowImportingTsExtensions valid`,
      );
    }
  });

  it("installs the renderer on every file that renders chat", async () => {
    for (const name of await chatTemplates()) {
      const files = await getTemplate(name);
      for (const file of files ?? []) {
        const chatAt = file.content.search(RENDERS_CHAT);
        if (chatAt < 0) continue;

        // The JSX usage, not the import: a file can import the provider and
        // still never wrap anything. Requiring it to open before `<Chat>` is a
        // cheap stand-in for actually wrapping it.
        const providerAt = file.content.indexOf("<MarkdownRendererProvider");
        assertEquals(
          providerAt >= 0 && providerAt < chatAt,
          true,
          `${name}/${file.path} renders <Chat> without wrapping it in a renderer provider`,
        );
      }
    }
  });

  it("gives the router aliases the same dependencies as ai-agent", () => {
    // `getTemplate` serves ai-agent files for these names, so the config has to
    // follow or they scaffold the renderer with nothing to import.
    const expected = getTemplateConfig("ai-agent")?.npmDependencies;

    for (const alias of ["pages-router", "app-router"] as TemplateName[]) {
      assertEquals(
        getTemplateConfig(alias)?.npmDependencies,
        expected,
        `${alias} scaffolds the ai-agent files and must resolve its dependencies`,
      );
    }
  });
});
