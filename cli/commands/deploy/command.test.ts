import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for deploy command
 * @module cli/commands/deploy.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import type {
  DeployEvent,
  DeployProject,
  DeployProjectRequest,
} from "../../shared/deployment/deploy-project.ts";
import type { DeployResult } from "../../shared/deployment/result.ts";
import { stripAnsi } from "../../ui/ansi.ts";
import { DeployArgsSchema, parseDeployArgs } from "./index.ts";
import { deployCommand } from "./command.ts";
import { parseCliArgs } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

// Never touched: the fake executor records the request without reading it.
// Named rather than inlined so it cannot be mistaken for a real checkout.
const UNRELATED_PROJECT_DIR = "fixtures/unrelated-checkout";

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: string[] }> {
  const output: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };
  try {
    return { result: await fn(), output };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

describe("deploy command adapters", () => {
  it("render human and JSON output from one injected deployment executor", async () => {
    const sentinelResult: DeployResult = {
      projectId: "project-sentinel",
      projectSlug: "sentinel-project",
      release: {
        id: "release-sentinel",
        name: "release-from-fake",
        version: "2026.07.30-1",
      },
      environment: "production",
      environmentId: "environment-sentinel",
      deploymentId: "deployment-sentinel",
      url: "https://sentinel.example.test/dashboard",
      urlVerification: "gated",
      protected: true,
      routingConvergence: { status: "converged", acknowledged: 3, recipients: 3 },
      commitSha: "f".repeat(40),
      sourceDigest: "sha256:sentinel",
      controlPlane: "https://control.example.test/api",
      branch: "main",
    };
    const observedRequests: DeployProjectRequest[] = [];
    const createFakeDeployment = (): DeployProject => ({
      async execute(request, observer) {
        observedRequests.push(request);
        const events: DeployEvent[] = [
          { kind: "step", step: "resolve-config", phase: "started" },
          { kind: "step", step: "resolve-config", phase: "completed" },
          { kind: "step", step: "create-deployment", phase: "started" },
          { kind: "step", step: "create-deployment", phase: "completed" },
          {
            kind: "warning",
            code: "environment-url-unverified",
            message: "sentinel url warning",
          },
          {
            kind: "warning",
            code: "routing-convergence-unconfirmed",
            message: "sentinel warning",
          },
        ];
        for (const event of events) await observer?.onEvent(event);
        return { kind: "deployed", result: sentinelResult };
      },
    });
    const options = {
      projectDir: "adapter-must-not-read",
      branch: "main",
      env: "production",
      releaseName: "release-from-options",
      dryRun: false,
      force: false,
      quiet: false,
      skipSourcePush: true,
      deployProject: createFakeDeployment(),
    };

    const human = await withMockFetch(
      () => {
        throw new Error("adapter performed fetch orchestration");
      },
      () => captureConsole(() => deployCommand(options)),
    );

    let json: { result: DeployResult | null; output: string[] };
    try {
      setJsonMode(true);
      json = await withMockFetch(
        () => {
          throw new Error("adapter performed fetch orchestration");
        },
        () => captureConsole(() => deployCommand(options)),
      );
    } finally {
      setJsonMode(false);
    }

    assertEquals(observedRequests.length, 2);
    assertEquals(observedRequests[0], observedRequests[1]);
    assertEquals(observedRequests[0], {
      projectDir: "adapter-must-not-read",
      branch: "main",
      environment: "production",
      releaseName: "release-from-options",
      mode: "apply",
      source: { kind: "already-pushed" },
    });
    assertEquals(human.result, sentinelResult);
    assertEquals(json.result, sentinelResult);

    const humanOutput = stripAnsi(human.output.join("\n"));
    assertEquals(humanOutput.includes("Deployed sentinel-project to production"), true);
    const expectedUrlLine = `  ${sentinelResult.url}`;
    assertEquals(
      human.output.map(stripAnsi).find((line) => line === expectedUrlLine),
      expectedUrlLine,
    );
    assertEquals(humanOutput.includes("Release 2026.07.30-1"), true);
    // Both warnings, not just the last: an operator needs the URL one most.
    assertEquals(humanOutput.includes("sentinel url warning"), true);
    assertEquals(humanOutput.includes("sentinel warning"), true);

    const jsonRecords = json.output.map((line) => JSON.parse(line));
    assertEquals(
      jsonRecords
        .filter((record) => record.type === "step")
        .map((record) => `${record.name}:${record.status}`),
      [
        "resolve-config:started",
        "resolve-config:completed",
        "deploy:started",
        "deploy:completed",
      ],
    );
    assertEquals(jsonRecords.at(-3), {
      type: "warning",
      code: "environment-url-unverified",
      message: "sentinel url warning",
    });
    assertEquals(jsonRecords.at(-2), {
      type: "warning",
      code: "routing-convergence-unconfirmed",
      message: "sentinel warning",
    });
    assertEquals(jsonRecords.at(-1), {
      type: "result",
      success: true,
      data: sentinelResult,
    });
  });
});

describe("DeployArgsSchema", () => {
  it("should use default values", () => {
    const result = DeployArgsSchema.safeParse({});
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, undefined);
    assertEquals(result.data.env, "production");
  });

  it("should accept custom branch and env", () => {
    const result = DeployArgsSchema.safeParse({ branch: "develop", env: "staging" });
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "develop");
    assertEquals(result.data.env, "staging");
  });

  it("should accept optional release name", () => {
    const result = DeployArgsSchema.safeParse({ releaseName: "v1.0.0" });
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.releaseName, "v1.0.0");
  });
});

describe("parseDeployArgs", () => {
  it("should use defaults when no args provided", () => {
    const args = { _: ["deploy"] } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, undefined);
    assertEquals(result.data.env, "production");
  });

  it("should parse --branch flag", () => {
    const args = { _: ["deploy"], branch: "develop" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "develop");
  });

  it("should parse -b flag as branch", () => {
    const args = { _: ["deploy"], b: "feature" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "feature");
  });

  it("should parse --env flag", () => {
    const args = { _: ["deploy"], env: "staging" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.env, "staging");
  });

  it("should parse --release-name flag", () => {
    const args = { _: ["deploy"], "release-name": "v2.0.0" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.releaseName, "v2.0.0");
  });

  it("should parse --dry-run and --force flags", () => {
    const args = { _: ["deploy"], "dry-run": true, force: true } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.dryRun, true);
    assertEquals(result.data.force, true);
  });

  it("should parse -f flag as force", () => {
    const args = { _: ["deploy"], f: true } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.force, true);
  });
});

describe("deploy --project", () => {
  it("targets the named project and never pushes the working directory", async () => {
    const observedRequests: DeployProjectRequest[] = [];
    const fakeDeployment: DeployProject = {
      execute(request) {
        observedRequests.push(request);
        return Promise.resolve({
          kind: "dry-run",
          plan: {
            branch: request.branch ?? "main",
            projectId: "project-codersociety",
            // The control plane answers for the requested project; a run that
            // ignored --project would ask about the working directory instead.
            projectSlug: request.projectSlug ?? "veryfront-code",
            environment: request.environment,
            environmentId: "environment-production",
            controlPlane: "https://control.example.test/api",
            plannedActions: request.source.kind === "ensure-pushed"
              ? ["push-source", "create-release", "deploy"]
              : ["create-release", "deploy"],
          },
        });
      },
    };

    const parsed = parseDeployArgs(
      parseCliArgs(["deploy", "--project", "codersociety", "--environment", "production"]),
    );
    assertEquals(parsed.success, true);
    if (!parsed.success) return;
    assertEquals(parsed.data.projectSlug, "codersociety");

    const { output } = await captureConsole(() =>
      deployCommand({
        ...parsed.data,
        projectDir: UNRELATED_PROJECT_DIR,
        dryRun: true,
        deployProject: fakeDeployment,
      })
    );

    assertEquals(observedRequests.length, 1);
    const [request] = observedRequests;
    assertEquals(request?.projectSlug, "codersociety");
    assertEquals(request?.source, { kind: "already-pushed" });

    const humanOutput = stripAnsi(output.join("\n"));
    assertEquals(humanOutput.includes("for project codersociety"), true);
    assertEquals(humanOutput.includes("push source"), false);
  });

  it("parses -p as the project slug", () => {
    const parsed = parseDeployArgs(parseCliArgs(["deploy", "-p", "codersociety"]));
    assertEquals(parsed.success, true);
    if (!parsed.success) return;
    assertEquals(parsed.data.projectSlug, "codersociety");
  });
});

describe("DeployArgsSchema - invalid inputs", () => {
  it("should reject empty branch name", () => {
    const result = DeployArgsSchema.safeParse({ branch: "" });
    assertEquals(result.success, false);
  });

  it("should reject empty env name", () => {
    const result = DeployArgsSchema.safeParse({ env: "" });
    assertEquals(result.success, false);
  });

  it("should reject empty release name", () => {
    const result = DeployArgsSchema.safeParse({ releaseName: "" });
    assertEquals(result.success, false);
  });
});
