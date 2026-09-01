import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { basename } from "#veryfront/compat/path";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  getCacheBaseDir,
  getHttpBundleCacheDir,
  getMdxEsmCacheDir,
} from "#veryfront/utils/cache-dir.ts";
import { MINIMUM_DENO_VERSION, MINIMUM_NODE_VERSION } from "../../scripts/build/runtime-support.ts";

const repoRoot = new URL("../../", import.meta.url);

describe("guide content contracts", () => {
  it("states installation sizes and local inference boundaries", async () => {
    const readme = await Deno.readTextFile(new URL("README.md", repoRoot));
    const installation = await Deno.readTextFile(
      new URL("docs/getting-started/installation.md", repoRoot),
    );
    const providers = await Deno.readTextFile(
      new URL("docs/guides/providers.md", repoRoot),
    );

    assertStringIncludes(readme, "npm install -g veryfront@latest");
    assert(
      readme.indexOf("npm install -g veryfront@latest") <
        readme.indexOf("https://veryfront.com/install.sh"),
      "the recommended npm installation must appear before the standalone binary",
    );
    assertStringIncludes(installation, "0.9 to 1.2 GB");
    assertStringIncludes(installation, "Model weights are not included");
    assertStringIncludes(providers, "Embedded ONNX inference");
    assertStringIncludes(providers, "npm install @huggingface/transformers");
    assertStringIncludes(providers, "not available from compiled standalone binaries");
    assertStringIncludes(
      providers,
      "For local chat development, use Ollama or LM Studio",
    );
    assertEquals(
      providers.includes("src/provider/local/_smoke-test.ts"),
      false,
    );
  });

  it("only tells workflow readers to call routes the same guide creates", async () => {
    // A guide that curls an endpoint it never builds is unrunnable end to end,
    // and the reader cannot tell the missing route from their own mistake. The
    // framework serves no /api/workflows/** handler, so every localhost path
    // this guide calls has to come from a route file the guide itself shows.
    const guide = await Deno.readTextFile(
      new URL("docs/guides/workflows.md", repoRoot),
    );

    const toSegments = (path: string) =>
      path.split("/").filter(Boolean).map((segment) =>
        segment.startsWith("$") || segment.startsWith("[") ? "*" : segment
      );

    const created = [...guide.matchAll(/(?:app\/api\/[^\s"'`]*?)\/route\.ts/g)]
      .map((match) => toSegments((match[0] ?? "").replace(/^app/, "").replace(/\/route\.ts$/, "")));

    const called = [...guide.matchAll(/http:\/\/localhost:\d+(\/api\/[^\s"'`)]*)/g)]
      .map((match) => match[1] ?? "");

    assert(called.length > 0, "expected the guide to show at least one API call");
    assertStringIncludes(
      guide,
      "await handle.settled();",
      "the verification route must still return failed and cancelled run state for inspection",
    );

    for (const path of called) {
      const wanted = toSegments(path);
      const served = created.some((route) =>
        route.length === wanted.length &&
        route.every((segment, index) =>
          segment === "*" || wanted[index] === "*" || segment === wanted[index]
        )
      );
      assert(
        served,
        `docs/guides/workflows.md calls ${path} but never shows the route that serves it. ` +
          `Routes the guide creates: ${
            created.map((route) => "/" + route.join("/")).join(", ") || "(none)"
          }`,
      );
    }

    const mutatingCurlBlocks = [...guide.matchAll(/```bash\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? "")
      .filter((block) => block.includes("curl ") && block.includes(" -d "));
    assert(mutatingCurlBlocks.length > 0, "expected the guide to show a mutating curl call");
    for (const block of mutatingCurlBlocks) {
      assertStringIncludes(block, "Cookie: __Host-vf_csrf=local-check");
      assertStringIncludes(block, "x-csrf-token: local-check");
    }
  });

  it("requires server-verified authentication for the workflow handler example", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/guides/workflows-advanced.md", repoRoot),
    );

    assertStringIncludes(
      guide,
      "Its `getSession(request)` function must verify",
    );
    assertStringIncludes(guide, "a signed, HttpOnly, same-origin session cookie");
    assertStringIncludes(
      guide,
      "Do not decode an unsigned cookie or",
    );
  });

  it("documents the complete cross-origin workflow hook CORS surface", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/guides/workflows-advanced.md", repoRoot),
    );

    assertStringIncludes(guide, "export function OPTIONS(request: Request): Response");
    assertStringIncludes(guide, '"Access-Control-Allow-Origin": applicationOrigin');
    assertStringIncludes(guide, '"Access-Control-Allow-Credentials": "true"');
    assertStringIncludes(guide, '"Access-Control-Allow-Methods": "GET, POST, OPTIONS"');
    assertStringIncludes(
      guide,
      '"Access-Control-Allow-Headers": "Authorization, Content-Type, X-CSRF-Token"',
    );
    assertStringIncludes(guide, "return cors(request, await handlers.GET(request));");
    assertStringIncludes(guide, "return cors(request, await handlers.POST(request));");
  });

  it("requires a worker drain and a long-lived Redis retention backend", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/guides/workflows.md", repoRoot),
    );

    assertStringIncludes(guide, "stop every workflow worker");
    assertStringIncludes(guide, "Repeat this drain if you replace the maintenance backend");
    assertStringIncludes(guide, "running it beside active workers can duplicate their work");
    assertStringIncludes(guide, "async function runScheduler(): Promise<never>");
    assertStringIncludes(guide, "await runSweep();");
    assertStringIncludes(guide, "await runScheduler();");
    assertStringIncludes(guide, "every scheduled sweep reuses");
  });

  it("describes the server-bound workflow approval identity", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/guides/workflows.md", repoRoot),
    );

    assertStringIncludes(guide, "The body-level `approver`");
    assertStringIncludes(guide, "is compatibility input, not an identity claim");
    assertStringIncludes(guide, "server-derived identity is what the workflow context persists");
  });

  it("keeps the workflow EventSource example terminal-safe and wire-accurate", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/guides/workflows-advanced.md", repoRoot),
    );

    assertStringIncludes(
      guide,
      'const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);',
    );
    assertStringIncludes(
      guide,
      "if (TERMINAL_RUN_STATUSES.has(run.status)) events.close();",
    );
    assertStringIncludes(
      guide,
      `if (event.type === "run.status" && TERMINAL_RUN_STATUSES.has(event.status)) {
        events.close();
      }`,
    );
    assertStringIncludes(
      guide,
      `if (event instanceof MessageEvent) {
      console.error(JSON.parse(event.data));
      events.close();
    }`,
    );
    assertStringIncludes(guide, "Native `EventSource` reconnects automatically");

    for (
      const type of [
        "step.started",
        "step.completed",
        "step.failed",
        "step.skipped",
        "run.status",
      ]
    ) {
      assertStringIncludes(
        guide,
        `\`{ type: "${type}"`,
        `the ${type} wire shape must include its type discriminator`,
      );
    }
  });

  it("presents open source, self-hosted, and managed paths as first-class options", async () => {
    const overview = await Deno.readTextFile(
      new URL("docs/getting-started/index.md", repoRoot),
    );
    const selfHostingGuide = await Deno.readTextFile(
      new URL("docs/guides/self-hosting.md", repoRoot),
    );

    assertStringIncludes(overview, "Apache-2.0 open-source framework");
    assertStringIncludes(overview, "does not require a Veryfront account");
    assertStringIncludes(overview, "Build and evaluate locally");
    assertStringIncludes(overview, "Self-host");
    assertStringIncludes(overview, "Veryfront Cloud");
    assertStringIncludes(overview, "[Local quickstart](./quickstart.md)");
    assertStringIncludes(overview, "[Cloud quickstart](./cloud-quickstart.md)");
    assertStringIncludes(overview, "[Self-host](../guides/self-hosting.md)");
    assertStringIncludes(selfHostingGuide, "does not require a Veryfront account");
    assertEquals(selfHostingGuide.includes("veryfront login"), false);
  });

  it("keeps the quickstart local and account-free", async () => {
    const quickstart = await Deno.readTextFile(
      new URL("docs/getting-started/quickstart.md", repoRoot),
    );

    assertStringIncludes(
      quickstart,
      "does not require a Veryfront account or Veryfront Cloud",
    );
    assertStringIncludes(quickstart, "An OpenAI API key for model inference");
    assertStringIncludes(quickstart, 'export OPENAI_API_KEY="<API_KEY>"');
    assertStringIncludes(quickstart, "npm run eval -- assistant");
    assertStringIncludes(
      quickstart,
      "[Self-host the app](../guides/self-hosting.md)",
    );
    assertStringIncludes(
      quickstart,
      "[Use another inference provider](../guides/providers.md)",
    );
    assertEquals(quickstart.includes("veryfront login"), false);
    assertEquals(quickstart.includes("veryfront push"), false);
    assertEquals(quickstart.includes("veryfront deploy"), false);
    assertEquals(quickstart.includes("PORT=3001"), false);
    assertEquals(quickstart.includes("development MCP server"), false);
    assertEquals(quickstart.includes("interactive setup wizard"), false);

    const providerGuide = await Deno.readTextFile(
      new URL("docs/guides/providers.md", repoRoot),
    );
    assertStringIncludes(providerGuide, "### Ollama");
    assertStringIncludes(providerGuide, "### LM Studio");
    assertStringIncludes(providerGuide, "VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS");
    assertStringIncludes(providerGuide, "Other internal destinations");
    assertEquals(providerGuide.includes("VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS=1"), false);
    assertStringIncludes(providerGuide, 'OPENAI_BASE_URL="http://localhost:11434/v1"');
    assertStringIncludes(
      providerGuide,
      'VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS="http://localhost:11434"',
    );
    assertStringIncludes(providerGuide, 'agent({ model: "openai/qwen3:1.7b" })');
    assertStringIncludes(providerGuide, 'OPENAI_BASE_URL="http://localhost:1234/v1"');
    assertStringIncludes(
      providerGuide,
      'VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS="http://localhost:1234"',
    );
    assertStringIncludes(
      providerGuide,
      `agent({
  model: "openai/qwen2.5-7b-instruct",
  system: "You are a helpful local assistant.",
});`,
    );
  });

  it("shows account-free local multi-agent delegation", async () => {
    const quickstart = await Deno.readTextFile(
      new URL("docs/getting-started/quickstart.md", repoRoot),
    );
    const multiAgentGuide = await Deno.readTextFile(
      new URL("docs/guides/multi-agent.md", repoRoot),
    );

    assertStringIncludes(quickstart, "## Add local delegation");
    assertStringIncludes(quickstart, "// agents/researcher.ts");
    assertStringIncludes(quickstart, "// agents/writer.ts");
    assertStringIncludes(quickstart, 'delegates: ["researcher", "writer"]');
    assertStringIncludes(quickstart, "`agent_researcher`");
    assertStringIncludes(quickstart, "`agent_writer`");
    assertStringIncludes(quickstart, "runs in the same Veryfront process");
    assertStringIncludes(quickstart, "If the development server is still running");
    assertEquals(quickstart.includes("tools: { invoke_agent: true }"), false);

    assertStringIncludes(
      multiAgentGuide,
      "Direct local delegation does not require a Veryfront account",
    );
    assertStringIncludes(multiAgentGuide, "runs the delegates in-process");
  });

  it("keeps the Cloud quickstart on one gateway-to-deployment path", async () => {
    const quickstart = await Deno.readTextFile(
      new URL("docs/getting-started/cloud-quickstart.md", repoRoot),
    );

    for (
      const step of [
        "npm create veryfront@latest support-agent -- --template ai-agent",
        "npx veryfront@latest login",
        "npx veryfront@latest push",
        "npm run dev",
        "npm run eval -- assistant",
        "npx veryfront@latest deploy --env production",
      ]
    ) {
      assertStringIncludes(quickstart, step);
    }
    assertStringIncludes(quickstart, "Veryfront Cloud AI Gateway");
    assertStringIncludes(quickstart, "protected by default");
    assertStringIncludes(quickstart, "## Verify it worked");

    for (
      const referenceDetail of [
        "`authToken` cookie",
        "redirect_url",
        "Project reference precedence",
        "--prune",
        "last verified Push receipt",
      ]
    ) {
      assertEquals(
        quickstart.includes(referenceDetail),
        false,
        `Cloud tutorial must link to reference material instead of including ${referenceDetail}`,
      );
    }
  });

  it("keeps the first Cloud deployment guide focused on the task", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/getting-started/deploy-project.md", repoRoot),
    );

    assertStringIncludes(guide, "npx veryfront@latest push");
    assertStringIncludes(guide, "npx veryfront@latest deploy --env production");
    assertStringIncludes(guide, "protected by default");
    assertStringIncludes(guide, "../guides/deploying.md");
    assertEquals(guide.includes("`authToken` cookie"), false);
    assertEquals(guide.includes("Project reference precedence"), false);
    assertEquals(guide.includes("skips the browser readiness probe"), false);
  });

  it("keeps self-hosting independent from Veryfront Cloud", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/guides/self-hosting.md", repoRoot),
    );

    assertStringIncludes(guide, "does not require a Veryfront account");
    assertStringIncludes(guide, "veryfront build");
    assertStringIncludes(guide, "veryfront serve");
    assertStringIncludes(guide, "ship the whole project directory, not just `dist/`");
    assertStringIncludes(guide, "## Verify it worked");
    assertEquals(guide.includes("veryfront login"), false);
    assertEquals(guide.includes("veryfront deploy"), false);
  });

  it("documents self-hosting boundaries and a Kubernetes deployment", async () => {
    const guide = await Deno.readTextFile(
      new URL("docs/guides/self-hosting.md", repoRoot),
    );

    assertStringIncludes(guide, "## Check capability support");
    assertStringIncludes(guide, "Direct provider inference");
    assertStringIncludes(guide, "Local agent delegation with `delegates`");
    assertStringIncludes(guide, "Integration tools");
    assertStringIncludes(guide, "Salesforce service account");
    assertStringIncludes(guide, "External Client App");
    assertStringIncludes(guide, "createSalesforceServiceAccountToolSource");
    assertStringIncludes(guide, "loadRemoteToolsFromSource");
    assertStringIncludes(guide, "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID");
    assertStringIncludes(guide, "tools: salesforceTools");
    assertStringIncludes(guide, "Credentials stay in the local runtime process");
    assertEquals(guide.includes("remoteTools:"), false);
    assertEquals(
      guide.includes(
        "Managed Salesforce and other remote tools have no standalone credential path",
      ),
      false,
    );
    assertStringIncludes(guide, "## Deploy to Kubernetes");
    assertStringIncludes(guide, "kubectl create namespace veryfront-app");
    assertStringIncludes(guide, "kubectl create secret generic provider-credentials");
    assertStringIncludes(guide, "--from-env-file=.env");
    assertStringIncludes(guide, "--dry-run=client -o yaml | kubectl apply -f -");
    assertStringIncludes(guide, "Replace `<API_KEY>`");
    assertStringIncludes(guide, "apiVersion: apps/v1");
    assertStringIncludes(guide, "kind: Deployment");
    assertStringIncludes(guide, "startupProbe:");
    assertStringIncludes(guide, "tcpSocket:");
    assertStringIncludes(guide, "kubectl apply -f k8s.yaml");
    assertStringIncludes(guide, "rollout restart deployment/veryfront-app");
    assertStringIncludes(
      guide,
      "kubectl -n veryfront-app port-forward service/veryfront-app 3000:80",
    );
  });

  it("documents the current knowledge ingest JSON result shape", async () => {
    const guide = await Deno.readTextFile(
      "docs/guides/cli-knowledge-ingestion.md",
    );

    assertStringIncludes(guide, '"kind": "knowledge_ingest"');
    assertStringIncludes(guide, '"ingested": [');
    assertStringIncludes(guide, "jq '.ingested'");
    assertEquals(guide.includes(".knowledgeFiles"), false);
  });

  it("uses the public TokenStore method in OAuth verification", async () => {
    const guide = await Deno.readTextFile("docs/guides/oauth.md");

    assertStringIncludes(
      guide,
      "tokenStore.getTokens(githubConfig.serviceId, userId)",
    );
    assertEquals(
      guide.includes("tokenStore.get(userId, githubConfig.id)"),
      false,
    );
  });

  it("documents feature-gated integrations without describing them as removed", async () => {
    const docs = [
      await Deno.readTextFile("docs/guides/integrations.md"),
      await Deno.readTextFile("docs/guides/oauth.md"),
      await Deno.readTextFile("docs/api-reference/veryfront/oauth.md"),
    ].join("\n");

    assertStringIncludes(docs, "VERYFRONT_EXPERIMENTAL_INTEGRATIONS");
    assertStringIncludes(docs, "feature-gated integrations");
    assertStringIncludes(docs, "salesforceConfig");
    assertStringIncludes(docs, "Salesforce");

    assertEquals(docs.includes("removed OAuth provider exports"), false);
  });

  it("documents source narrowing without conflating it with activation or credentials", async () => {
    const guide = await Deno.readTextFile("docs/guides/integrations.md");

    assertStringIncludes(guide, "agent source");
    assertStringIncludes(guide, "integrations.allow");
    assertStringIncludes(guide, "source-qualified and monotonic");
    assertStringIncludes(guide, "Project integration policy");
    assertStringIncludes(guide, "Connection inventory");
    assertStringIncludes(guide, "Managed OAuth");
    assertStringIncludes(guide, "cannot\nenable an integration");
    assertStringIncludes(guide, "`scope`, `perUser`, and\n`tools` fields are rejected");
  });

  it("documents account-free local integration credentials without weakening grants", async () => {
    const integrations = await Deno.readTextFile(
      new URL("docs/guides/integrations.md", repoRoot),
    );
    const salesforce = await Deno.readTextFile(
      new URL("docs/guides/integrations/salesforce.md", repoRoot),
    );
    const selfHosting = await Deno.readTextFile(
      new URL("docs/guides/self-hosting.md", repoRoot),
    );
    const docs = [integrations, salesforce, selfHosting].join("\n");

    assertStringIncludes(docs, "createLocalIntegrationToolSource");
    assertStringIncludes(docs, "loadRemoteToolsFromSource");
    assertStringIncludes(docs, "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID");
    assertStringIncludes(docs, "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET");
    assertStringIncludes(docs, "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL");
    assertStringIncludes(integrations, "integrations.allow only narrows");
    assertStringIncludes(integrations, "never sends local credentials to Veryfront");
    assertStringIncludes(integrations, "authorization-code OAuth");
    assertStringIncludes(integrations, "query-string credentials");
    assertEquals(selfHosting.includes("have no standalone credential path"), false);
  });

  it("documents fail-closed extension activation modes", async () => {
    const guide = await Deno.readTextFile(
      "docs/guides/extension-authoring.md",
    );

    assertStringIncludes(guide, "`veryfront.activation`");
    assertStringIncludes(guide, '`"auto"` or `"explicit"`');
    assertStringIncludes(guide, "ignores the installed package until");
    assertStringIncludes(guide, 'legacy `"auto"`\nbehavior');
    assertStringIncludes(guide, "malformed activation metadata fails closed");
  });

  it("does not document caller-provided endUserId as tool context authority", async () => {
    const guide = await Deno.readTextFile("docs/guides/tools.md");

    assertEquals(guide.includes("context?.endUserId"), false);
    assertEquals(guide.includes('endUserId: "user-123"'), false);
    assertEquals(
      guide.includes("End-user identity for per-user token resolution"),
      false,
    );
  });

  it("documents deferred form and provider-native tool discovery", async () => {
    const agentsGuide = await Deno.readTextFile("docs/guides/agents.md");
    const toolsGuide = await Deno.readTextFile("docs/guides/tools.md");
    const architecture = await Deno.readTextFile(
      "docs/architecture/28-model-driven-tool-discovery.md",
    );
    const docs = [agentsGuide, toolsGuide, architecture].join("\n");

    assertStringIncludes(toolsGuide, "`form_input` is authorized but deferred");
    assertStringIncludes(docs, "configured `providerTools`");
    assertStringIncludes(docs, "provider's native schema on the next model step");
    assertEquals(docs.includes("does not search or load provider-native `providerTools`"), false);
    assertEquals(docs.includes("does not search `providerTools`"), false);
    assertEquals(docs.includes("bootstrap tools (`form_input`"), false);
  });

  it("documents the exact-run writer capability migration", async () => {
    const guide = await Deno.readTextFile(
      "docs/guides/agent-service-runtime.md",
    );
    const reference = await Deno.readTextFile(
      "docs/api-reference/veryfront/agent.md",
    );

    assertStringIncludes(guide, "## Migrate custom durable child event writers");
    assertStringIncludes(guide, "createHostedRunEventWriterCapability");
    assertStringIncludes(guide, "mintChildRunEventWriterCapability");
    assertStringIncludes(guide, "runEventWriterCapability: childWriter");
    assertStringIncludes(guide, "fails before\nprovider dispatch");
    assertStringIncludes(guide, "must not retry by falling back to a user API token");
    for (
      const contract of [
        "ParsedHostedChatRequest",
        "PrepareHostedConversationRootRunContextInput",
        "ExecuteHostedDurableChildForkInput",
        "DefaultHostedInvokeAgentToolOptions",
        "ExecuteHostedChildForkWithPreparedToolsInput",
        "ExecuteHostedChildForkToolInputOptions",
        "HostedDurableChildForkRunContextInput",
        "HostedDurableRunStartExecutionInput",
        "HostedAgentServiceDetachedExecutionInput",
      ]
    ) {
      assertStringIncludes(guide, `\`${contract}\``);
    }
    assertStringIncludes(reference, "`HostedRunEventWriterCapability`");
    assertStringIncludes(reference, "`createHostedRunEventWriterCapability`");
    assertStringIncludes(
      reference,
      "hostedRunEventWriterCapability.mintChildRunEventWriterCapability",
    );
    assertStringIncludes(reference, "### `ExecuteHostedDurableChildForkInput`");
    assertStringIncludes(reference, "### `HostedDurableRunStartExecutionInput`");
    assertStringIncludes(reference, "### `HostedAgentServiceDetachedExecutionInput`");
  });

  it("keeps privileged MCP transport limited to deployment-owned exact endpoints", async () => {
    const guide = await Deno.readTextFile(
      "docs/guides/agent-service-runtime.md",
    );
    const reference = await Deno.readTextFile(
      "docs/api-reference/veryfront/tool.md",
    );

    assertStringIncludes(guide, "exact allowed endpoints once at startup");
    assertStringIncludes(guide, "createRemoteMCPToolSourceFactoryWithTransport");
    assertStringIncludes(guide, "trustedEndpoints:");
    assertStringIncludes(guide, "requestFetch: hostFetch");
    assertStringIncludes(guide, "exact normalized URL match");
    assertStringIncludes(guide, "resolver-based endpoints retain guarded");
    assertStringIncludes(guide, "Never put a callback endpoint");
    assertStringIncludes(
      reference,
      "`createRemoteMCPToolSourceFactoryWithTransport`",
    );
  });

  it("documents deploy URL output for the first deploy path", async () => {
    const guide = await Deno.readTextFile("docs/guides/deploying.md");

    assertStringIncludes(guide, "prints the environment URL");
    assertStringIncludes(guide, "npx veryfront@latest open");
  });

  it("documents a CLI teardown path for cloud projects", async () => {
    // `veryfront push` creates a billable cloud project, so the docs must show
    // how to remove one without driving the Studio UI.
    const guide = await Deno.readTextFile(
      new URL("../../docs/guides/deploying.md", import.meta.url),
    );

    assertStringIncludes(guide, "veryfront project delete");
    assertStringIncludes(guide, "Tear a project down");
  });

  it("points post-deploy verification at the environment URL, not at open", async () => {
    // `veryfront open` builds Cloud dashboard URLs
    // (https://veryfront.com/projects/<slug>[/environments/<env>]). It never
    // resolves the deployed site, so the deploy docs must not send readers to
    // it to confirm the deployment responds.
    const docs = [
      "docs/getting-started/deploy-project.md",
      "docs/guides/deploying.md",
    ];

    for (const path of docs) {
      const text = await Deno.readTextFile(path);

      assertStringIncludes(text, "open` opens the project in the Cloud dashboard");
      assertEquals(text.includes("open` opens the deployed"), false);
    }

    const gettingStarted = await Deno.readTextFile(
      "docs/getting-started/deploy-project.md",
    );
    assertStringIncludes(gettingStarted, "Deploy prints the environment URL");
    assertEquals(
      gettingStarted.includes("The deployed page and API routes respond."),
      false,
    );
  });

  it("tells the reader a Cloud environment is protected before asking for a request", async () => {
    // Veryfront Cloud environments are protected by default: an anonymous
    // request to the environment URL gets a 302 to a Veryfront sign-in page on
    // every path, API routes included, and an API key in VERYFRONT_API_TOKEN
    // does not change that (the browser-is-the-only-client half of this is
    // wrong and is owned by the authToken case below). A signed-in non-member
    // gets a 403 instead, per
    // checkProtectedProxyAccess in src/proxy/proxy-access-control.ts. Which
    // apex serves that sign-in page varies by deployment host — see the
    // sign-in-apex case below, which owns that half. Verified against a live
    // protected environment on published 0.1.1229:
    //   curl -s -o /dev/null -w '%{http_code} %{redirect_url}' \
    //     https://<project>.production.veryfront.com/api/health
    //   -> 302 https://veryfront.com/sign-in?from=...
    // A verification step written as a bare `curl -sSf <environment-url>`
    // therefore exits 0 with an empty body whether or not the deployment
    // works, so the page has to name the redirect and print the status code.
    // Resolved from the module, not the process cwd: test files share one
    // process under --parallel and src/testing/cwd.ts chdirs it.
    const doc = await Deno.readTextFile(
      new URL("../../docs/guides/cloud-environment-access.md", import.meta.url),
    );
    const prose = doc.replace(/\s+/g, " ");

    assertStringIncludes(prose, "protected by default");
    assertStringIncludes(prose, "https://veryfront.com/sign-in");
    assertStringIncludes(prose, "Public Environment");
    assertStringIncludes(prose, "not a member of the project gets a `403`");
    assertStringIncludes(doc, "-w '%{http_code} %{redirect_url}\\n'");
    assertEquals(doc.includes("```bash\ncurl -sSf <environment-url>\n```"), false);
  });

  it("does not present a browser as the only client a protected environment serves", async () => {
    // The gate reads the session out of an `authToken` cookie
    // (extractUserToken, src/proxy/proxy-token-resolution.ts:52) and never
    // inspects the client, so any HTTP client sending that cookie is served.
    // `veryfront deploy` depends on exactly that: its readiness probe sets
    // `Cookie: authToken=<token>` when the stored credential is a session token
    // (cli/shared/deployment/deploy-project.ts:969, asserted at
    // cli/shared/deployment/deploy-project.test.ts:653) and withholds an opaque
    // API key instead, because extractUserIdFromToken resolves no userId from
    // one (src/proxy/proxy-access-control.ts:104) and the gate then answers the
    // same 302 an anonymous request gets. The API-key-versus-session
    // distinction is the real axis, not browser versus non-browser: prose that
    // says every non-browser request sees the redirect sends a reader to make
    // an environment public when an authenticated probe would have worked.
    const doc = await Deno.readTextFile(
      new URL("../../docs/guides/cloud-environment-access.md", import.meta.url),
    );
    const prose = doc.replace(/\s+/g, " ");

    assertStringIncludes(prose, "A non-browser client can still authenticate");
    assertStringIncludes(prose, "`authToken` cookie");
    assertEquals(prose.includes("sees the sign-in redirect either way"), false);

    assertEquals(
      prose.includes("serves requests only to a browser signed in"),
      false,
    );
  });

  it("does not promise one sign-in apex for every protected environment", async () => {
    // buildProxyAuthRedirectUrl picks the sign-in apex from the host the
    // request arrived on (src/proxy/proxy-access-control.ts:202, via
    // resolveSignInApex at :187). A preview host on *.preview.veryfront.org is
    // sent to https://veryfront.org/sign-in, not .com — asserted at
    // src/proxy/proxy-access-control.test.ts:102. Stating a single apex sends a
    // reader to sign in on a domain whose cookie the deployment host never
    // receives, so the redirect loop never closes.
    //
    // Structural, not a keyword check: it collects every sign-in URL the page
    // prints and requires both apexes to appear. Prose that names only
    // veryfront.com cannot satisfy it, which is exactly the defect. A plain
    // `assertStringIncludes(prose, "https://veryfront.com/sign-in")` passes on
    // the broken page and so cannot stand in for this.
    const doc = await Deno.readTextFile(
      new URL("../../docs/guides/cloud-environment-access.md", import.meta.url),
    );
    const prose = doc.replace(/\s+/g, " ");

    const signInApexes = new Set(
      [...doc.matchAll(/https:\/\/(veryfront\.(?:com|org))\/sign-in/g)].map((match) => match[1]),
    );
    assertEquals(signInApexes.has("veryfront.com"), true);
    assertEquals(signInApexes.has("veryfront.org"), true);

    // The page has to say the apex varies and name the host class that varies,
    // so the reader knows to read the redirect rather than memorize one URL.
    assertStringIncludes(prose, "depends on the host serving the environment");
    assertStringIncludes(prose, "`*.preview.veryfront.org`");

    // The two sentences that previously asserted a universal .com apex.
    assertEquals(
      prose.includes("request gets a `302` to `https://veryfront.com/sign-in`"),
      false,
    );
    assertEquals(
      prose.includes("answers `302` to `https://veryfront.com/sign-in`"),
      false,
    );
  });

  it("does not require a 200 from the environment root to call a deploy verified", async () => {
    // Deployment selects a readiness route only from static page routes and
    // leaves it null when the project has none
    // (cli/shared/deployment/deploy-project.ts:1293), and
    // buildEnvironmentReadinessProbes returns zero probes for a null route
    // (:875) — so an API-only deployment is verified without any page ever
    // answering 200, as asserted at
    // cli/shared/deployment/deploy-project.test.ts:635. A page that presents
    // 200 at <environment-url> as the universal success signal tells the owner
    // of such a project their working deployment failed.
    const accessGuide = await Deno.readTextFile(
      new URL("../../docs/guides/cloud-environment-access.md", import.meta.url),
    );
    const accessProse = accessGuide.replace(/\s+/g, " ");
    const deploymentGuide = await Deno.readTextFile(
      new URL("../../docs/guides/deploying.md", import.meta.url),
    );
    const deploymentProse = deploymentGuide.replace(/\s+/g, " ");

    // Structural: the verification command must carry a route placeholder. A
    // command ending at the bare environment URL is the defect itself, so
    // pinning the command shape is what makes this test able to fail.
    assertStringIncludes(
      accessGuide,
      "-w '%{http_code} %{redirect_url}\\n' \\\n  <environment-url>/<route>",
    );
    assertEquals(
      accessGuide.includes("-w '%{http_code} %{redirect_url}\\n' <environment-url>\n"),
      false,
    );

    // And the prose must tell the reader to validate that route's own status
    // rather than a blanket 200.
    assertStringIncludes(accessProse, "probe a route the project serves");
    assertStringIncludes(accessProse, "Validate the status that route normally returns");
    assertStringIncludes(deploymentProse, "skips the browser readiness probe");
    assertEquals(accessProse.includes("A public environment answers `200`."), false);
  });

  it("offers open --site as the way back to the deployed environment URL", async () => {
    // The deploy docs tell readers to use the URL Deploy printed. A reader who
    // did not record it needs a command that reproduces it, so both deploy
    // pages must name `open --site` alongside the dashboard-only `open`.
    for (
      const path of [
        "docs/getting-started/deploy-project.md",
        "docs/guides/deploying.md",
      ]
    ) {
      const text = await Deno.readTextFile(path);
      assertStringIncludes(text, "open --site");
    }
  });

  it("uses serve for local production builds", async () => {
    const docs = [
      "docs/guides/deploying.md",
      "docs/guides/self-hosting.md",
    ];

    for (const path of docs) {
      const text = await Deno.readTextFile(path);

      assertStringIncludes(text, "veryfront serve");
      assertEquals(text.includes("veryfront start"), false);
    }
  });

  it("does not present dist/ as a self-contained self-hosted deployment", async () => {
    const doc = await Deno.readTextFile(
      new URL("docs/guides/self-hosting.md", repoRoot),
    );
    const prose = doc.replace(/\s+/g, " ");

    // `veryfront build` emits browser assets only. API routes, agents,
    // workflows, and tasks are served from the project source by
    // `veryfront serve`, so a host that receives `dist/` alone answers pages
    // and 404s every API route.
    assertEquals(prose.includes("ship the `dist/` output"), false);
    assertStringIncludes(prose, "browser assets to `dist/`");
    assertStringIncludes(
      prose,
      "ship the whole project directory, not just `dist/`",
    );
    assertStringIncludes(
      prose,
      "veryfront serve",
    );
  });

  it("does not offer the build output as a self-hosting target", async () => {
    // The sibling guide is what the Getting Started page links to for a
    // non-Cloud target, so it has to carry the same model: the host runs
    // `veryfront serve` over the project, it does not serve `dist/` alone.
    const guide = await Deno.readTextFile(
      new URL("docs/guides/self-hosting.md", repoRoot),
    );
    const prose = guide.replace(/\s+/g, " ");

    assertEquals(prose.includes("can serve the build output"), false);
    assertEquals(prose.includes("use the build output or a container"), false);
    assertStringIncludes(
      prose,
      "ship the whole project directory, not just `dist/`",
    );
    assertStringIncludes(
      prose,
      "veryfront serve",
    );
  });

  it("documents single-command Deploy for interactive Veryfront Cloud paths", async () => {
    const docs = [
      "docs/getting-started/deploy-project.md",
      "docs/guides/deploying.md",
    ];
    const deploy = "npx veryfront@latest deploy";

    for (const path of docs) {
      const text = await Deno.readTextFile(path);

      assertStringIncludes(text, deploy);
      assertEquals(text.includes("npx veryfront deploy"), false);
      assertStringIncludes(text, "prints the environment URL");
    }

    const behaviorGuide = await Deno.readTextFile("docs/guides/deploying.md");
    assertStringIncludes(behaviorGuide, "It does not write `veryfront.json`");
    assertStringIncludes(behaviorGuide, "last verified Push receipt");
  });

  it("keeps the CI deploy workflow on explicit Push before Deploy", async () => {
    const guide = await Deno.readTextFile("docs/guides/deploy-from-ci.md");
    const push = "veryfront push --branch main --prune --force --yes";
    const deploy = "veryfront deploy --branch main --env production --yes";
    const pushIndex = guide.indexOf(push);
    const deployIndex = guide.indexOf(deploy);

    assert(pushIndex >= 0, "CI guide must document the canonical Push command");
    assert(deployIndex > pushIndex, "CI guide must document Deploy after Push");
  });

  it("keeps the CI workflow serialized, auditable, and rollback-safe", async () => {
    const guide = await Deno.readTextFile("docs/guides/deploy-from-ci.md");

    assertStringIncludes(guide, "same Git checkout and CI job");
    assertStringIncludes(guide, "cancel-in-progress: false");
    assertStringIncludes(
      guide,
      "repository access and deployment credentials inside",
    );
    assertStringIncludes(guide, "similar to a GitOps workflow");
    assertStringIncludes(guide, "Skipping superseded main commit");
    assertStringIncludes(guide, "working-directory: apps/storefront");
    assertStringIncludes(guide, ".veryfront/` in `.gitignore");
    assertStringIncludes(guide, "commit it to Git");
    assertStringIncludes(guide, "RUNNER_TEMP");
    assertStringIncludes(guide, "NDJSON records");
    assertStringIncludes(guide, "git revert");
    assertStringIncludes(guide, "Start with staging");
    assertStringIncludes(guide, "veryfront push --branch main --prune --force --dry-run");
    assertStringIncludes(guide, "intentional overwrite authority");
    assertStringIncludes(guide, "preserves remote-only files");
    assertStringIncludes(guide, "does not create a missing project or branch");
    assertStringIncludes(guide, "veryfront deploy --branch main --env staging --yes");
    assertStringIncludes(guide, "veryfront open --env staging");
    assertStringIncludes(guide, "Do not edit or publish directly from Studio `main`");
    assertStringIncludes(guide, "before anyone starts new Studio work");
    assertStringIncludes(guide, "supported text files only");
    assertStringIncludes(guide, "Binary images, fonts, archives");
    assertEquals(guide.includes("--quiet"), false);
    assertEquals(guide.includes("--release-name <previous>"), false);
  });

  it("uses an immutable release for the Studio-to-Git handoff", async () => {
    const guide = await Deno.readTextFile(
      "docs/guides/move-studio-changes-to-git.md",
    );

    assertStringIncludes(guide, "immutable release");
    assertStringIncludes(guide, "publish it to a non-production environment");
    assertStringIncludes(guide, "Open the Releases panel in Studio");
    assertStringIncludes(guide, ".veryfront/` in `.gitignore");
    assertStringIncludes(
      guide,
      'veryfront pull --release "$VERYFRONT_RELEASE" --prune --dry-run',
    );
    assertStringIncludes(guide, "Resolve conflicts in Git");
    assertStringIncludes(guide, "failure can leave a partial Git diff");
    assertStringIncludes(guide, "BASE_GIT_SHA");
    assertStringIncludes(guide, "gh pr create");
    assertStringIncludes(guide, "--base main");
    assertStringIncludes(guide, "full managed-source snapshot");
    assertStringIncludes(guide, "does not perform a three-way merge");
    assertStringIncludes(guide, "Do not edit");
    assertStringIncludes(guide, "directly from Studio `main`");
    assertStringIncludes(guide, "before anyone starts another Studio change");
    assertStringIncludes(guide, "--yes` and `--force` skip");
    assertStringIncludes(guide, "does not write or delete");
    assertStringIncludes(guide, "local files");
    assertStringIncludes(guide, "git merge origin/main");
    assertEquals(guide.includes("veryfront pull --branch"), false);
  });

  it("keeps the Pull safety contract in command help", async () => {
    const help = await Deno.readTextFile("cli/commands/pull/command-help.ts");

    assertStringIncludes(help, "full managed-source snapshot");
    assertStringIncludes(help, "does not perform a Git merge");
    assertStringIncludes(help, "--yes and --force skip confirmation only");
    assertStringIncludes(help, "never writes or deletes local files");
    assertStringIncludes(help, "preserves remote bytes exactly");
    assertStringIncludes(help, "symlink-traversing remote paths fail");
    assertStringIncludes(help, "A fetch failure causes no writes or pruning");
  });

  it("never recommends exposing a secret to verify environment config", async () => {
    const guide = await Deno.readTextFile("docs/guides/configuration.md");

    assertStringIncludes(guide, "VERYFRONT_CONFIG_CHECK=enabled");
    assertStringIncludes(guide, "Never return API tokens");
    assertEquals(
      guide.includes('return `getEnv("VERYFRONT_API_TOKEN")`'),
      false,
    );
  });

  it("documents the MCP session header for post-init tool calls", async () => {
    const guide = await Deno.readTextFile("docs/guides/mcp-server.md");

    assertStringIncludes(guide, "MCP-Session-Id");
    assertStringIncludes(guide, "SESSION_ID=$(curl -i");
    assertStringIncludes(guide, '-H "MCP-Session-Id: $SESSION_ID"');
    assertEquals(
      guide.includes(
        'curl -X POST http://localhost:3000/api/mcp \\\n  -H "Authorization: Bearer $MCP_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d',
      ),
      false,
    );
  });

  it("does not describe CLI schema as the MCP tool schema", async () => {
    const guide = await Deno.readTextFile("docs/guides/coding-agents.md");

    assertStringIncludes(
      guide,
      "Use `tools/list` to inspect the tools exposed by the active MCP connection.",
    );
    assertStringIncludes(guide, "`vf_get_schema`");
    assertStringIncludes(guide, "CLI command schema");
    assertEquals(
      guide.includes("For the full toolset and current argument shapes, call `vf_get_schema`"),
      false,
    );
  });

  it("recommends the current Node.js LTS in onboarding docs", async () => {
    const docs = ["docs/guides/self-hosting.md"];

    for (const path of docs) {
      const text = await Deno.readTextFile(path);

      assertStringIncludes(text, "current Node.js LTS");
      assertEquals(text.includes("Node.js 18"), false);
      assertEquals(text.includes("Node.js 18+"), false);
    }
  });

  it("states the supported runtime floors in the getting-started docs", async () => {
    for (
      const path of [
        "docs/getting-started/installation.md",
        "docs/getting-started/quickstart.md",
        "docs/getting-started/cloud-quickstart.md",
      ]
    ) {
      const text = await Deno.readTextFile(path);
      assertStringIncludes(
        text,
        `Node.js ${MINIMUM_NODE_VERSION.replace(/\.0$/, "")} or later`,
      );
      assertEquals(text.includes("Node.js 18"), false);
    }

    const installation = await Deno.readTextFile(
      "docs/getting-started/installation.md",
    );
    assertStringIncludes(
      installation,
      `Deno ${MINIMUM_DENO_VERSION.replace(/\.0$/, "")} or later`,
    );
    assertEquals(installation.includes("Deno 1.45"), false);
  });

  it("wires a Markdown renderer into every chat page the docs tell you to write", async () => {
    // `veryfront/markdown` presents plain escaped source until a renderer is
    // installed, so a `<Chat>` built without one shows the assistant's raw
    // Markdown. Every starter scaffolds `app/markdown-renderer.tsx` and the
    // provider around `<Chat>`; a copy-paste sample that drops them is a
    // silent downgrade from the scaffold the reader already has.
    for (
      const path of [
        "docs/getting-started/create-frontend.md",
        "docs/guides/chat-ui.md",
      ]
    ) {
      const guide = await Deno.readTextFile(path);
      const pageSample = firstFencedBlockContaining(guide, "// app/page.tsx");

      assert(
        pageSample !== undefined,
        `${path}: expected an app/page.tsx sample`,
      );
      assertStringIncludes(pageSample, "MarkdownRendererProvider");
      assertStringIncludes(pageSample, 'from "veryfront/markdown"');
      assertStringIncludes(pageSample, "./markdown-renderer.tsx");

      // The reader must be able to create the file the sample imports.
      assertStringIncludes(guide, "app/markdown-renderer.tsx");
      assertStringIncludes(guide, "MarkdownRendererProps");

      // "Verify it worked" must fail when the chat renders raw source,
      // otherwise the checklist passes on a visibly broken chat.
      assertStringIncludes(
        verifyItWorkedSection(guide),
        "not raw Markdown source",
      );
    }
  });

  it("gives Deno an install path on every surface the installation guide offers", async () => {
    const installation = await Deno.readTextFile(
      "docs/getting-started/installation.md",
    );

    // The page lists Deno as a supported runtime floor, so each install
    // surface it documents for npm needs a Deno counterpart that works.
    assertStringIncludes(installation, "### deno");
    assertStringIncludes(installation, "deno install -gArf npm:veryfront");
    assertStringIncludes(installation, "deno init --npm veryfront");

    // The CLI is published to npm only. `jsr:@veryfront/veryfront` has never
    // existed and resolves to a JSR 404, so it must not be advertised.
    assertEquals(installation.includes("jsr:@veryfront/veryfront"), false);
  });

  it("narrows the possibly-undefined getAgent() result in agents guide samples", async () => {
    const guide = await Deno.readTextFile("docs/guides/agents.md");

    // `getAgent()` returns `Agent | undefined`, and `veryfront init` writes a
    // tsconfig with `"strict": true`, so any sample that touches the result
    // without narrowing it fails typecheck (TS18048) when pasted verbatim.
    const unnarrowed: string[] = [];
    for (const fence of guide.matchAll(/```(?:ts|tsx)\n([\s\S]*?)```/g)) {
      const code = fence[1];
      if (code === undefined) continue;
      for (const binding of code.matchAll(/const (\w+) = getAgent\(/g)) {
        const name = binding[1];
        if (name === undefined) continue;
        const body = code.slice((binding.index ?? 0) + binding[0].length);
        const firstUse = body.search(new RegExp(`\\b${name}\\s*[.?]`));
        if (firstUse === -1) continue;
        const guardAt = body.search(new RegExp(`if\\s*\\(\\s*!${name}\\b`));
        if (guardAt === -1 || guardAt > firstUse) unnarrowed.push(name);
      }
    }

    assertEquals(
      unnarrowed,
      [],
      "agents guide samples must guard the getAgent() result before using it",
    );
  });

  it("keeps port fallback details available without interrupting the quickstarts", async () => {
    // Port 3000 is the most contended port on a developer machine. `veryfront
    // dev` no longer hard-fails on it: it falls forward to the next free port
    // and announces the switch. Both halves are invisible to a doc-only
    // reader, who then opens the 3000 the page prints and reaches whatever
    // process took it. `--port` exists but lives only in `veryfront dev
    // --help`, so the getting-started pages that start the dev server have to
    // name it and describe the fallback.
    const repoRoot = new URL("../../", import.meta.url);
    const help = await Deno.readTextFile(
      new URL("cli/commands/dev/command-help.ts", repoRoot),
    );
    const portFlag = help.match(/flag: "(--port [^"]*)"/)?.[1];
    assert(
      portFlag !== undefined,
      "veryfront dev must declare a --port flag in its command help",
    );

    const createProject = await Deno.readTextFile(
      new URL("docs/getting-started/create-project.md", repoRoot),
    );
    assertStringIncludes(createProject, "veryfront dev --port");
    // The exact notice `veryfront dev` prints, so a reader who lands on a
    // different port than the page's examples recognizes what happened.
    assertStringIncludes(createProject, "is in use, using");

    for (
      const path of [
        "docs/getting-started/quickstart.md",
        "docs/getting-started/cloud-quickstart.md",
      ]
    ) {
      const tutorial = await Deno.readTextFile(new URL(path, repoRoot));
      assertStringIncludes(tutorial, "Open the local URL printed by the CLI");
    }
  });

  it("documents the cache root in both development and production", async () => {
    // Resolved from import.meta.url, not the process cwd: test files share one
    // process under --parallel and a sibling isolate can hold a chdir.
    const repoRoot = new URL("../../", import.meta.url);
    const guide = await Deno.readTextFile(
      new URL("docs/guides/project-structure.md", repoRoot),
    );

    // `veryfront dev` and `veryfront build` both create a cache root. Before
    // this section existed the only explanation a developer got was the
    // comment inside the generated `.gitignore` marker.
    assertStringIncludes(guide, "## Generated directories");
    assertStringIncludes(guide, "`.cache/`");
    assertStringIncludes(guide, "`.cache/.gitignore`");
    assertStringIncludes(guide, "VERYFRONT_CACHE_DIR");

    // The location is not one place. `getDefaultCacheBaseDir()` sends the
    // cache to `$HOME/.cache/veryfront` under a production runtime and to
    // `<project>/.cache` otherwise, so a guide that describes only the project
    // root is wrong for every deployed run. Both branches are resolved here by
    // calling the real function under each mode rather than by forcing a cache
    // context, which would answer with the forced path in both modes and pass
    // no matter what the guide says.
    const home = "/tmp/veryfront-guide-content-home";
    const noOverride = { VERYFRONT_CACHE_DIR: undefined, VF_CACHE_DIR: undefined };
    const resolveRoots = (mode: string | undefined) =>
      withHostEnv(
        { ...noOverride, HOME: home, NODE_ENV: mode, VERYFRONT_MODE: mode },
        () => ({
          base: getCacheBaseDir(),
          mdxEsm: basename(getMdxEsmCacheDir()),
          httpBundle: basename(getHttpBundleCacheDir()),
        }),
      );

    const development = resolveRoots("development");
    const production = resolveRoots("production");

    // Guard the guard: if these ever resolve to the same place, the two
    // assertions below stop distinguishing anything and this test would keep
    // passing while the guide describes a mode that no longer exists.
    assert(
      development.base !== production.base,
      "development and production must resolve to different cache roots",
    );
    assertEquals(basename(development.base), ".cache");
    assertStringIncludes(production.base, home);

    // `.cache/veryfront` — the production root with the home prefix removed, so
    // the guide has to name the real deployed location and not just `.cache/`.
    const productionUnderHome = production.base
      .slice(home.length + 1)
      .replaceAll("\\", "/");
    assertStringIncludes(guide, productionUnderHome);

    // Every variable the production branch reads has to appear in the guide, so
    // renaming a trigger fails here instead of leaving readers checking a
    // variable the code stopped consulting.
    for (
      const key of productionCacheTriggerEnvKeys(
        await Deno.readTextFile(
          new URL("src/utils/cache-dir.ts", repoRoot),
        ),
      )
    ) {
      assertStringIncludes(guide, key);
    }

    // Pinned to the real layout in both modes, so renaming a cache
    // subdirectory fails here instead of leaving the guide describing a tree
    // that no longer exists.
    for (const { mdxEsm, httpBundle } of [development, production]) {
      assertStringIncludes(guide, mdxEsm);
      assertStringIncludes(guide, httpBundle);
    }
  });
});

/**
 * Run `fn` with host environment variables set, restoring the previous values
 * afterwards. `undefined` unsets a variable for the duration of the call.
 */
function withHostEnv<T>(
  vars: Readonly<Record<string, string | undefined>>,
  fn: () => T,
): T {
  const previous = Object.keys(vars).map(
    (key) => [key, getHostEnv(key)] as const,
  );
  const apply = (entries: readonly (readonly [string, string | undefined])[]) => {
    for (const [key, value] of entries) {
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
  };

  apply(Object.entries(vars));
  try {
    return fn();
  } finally {
    apply(previous);
  }
}

/**
 * Environment variables `getDefaultCacheBaseDir()` reads to choose between the
 * project cache root and the home cache root, read out of the source so the
 * guide's list of triggers cannot drift away from the code's.
 */
function productionCacheTriggerEnvKeys(source: string): string[] {
  const start = source.indexOf("function getDefaultCacheBaseDir(");
  assert(start !== -1, "cache-dir.ts must define getDefaultCacheBaseDir()");
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    if (source[end] === "{") depth++;
    else if (source[end] === "}" && --depth === 0) break;
  }

  const body = source.slice(open, end);
  const keys = [...body.matchAll(/getHostEnv\("([A-Z_]+)"\)/g)].map((m) => m[1]!);
  assert(keys.length > 0, "getDefaultCacheBaseDir() must read the host env");
  return [...new Set(keys)];
}

/**
 * Body of the guide's "Verify it worked" section, up to the next heading, with
 * whitespace collapsed so assertions do not depend on prose line wrapping.
 */
function verifyItWorkedSection(guide: string): string {
  const start = guide.indexOf("## Verify it worked");
  if (start === -1) return "";
  const rest = guide.slice(start + "## Verify it worked".length);
  const end = rest.indexOf("\n## ");
  return (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
}

/** First fenced code block whose body contains `needle`. */
function firstFencedBlockContaining(
  guide: string,
  needle: string,
): string | undefined {
  for (const match of guide.matchAll(/^(`{3,})[^\n]*\n([\s\S]*?)^\1\s*$/gm)) {
    const body = match[2] ?? "";
    if (body.includes(needle)) return body;
  }
  return undefined;
}
