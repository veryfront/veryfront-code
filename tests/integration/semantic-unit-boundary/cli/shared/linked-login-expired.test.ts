/**
 * A linked project runs through Veryfront Cloud. When its stored login has
 * expired, `task`, an `eval` run and `start` stop before any run with a
 * re-login message instead of each run failing with a bare 401 from the
 * gateway. They never fall back to a provider key. Commands that only read
 * local source keep working.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { deleteHostSecret, getHostEnv } from "#cli/process-env";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { readToken, saveToken } from "#cli/auth/token-store";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { LINKED_LOGIN_EXPIRED_MESSAGE } from "#cli/shared/runtime-auth";
import { applyProjectSourceRuntimeAuth } from "../../../../../cli/shared/project-source-context.ts";
import { hydrateEvalRuntimeAuth } from "../../../../../cli/commands/eval/command.ts";
import { hydrateStartRuntimeAuth } from "../../../../../cli/commands/start/command.ts";

const ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
  "XDG_CONFIG_HOME",
  "OPENAI_API_KEY",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
  deleteHostSecret("VERYFRONT_API_TOKEN");
  _resetEnvironmentConfig();
}

const reject = { rejectExpiredLinkedLogin: true };
const commands: Array<[string, (projectDir: string) => Promise<unknown>]> = [
  [
    "task",
    (projectDir) => applyProjectSourceRuntimeAuth(projectDir, { projectSlug: "linked" }, reject),
  ],
  ["eval", (projectDir) => hydrateEvalRuntimeAuth(projectDir, { projectSlug: "linked" }, reject)],
  ["start", (projectDir) => hydrateStartRuntimeAuth({ projectDir, projectSlug: "directory" })],
];

describe("a linked project with an expired login", () => {
  let tempDirs: string[] = [];
  let requested: string[] = [];

  beforeEach(() => {
    for (const key of ENV_KEYS) deleteEnv(key);
    deleteHostSecret("VERYFRONT_API_TOKEN");
    requested = [];
    installMockFetch(
      ((input: URL | Request | string, init?: RequestInit) => {
        requested.push(new URL(new Request(input, init).url).pathname);
        return Promise.resolve(new Response(null, { status: 401 }));
      }) as typeof fetch,
    );
  });

  afterEach(async () => {
    restoreMockFetch();
    restoreEnv();
    for (const dir of tempDirs) await Deno.remove(dir, { recursive: true });
    tempDirs = [];
  });

  /** A project linked through veryfront.json, with its own stored login and an OpenAI key. */
  async function linkedProject(): Promise<{ projectDir: string; token: string }> {
    const configHome = await makeTempDir({ prefix: "vf-linked-login-config-" });
    const projectDir = await makeTempDir({ prefix: "vf-linked-login-project-" });
    tempDirs.push(configHome, projectDir);
    setEnv("XDG_CONFIG_HOME", configHome);
    setEnv("OPENAI_API_KEY", "<API_KEY>");
    _resetEnvironmentConfig();
    // Its own token: a rejected login is remembered for the rest of the process.
    const token = `expired-token-${crypto.randomUUID()}`;
    await saveToken(token);
    await Deno.writeTextFile(
      join(projectDir, "veryfront.json"),
      JSON.stringify({ projectSlug: "linked" }),
    );
    return { projectDir, token };
  }

  for (const [command, prepareAuth] of commands) {
    it(`asks to log in again in ${command}, with no provider call`, async () => {
      const { projectDir, token } = await linkedProject();

      await assertRejects(() => prepareAuth(projectDir), Error, LINKED_LOGIN_EXPIRED_MESSAGE);

      // Only the login check reached the network.
      assertEquals(requested, ["/me"]);
      assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), undefined);
      // The login stays stored; `veryfront login` replaces it.
      assertEquals(await readToken(), token);
    });
  }

  it("keeps the login, unchecked, for commands that only read local source", async () => {
    const { projectDir, token } = await linkedProject();

    // `schedule list`, `webhooks` and `eval --list` take the default options.
    const context = await applyProjectSourceRuntimeAuth(projectDir, { projectSlug: "linked" });

    assertEquals(context.apiToken, token);
    assertEquals(requested, []);
  });
});
