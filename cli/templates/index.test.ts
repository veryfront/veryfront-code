import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { getTemplate, templateConfigs } from "./index.ts";
import {
  ATLASSIAN_OAUTH_CALLBACK_PATH,
  generateAtlassianOAuthFiles,
} from "./atlassian-oauth-composition.ts";
import { STARTER_TEMPLATE_NAMES, type TemplateName } from "./types.ts";
import {
  airtableConfig,
  asanaConfig,
  bitbucketConfig,
  calendarConfig,
  confluenceConfig,
  docsGoogleConfig,
  driveConfig,
  figmaConfig,
  githubConfig,
  gitlabConfig,
  gmailConfig,
  jiraConfig,
  linearConfig,
  notionConfig,
  oneDriveConfig,
  outlookConfig,
  sharePointConfig,
  sheetsConfig,
  slackConfig,
  teamsConfig,
} from "veryfront/oauth";

const STYLED_STARTER_TEMPLATES: TemplateName[] = [
  "ai-agent",
  "docs-agent",
  "multi-agent-system",
  "agentic-workflow",
  "coding-agent",
  "saas-starter",
];

const OAUTH_CLIENT_INTEGRATIONS = {
  airtable: "createAirtableClient",
  asana: "createAsanaClient",
  confluence: "createConfluenceClient",
  figma: "createFigmaClient",
  gitlab: "createGitLabClient",
  jira: "createJiraClient",
  linear: "createLinearClient",
  notion: "createNotionClient",
  onedrive: "createOneDriveClient",
  outlook: "createOutlookClient",
  sharepoint: "createSharePointClient",
  teams: "createTeamsClient",
} as const;

const SUPPORTED_OAUTH_TOOL_INTEGRATIONS = [
  ...Object.keys(OAUTH_CLIENT_INTEGRATIONS),
  "bitbucket",
  "calendar",
  "docs-google",
  "drive",
  "github",
  "gmail",
  "sheets",
  "slack",
] as const;

const OAUTH_CLIENT_FILES = {
  airtable: "airtable-client.ts",
  asana: "asana-client.ts",
  bitbucket: "bitbucket-client.ts",
  calendar: "calendar-client.ts",
  confluence: "confluence-client.ts",
  "docs-google": "docs-client.ts",
  drive: "drive-client.ts",
  figma: "figma-client.ts",
  github: "github-client.ts",
  gitlab: "gitlab-client.ts",
  gmail: "gmail-client.ts",
  jira: "jira-client.ts",
  linear: "linear-client.ts",
  notion: "notion-client.ts",
  onedrive: "onedrive-client.ts",
  outlook: "outlook-client.ts",
  sharepoint: "sharepoint-client.ts",
  sheets: "sheets-client.ts",
  slack: "slack-client.ts",
  teams: "teams-client.ts",
} as const;

const OAUTH_PROVIDER_CONFIGS = {
  airtable: airtableConfig,
  asana: asanaConfig,
  bitbucket: bitbucketConfig,
  calendar: calendarConfig,
  confluence: confluenceConfig,
  "docs-google": docsGoogleConfig,
  drive: driveConfig,
  figma: figmaConfig,
  github: githubConfig,
  gitlab: gitlabConfig,
  gmail: gmailConfig,
  jira: jiraConfig,
  linear: linearConfig,
  notion: notionConfig,
  onedrive: oneDriveConfig,
  outlook: outlookConfig,
  sharepoint: sharePointConfig,
  sheets: sheetsConfig,
  slack: slackConfig,
  teams: teamsConfig,
} as const;

async function collectTemplateTsFiles(dir: URL): Promise<URL[]> {
  const files: URL[] = [];

  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);

    if (entry.isDirectory) {
      files.push(...await collectTemplateTsFiles(child));
    } else if (
      entry.isFile &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
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
      assertExists(
        files,
        `${templateName} should load from the template registry`,
      );

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
    assertEquals(
      templateConfigs["docs-agent"]?.npmDependencies?.["@kreuzberg/node"],
      "^4.4.2",
    );
    assertEquals(
      templateConfigs["docs-agent"]?.npmDependencies?.["@kreuzberg/wasm"],
      "4.5.2",
    );
    assertEquals(templateConfigs["docs-agent"]?.firstPartyExtensions, [
      "@veryfront/ext-document-kreuzberg",
    ]);
  });

  it("ships a Tailwind entry stylesheet for styled starter templates", async () => {
    for (const templateName of STYLED_STARTER_TEMPLATES) {
      const globalsPath = new URL(
        `./files/${templateName}/globals.css`,
        import.meta.url,
      );
      const globals = await Deno.readTextFile(globalsPath);
      assertExists(globals, `${templateName} should include globals.css`);
      assertEquals(
        globals.includes('@import "tailwindcss";'),
        true,
        `${templateName} globals.css should import tailwindcss`,
      );
    }
  });

  it("imports globals.css from each styled starter root layout", async () => {
    for (const templateName of STYLED_STARTER_TEMPLATES) {
      const layoutPath = new URL(
        `./files/${templateName}/app/layout.tsx`,
        import.meta.url,
      );
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
    const calculatorPath = new URL(
      "./files/ai-agent/tools/calculator.ts",
      import.meta.url,
    );
    const calculator = await Deno.readTextFile(calculatorPath);

    assertEquals(calculator.includes("execute: async"), false);
    assertEquals(
      calculator.includes("execute: ({ operation, a, b }) =>"),
      true,
    );
  });

  it("uses the current app-mode chat surface in starter templates", async () => {
    const simpleStarters: Array<
      { template: TemplateName; page: string; agentId: string }
    > = [
      { template: "ai-agent", page: "app/page.tsx", agentId: "assistant" },
      {
        template: "multi-agent-system",
        page: "app/page.tsx",
        agentId: "orchestrator",
      },
      { template: "coding-agent", page: "app/page.tsx", agentId: "coder" },
      {
        template: "saas-starter",
        page: "app/dashboard/page.tsx",
        agentId: "assistant",
      },
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
      assertEquals(
        layout.includes(needle),
        true,
        `docs-agent layout should use ${needle}`,
      );
    }
    assertEquals(layout.includes("<ChatSidebar.Root"), true);
    assertEquals(layout.includes("<ChatSidebar fill"), false);

    assertEquals(page.includes("useChat"), false);
    assertEquals(page.includes('agentId="rag"'), true);
    assertEquals(page.includes('uploadApi="/api/uploads"'), true);
    assertEquals(uploadsPage.includes("AttachmentsPanel"), true);
    assertEquals(uploadsPage.includes("useUploadsRegistry"), true);
    assertEquals(agent.includes("suggestions:"), true);
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
      tokenStore.includes(
        "In-memory credential storage is not allowed in production",
      ),
      true,
      "token-store.ts should fail closed for production memory storage",
    );
    assertEquals(
      tokenStore.includes("getDefaultTokenStore"),
      true,
      "token-store.ts should resolve the default store lazily",
    );
    assertEquals(
      tokenStore.includes(
        "export const tokenStore: TokenStore = inMemoryStore;",
      ),
      false,
      "token-store.ts must not export the in-memory store unconditionally",
    );
    assertEquals(
      tokenStore.includes(
        "export const tokenStore: TokenStore = createDefaultTokenStore();",
      ),
      false,
      "token-store.ts must not throw during module import in production",
    );
  });

  it("OAuth integration routes share one hardened application token store", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const oauthRoutes: string[] = [];
    const offenders: string[] = [];
    const inspectRoute = (path: string, source: string): void => {
      oauthRoutes.push(path);
      for (
        const forbidden of [
          "oauthMemoryTokenStore",
          "hybridTokenStore",
          "tokenStore.getToken",
          "codeVerifier?: string",
          "redirectUri?: string",
        ]
      ) {
        if (source.includes(forbidden)) {
          offenders.push(`${path}: ${forbidden}`);
        }
      }
      if (!source.includes("oauthTokenStore")) {
        offenders.push(`${path}: missing oauthTokenStore`);
      }
      const sharedLibPrefix = source.includes("createOAuthInitHandler")
        ? "../../../../lib/"
        : "../../../../../lib/";
      if (!source.includes(sharedLibPrefix)) {
        offenders.push(`${path}: invalid generated lib import depth`);
      }
    };

    for (const file of await collectTemplateTsFiles(integrationTemplates)) {
      if (!file.pathname.includes("/app/api/auth/")) continue;
      const source = await Deno.readTextFile(file);
      if (
        !source.includes("createOAuthInitHandler") &&
        !source.includes("createOAuthCallbackHandler")
      ) {
        continue;
      }

      inspectRoute(file.pathname, source);
    }

    const atlassianCallback = generateAtlassianOAuthFiles([
      "jira",
      "confluence",
    ]).find((file) => file.path === ATLASSIAN_OAUTH_CALLBACK_PATH);
    assertExists(atlassianCallback);
    inspectRoute(atlassianCallback.path, atlassianCallback.content);

    assertEquals(
      oauthRoutes.length,
      45,
      "23 OAuth integrations should ship init routes and one callback per provider grant",
    );
    assertEquals(
      offenders,
      [],
      `OAuth routes must share the production-capable TokenStore contract. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("OAuth storage is injected, capability-checked, and only explicitly memory-backed in dev", async () => {
    const registry = await Deno.readTextFile(
      new URL(
        "./integrations/_base/files/lib/oauth-store-registry.ts",
        import.meta.url,
      ),
    );
    const store = await Deno.readTextFile(
      new URL("./integrations/_base/files/lib/oauth-store.ts", import.meta.url),
    );

    for (
      const capability of [
        "getTokenSnapshot",
        "compareAndSetTokens",
        "withTokenRefreshLock",
        "setState",
        "consumeState",
        "getStorageStatus",
      ]
    ) {
      assertEquals(
        registry.includes(capability),
        true,
        `injected OAuth TokenStore must require ${capability}`,
      );
    }
    assertEquals(registry.includes("installOAuthTokenStore"), true);
    assertEquals(store.includes("VERYFRONT_OAUTH_STORE_MODE"), true);
    assertEquals(store.includes('=== "memory"'), true);
    assertEquals(store.includes("new MemoryTokenStore"), true);
    assertEquals(
      store.includes("OAuth TokenStore is not configured"),
      true,
      "production route loading must fail instead of silently selecting memory",
    );

    const statusRoute = await Deno.readTextFile(
      new URL(
        "./integrations/_base/files/app/api/integrations/token-storage/route.ts",
        import.meta.url,
      ),
    );
    assertEquals(statusRoute.includes("getOAuthStorageStatus"), true);
    assertEquals(statusRoute.includes("requireUserIdFromRequest"), true);
    assertEquals(statusRoute.includes("process.env"), false);
    assertEquals(statusRoute.includes("autoGenerated"), false);
    assertEquals(statusRoute.includes("encrypted: true"), false);

    const legacyStore = await Deno.readTextFile(
      new URL(
        "./integrations/_base/files/lib/token-store.ts",
        import.meta.url,
      ),
    );
    assertEquals(legacyStore.includes("process.env"), false);
    assertEquals(legacyStore.includes("AUTO_KEY_STORAGE"), false);
    assertEquals(legacyStore.includes("JSON.stringify(["), true);
    assertEquals(legacyStore.includes("legacyColonKeyMigration"), true);
    await assertRejects(
      () =>
        Deno.stat(
          new URL(
            "./integrations/_base/files/lib/token-store-examples.ts",
            import.meta.url,
          ),
        ),
      Deno.errors.NotFound,
    );
  });

  it("OAuth request identity requires an injected verified resolver", async () => {
    const userIdTemplate = await Deno.readTextFile(
      new URL("./integrations/_base/files/lib/user-id.ts", import.meta.url),
    );

    assertEquals(
      userIdTemplate.includes("installRequestIdentityResolver"),
      true,
    );
    assertEquals(userIdTemplate.includes("x-user-id"), false);
    assertEquals(userIdTemplate.includes("x-veryfront-user-id"), false);
    assertEquals(userIdTemplate.includes('?? "dev-user"'), false);
    assertEquals(
      userIdTemplate.includes("Deno.env"),
      false,
      "template must not require Deno",
    );
    assertEquals(
      userIdTemplate.includes("globalThis"),
      true,
      "template must support Deno",
    );
  });

  it("integration OAuth clients delegate refresh to veryfront/oauth", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const oauthFiles: URL[] = [];

    for (const file of await collectTemplateTsFiles(integrationTemplates)) {
      if (file.pathname.endsWith("/files/lib/oauth.ts")) oauthFiles.push(file);
    }

    assertEquals(
      oauthFiles.map((file) => file.pathname.replace(integrationTemplates.pathname, "")),
      ["_base/files/lib/oauth.ts"],
      "integrations must not override the shared hardened OAuth helper",
    );
    const source = await Deno.readTextFile(oauthFiles[0]!);
    assertEquals(source.includes("OAuthService"), true);
    assertEquals(source.includes("oauthTokenStore"), true);
    assertEquals(source.includes('redirect: "error"'), true);
    assertEquals(source.includes("AbortSignal.timeout"), true);
    assertEquals(source.includes("readBoundedBytes"), true);
    assertEquals(source.includes("target.origin !== allowed.origin"), true);
    assertEquals(source.includes("assertCredentialFreeHeaders"), true);
  });

  it("OAuth integration clients never issue raw token-bearing fetch requests", async () => {
    const offenders: string[] = [];
    for (const [integration, fileName] of Object.entries(OAUTH_CLIENT_FILES)) {
      const source = await Deno.readTextFile(
        new URL(
          `./integrations/${integration}/files/lib/${fileName}`,
          import.meta.url,
        ),
      );
      if (/(^|[^.\w])fetch\s*\(/m.test(source)) {
        offenders.push(`${integration}: raw fetch`);
      }
      if (/Authorization\s*:/i.test(source)) {
        offenders.push(`${integration}: constructs Authorization`);
      }
      if (source.includes("getValidToken")) {
        offenders.push(`${integration}: extracts a bearer token`);
      }
    }
    assertEquals(
      offenders,
      [],
      `OAuth clients must delegate requests to the bounded helper. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("OAuth API tools bind every request to the authenticated application user", async () => {
    const offenders: string[] = [];

    for (
      const [integration, factoryName] of Object.entries(
        OAUTH_CLIENT_INTEGRATIONS,
      )
    ) {
      const clientPath = new URL(
        `./integrations/${integration}/files/lib/${integration}-client.ts`,
        import.meta.url,
      );
      const client = await Deno.readTextFile(clientPath);

      if (client.includes('from "./token-store.ts"')) {
        offenders.push(`${integration}: imports the legacy token store`);
      }
      if (!client.includes('from "./oauth.ts"')) {
        offenders.push(
          `${integration}: does not use the hardened OAuth helper`,
        );
      }
      if (!client.includes(`export function ${factoryName}(userId: string)`)) {
        offenders.push(`${integration}: missing ${factoryName}(userId)`);
      }
      if (/getAccessToken\s*\(\s*\)/.test(client)) {
        offenders.push(`${integration}: calls a zero-argument token getter`);
      }

      const toolsDir = new URL(
        `./integrations/${integration}/files/tools/`,
        import.meta.url,
      );
      for (const toolFile of await collectTemplateTsFiles(toolsDir)) {
        const tool = await Deno.readTextFile(toolFile);
        const relativePath = toolFile.pathname.replace(toolsDir.pathname, "");
        if (!tool.includes("requireUserIdFromContext")) {
          offenders.push(
            `${integration}/${relativePath}: missing authenticated user resolver`,
          );
        }
        if (!tool.includes("requireUserIdFromContext(context)")) {
          offenders.push(
            `${integration}/${relativePath}: does not resolve context.userId`,
          );
        }
        if (!tool.includes(`${factoryName}(userId)`)) {
          offenders.push(
            `${integration}/${relativePath}: does not create a per-user client`,
          );
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `OAuth API clients and tools must be user-bound. Offenders: ${offenders.join(", ")}`,
    );
  });

  it("supported OAuth tools import shared libraries from their emitted location", async () => {
    const offenders: string[] = [];

    for (const integration of SUPPORTED_OAUTH_TOOL_INTEGRATIONS) {
      const toolsDir = new URL(
        `./integrations/${integration}/files/tools/`,
        import.meta.url,
      );
      for (const toolFile of await collectTemplateTsFiles(toolsDir)) {
        const source = await Deno.readTextFile(toolFile);
        const relativePath = toolFile.pathname.replace(toolsDir.pathname, "");
        if (source.includes('"../../lib/')) {
          offenders.push(
            `${integration}/${relativePath}: escapes the emitted project root`,
          );
        }
        if (!source.includes('"../lib/')) {
          offenders.push(
            `${integration}/${relativePath}: missing emitted lib import`,
          );
        }
        if (
          !source.includes("requireUserIdFromContext(context)") &&
          !source.includes("resolveUserId(context)")
        ) {
          offenders.push(
            `${integration}/${relativePath}: missing authenticated context user`,
          );
        }
        if (
          source.includes("DEFAULT_USER_ID") || source.includes("demo-user")
        ) {
          offenders.push(
            `${integration}/${relativePath}: contains a shared fallback user`,
          );
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `Generated OAuth tool imports must resolve from root tools/. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("gives every integration template tool a globally unique provider namespace", async () => {
    const integrationsRoot = new URL("./integrations/", import.meta.url);
    const seenToolIds = new Map<string, string>();

    for await (const integration of Deno.readDir(integrationsRoot)) {
      if (!integration.isDirectory || integration.name === "_base") continue;
      const toolsRoot = new URL(
        `./integrations/${integration.name}/files/tools/`,
        import.meta.url,
      );

      try {
        for await (const file of Deno.readDir(toolsRoot)) {
          if (!file.isFile || !file.name.endsWith(".ts")) continue;
          const source = await Deno.readTextFile(new URL(file.name, toolsRoot));
          const ids = [
            ...source.matchAll(/\bid:\s*(["'])([^"']+)\1/g),
          ].map((match) => match[2]!);
          assertEquals(
            ids.length > 0,
            true,
            `${integration.name}/${file.name} must declare a literal tool id`,
          );

          for (const id of ids) {
            assertEquals(
              id.startsWith(`${integration.name}-`),
              true,
              `${integration.name}/${file.name} must namespace tool id ${id}`,
            );
            assertEquals(
              /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id),
              true,
              `${integration.name}/${file.name} must use hyphenated lowercase tool id ${id}`,
            );
            assertEquals(
              seenToolIds.has(id),
              false,
              `${id} is also declared by ${seenToolIds.get(id)}`,
            );
            seenToolIds.set(id, `${integration.name}/${file.name}`);
          }
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }

    assertEquals(seenToolIds.size > 0, true);
  });

  it("keeps integration guidance aligned with generated local tool IDs", async () => {
    const integrationsRoot = new URL("./integrations/", import.meta.url);
    const offenders: string[] = [];
    const ignoredConnectorStringKeys = new Set([
      "docsUrl",
      "file",
      "icon",
      "id",
      "name",
      "url",
    ]);

    const collectConnectorGuidance = (
      value: unknown,
      key: string | null,
      output: string[],
    ): void => {
      if (typeof value === "string") {
        if (!key || !ignoredConnectorStringKeys.has(key)) output.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) collectConnectorGuidance(item, key, output);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [childKey, child] of Object.entries(value)) {
        collectConnectorGuidance(child, childKey, output);
      }
    };

    for await (const integration of Deno.readDir(integrationsRoot)) {
      if (!integration.isDirectory || integration.name === "_base") continue;
      const integrationRoot = new URL(
        `./integrations/${integration.name}/`,
        import.meta.url,
      );
      const toolsRoot = new URL("./files/tools/", integrationRoot);
      const legacyIds = new Set<string>();
      try {
        for await (const file of Deno.readDir(toolsRoot)) {
          if (!file.isFile || !file.name.endsWith(".ts")) continue;
          const source = await Deno.readTextFile(new URL(file.name, toolsRoot));
          for (const match of source.matchAll(/\bid:\s*(["'])([^"']+)\1/g)) {
            const id = match[2]!;
            const prefix = `${integration.name}-`;
            if (id.startsWith(prefix)) legacyIds.add(id.slice(prefix.length));
          }
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }

      const guidance: Array<{ source: string; content: string }> = [];
      for (const fileName of ["README.md", "INTEGRATION_SUMMARY.md"]) {
        try {
          guidance.push({
            source: `${integration.name}/${fileName}`,
            content: await Deno.readTextFile(new URL(fileName, integrationRoot)),
          });
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
      try {
        const connectorGuidance: string[] = [];
        collectConnectorGuidance(
          JSON.parse(
            await Deno.readTextFile(
              new URL("./connector.json", integrationRoot),
            ),
          ),
          null,
          connectorGuidance,
        );
        guidance.push({
          source: `${integration.name}/connector.json`,
          content: connectorGuidance.join("\n"),
        });
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }

      for (const legacyId of legacyIds) {
        const escapedId = legacyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(
          `(^|[^A-Za-z0-9-])${escapedId}($|[^A-Za-z0-9-])`,
        );
        for (const document of guidance) {
          const prose = document.content.replaceAll(`${legacyId}.ts`, "");
          if (pattern.test(prose)) {
            offenders.push(`${document.source}: ${legacyId}`);
          }
        }
      }
    }

    assertEquals(offenders, []);
  });

  it("Google Docs templates only request documented Google OAuth scopes", async () => {
    const invalidScope = "https://www.googleapis.com/auth/docs";
    const checkedFiles = [
      "./integrations/docs-google/connector.json",
      "./integrations/docs-google/files/lib/docs-client.ts",
    ];

    for (const path of checkedFiles) {
      const source = await Deno.readTextFile(new URL(path, import.meta.url));
      assertEquals(
        source.includes(invalidScope),
        false,
        `${path} contains a nonexistent scope`,
      );
    }
  });

  it("keeps supported OAuth connector scopes aligned with generated setup guidance", async () => {
    const expectedScopes = {
      drive: ["https://www.googleapis.com/auth/drive"],
      "docs-google": [
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
      github: ["repo", "read:user", "read:org"],
      gitlab: ["api", "read_user", "read_repository"],
      bitbucket: ["repository", "pullrequest:write", "issue", "account"],
      jira: [
        "read:jira-work",
        "write:jira-work",
        "read:jira-user",
        "offline_access",
      ],
      confluence: [
        "read:confluence-content.all",
        "write:confluence-content",
        "read:confluence-space.summary",
        "read:confluence-user",
        "search:confluence",
        "read:page:confluence",
        "write:page:confluence",
        "offline_access",
      ],
      sheets: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
      ],
      onedrive: [
        "Files.Read",
        "Files.ReadWrite",
        "Files.Read.All",
        "Files.ReadWrite.All",
        "offline_access",
      ],
      sharepoint: [
        "Sites.Read.All",
        "Sites.ReadWrite.All",
        "Files.Read.All",
        "Files.ReadWrite.All",
        "offline_access",
      ],
      outlook: [
        "Mail.Read",
        "Mail.Send",
        "Mail.ReadWrite",
        "Mail.Read.Shared",
        "Calendars.Read",
        "Calendars.ReadWrite",
        "Group.Read.All",
        "Group-Conversation.Read.All",
        "offline_access",
      ],
      teams: [
        "Chat.Read",
        "Chat.ReadWrite",
        "ChannelMessage.Send",
        "Channel.ReadBasic.All",
        "Team.ReadBasic.All",
        "offline_access",
      ],
    } as const;
    const setup = await Deno.readTextFile(
      new URL("./integrations/_base/files/SETUP.md", import.meta.url),
    );
    const setupPage = await Deno.readTextFile(
      new URL(
        "./integrations/_base/files/app/setup/page-helpers.tsx",
        import.meta.url,
      ),
    );

    for (const [integration, scopes] of Object.entries(expectedScopes)) {
      const connector = JSON.parse(
        await Deno.readTextFile(
          new URL(
            `./integrations/${integration}/connector.json`,
            import.meta.url,
          ),
        ),
      ) as { auth?: { scopes?: unknown } };
      assertEquals(
        connector.auth?.scopes,
        [...scopes],
        `${integration} connector scopes must match the generated contract`,
      );

      for (const scope of scopes) {
        assertEquals(
          setup.includes(scope),
          true,
          `SETUP.md must list ${integration} scope ${scope}`,
        );
        assertEquals(
          setupPage.includes(scope),
          true,
          `setup page must list ${integration} scope ${scope}`,
        );
      }
    }

    assertEquals(setup.includes("Enable **PKCE**"), true);
    assertEquals(
      setupPage.includes("Enable PKCE for the authorization flow (S256)"),
      true,
    );
    assertEquals(setup.includes("ChannelMessage.Read.All"), false);
    assertEquals(setupPage.includes("ChannelMessage.Read.All"), false);
    assertEquals(setup.includes("User.Read"), false);
    assertEquals(setupPage.includes("User.Read"), false);
    assertEquals(setup.includes("ATLASSIAN_CLOUD_ID"), false);
    for (const variableName of ["JIRA_CLOUD_ID", "CONFLUENCE_CLOUD_ID"]) {
      assertEquals(setup.includes(variableName), true);
      assertEquals(setupPage.includes(variableName), true);
    }
    for (
      const callbackPath of [
        "/api/auth/outlook/callback",
        "/api/auth/teams/callback",
        "/api/auth/sharepoint/callback",
        "/api/auth/onedrive/callback",
      ]
    ) {
      assertEquals(setup.includes(callbackPath), true);
    }
    assertEquals(setup.includes("/api/auth/atlassian/callback"), true);
    assertEquals(setupPage.includes("/api/auth/atlassian/callback"), true);
    for (
      const obsoleteCallbackPath of [
        "/api/auth/jira/callback",
        "/api/auth/confluence/callback",
      ]
    ) {
      assertEquals(setup.includes(obsoleteCallbackPath), false);
      assertEquals(setupPage.includes(obsoleteCallbackPath), false);
    }
    assertEquals(setup.includes("one shared Atlassian grant"), true);
    assertEquals(setup.includes("legacy `jira` and `confluence` token rows"), true);
    assertEquals(setup.includes("account-level"), true);
    assertEquals(setup.includes("resource-level"), true);
    assertEquals(setup.includes("does not expose a disconnect endpoint"), true);
    assertEquals(setup.includes("delete the shared `atlassian` token row"), true);
    assertEquals(setup.includes("`<integration>-<tool>`"), true);
    assertEquals(setup.includes("agent allowlists"), true);
    assertEquals(setup.includes("MICROSOFT_TENANT_ID"), false);
    assertEquals(setup.includes("/api/connections"), false);
    assertEquals(setup.includes("/api/integrations/status"), true);
  });

  it("omits Teams client methods that require scopes outside the generated contract", async () => {
    const client = await Deno.readTextFile(
      new URL("./integrations/teams/files/lib/teams-client.ts", import.meta.url),
    );
    const readme = await Deno.readTextFile(
      new URL("./integrations/teams/README.md", import.meta.url),
    );

    for (const unsupportedMethod of ["getChannelMessages", "getCurrentUser"]) {
      assertEquals(
        client.includes(unsupportedMethod),
        false,
        `Teams client must not expose ${unsupportedMethod} without its required OAuth scope`,
      );
      assertEquals(
        readme.includes(unsupportedMethod),
        false,
        `Teams README must not document ${unsupportedMethod} without its required OAuth scope`,
      );
    }
  });

  it("keeps every generated OAuth connector scope-exact with its runtime provider", async () => {
    for (
      const [integration, provider] of Object.entries(OAUTH_PROVIDER_CONFIGS)
    ) {
      const connector = JSON.parse(
        await Deno.readTextFile(
          new URL(
            `./integrations/${integration}/connector.json`,
            import.meta.url,
          ),
        ),
      ) as { auth?: { scopes?: unknown } };
      assertEquals(
        connector.auth?.scopes ?? [],
        [...provider.defaultScopes],
        `${integration} connector scopes must exactly match its OAuthService config`,
      );
    }
  });

  it("integration templates do not use a shared current-user token key", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const offenders: string[] = [];

    for (const file of await collectTemplateTsFiles(integrationTemplates)) {
      const source = await Deno.readTextFile(file);
      if (
        source.includes('"current-user"') || source.includes("'current-user'")
      ) {
        offenders.push(
          file.pathname.replace(integrationTemplates.pathname, ""),
        );
      }
    }

    assertEquals(
      offenders,
      [],
      `Integration templates must require a real user id. Offenders: ${offenders.join(", ")}`,
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
      const source = await Deno.readTextFile(
        new URL(filePath, import.meta.url),
      );
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

    const manifest = await Deno.readTextFile(
      new URL("./manifest.json", import.meta.url),
    );
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
