/**
 * The Node resolver has to honour a workspace member's own import map.
 *
 * Six `@veryfront/react-*-upstream` aliases exist only in `react/deno.json`.
 * When the Node loader read the root import map alone they escaped to a real
 * npm lookup, and every test whose graph touches React died at the import. The
 * entries must therefore come from the member configs the loader already
 * parses, not from a copy kept in the loader. A copy silently rots the next
 * time `react/deno.json` moves.
 *
 * @module tests/node-resolver-workspace-imports
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import {
  bareSpecifierFromRemoteTarget,
  findWorkspaceImportScope,
  resolve,
  workspaceImportScopes,
} from "./node/resolver-hooks.mjs";

const projectRoot = resolvePath(fileURLToPath(new URL("..", import.meta.url)));
const reactMemberDir = `${projectRoot}/react`;

interface WorkspaceImportScope {
  readonly dir: string;
  readonly imports: Record<string, string>;
}

const scopes = workspaceImportScopes as WorkspaceImportScope[];

function reactMemberImports(): Record<string, string> {
  const config = JSON.parse(readFileSync(`${reactMemberDir}/deno.json`, "utf-8")) as {
    imports?: Record<string, string>;
  };
  return config.imports ?? {};
}

describe("tests/node-resolver-workspace-imports", () => {
  describe("workspace member import maps", () => {
    it("registers a scope for the react workspace member", () => {
      const reactScope = scopes.find((scope) => scope.dir === reactMemberDir);
      assert(reactScope !== undefined, "no import scope registered for ./react");
    });

    it("carries every entry react/deno.json declares, without transcribing them", () => {
      const reactScope = scopes.find((scope) => scope.dir === reactMemberDir);
      assert(reactScope !== undefined);
      assertEquals(reactScope.imports, reactMemberImports());
    });

    it("covers the upstream aliases that exist nowhere else", () => {
      const reactScope = scopes.find((scope) => scope.dir === reactMemberDir);
      assert(reactScope !== undefined);
      for (
        const alias of [
          "@veryfront/react-upstream",
          "@veryfront/react-dom-upstream",
          "@veryfront/react-dom-client-upstream",
          "@veryfront/react-dom-server-upstream",
          "@veryfront/react-jsx-runtime-upstream",
          "@veryfront/react-jsx-dev-runtime-upstream",
        ]
      ) {
        assert(alias in reactScope.imports, `${alias} missing from the ./react scope`);
      }
    });
  });

  describe("findWorkspaceImportScope", () => {
    it("applies a member's map only inside that member", () => {
      const scope = findWorkspaceImportScope(`${reactMemberDir}/react.ts`);
      assertEquals(scope?.dir, reactMemberDir);
    });

    it("leaves modules outside every member on the root map", () => {
      assertEquals(findWorkspaceImportScope(`${projectRoot}/src/react/index.ts`), null);
    });

    it("does not treat a sibling directory as inside the member", () => {
      assertEquals(findWorkspaceImportScope(`${reactMemberDir}-extra/thing.ts`), null);
    });

    it("uses Windows separators when matching a member directory", () => {
      const windowsScope = {
        dir: String.raw`C:\veryfront\react`,
        imports: {},
      };
      scopes.push(windowsScope);

      try {
        assertEquals(
          findWorkspaceImportScope(String.raw`C:\veryfront\react\react.ts`, "\\"),
          windowsScope,
        );
        assertEquals(
          findWorkspaceImportScope(String.raw`C:\veryfront\react-extra\react.ts`, "\\"),
          null,
        );
      } finally {
        scopes.splice(scopes.indexOf(windowsScope), 1);
      }
    });

    it("has no scope for a module Node cannot place on disk", () => {
      assertEquals(findWorkspaceImportScope(null), null);
    });
  });

  it("resolves a member mapping before a colliding root mapping", async () => {
    const scopeDir = mkdtempSync(join(tmpdir(), "veryfront-node-resolver-"));
    const targetPath = join(scopeDir, "member-assert.ts");
    writeFileSync(targetPath, "export const source = 'member';\n");
    const scope = {
      dir: scopeDir,
      imports: { "#std/assert": "./member-assert.ts" },
    };
    scopes.push(scope);

    try {
      const result = await resolve(
        "#std/assert",
        { parentURL: pathToFileURL(join(scopeDir, "consumer.ts")).href },
        () => {
          throw new Error("unexpected fallback to Node resolution");
        },
      );

      assertEquals(result, {
        shortCircuit: true,
        url: pathToFileURL(targetPath).href,
      });
    } finally {
      scopes.splice(scopes.indexOf(scope), 1);
      rmSync(scopeDir, { recursive: true, force: true });
    }
  });

  describe("bareSpecifierFromRemoteTarget", () => {
    it("keeps the subpath an esm.sh target points at", () => {
      assertEquals(
        bareSpecifierFromRemoteTarget(
          "https://esm.sh/react-dom@19.2.4/server?external=react&target=es2022",
        ),
        "react-dom/server",
      );
    });

    it("reduces a bare versioned target to the package name", () => {
      assertEquals(
        bareSpecifierFromRemoteTarget("https://esm.sh/react@19.2.4?target=es2022"),
        "react",
      );
    });

    it("keeps the subpath an npm: target points at", () => {
      assertEquals(
        bareSpecifierFromRemoteTarget("npm:ajv@8.18.0/dist/2019.js"),
        "ajv/dist/2019.js",
      );
    });

    it("keeps a scoped package's scope", () => {
      assertEquals(
        bareSpecifierFromRemoteTarget("https://esm.sh/@types/react@19.2.14?deps=csstype@3.2.3"),
        "@types/react",
      );
    });

    it("ignores targets that are not remote packages", () => {
      assertEquals(bareSpecifierFromRemoteTarget("./src/react/index.ts"), null);
      assertEquals(bareSpecifierFromRemoteTarget("jsr:@std/path@1.1.2"), null);
    });
  });
});
