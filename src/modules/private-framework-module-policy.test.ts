import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  canonicalizeFrameworkModulePath,
  isPrivateFrameworkFileSpecifier,
  isPrivateFrameworkModulePath,
} from "./private-framework-module-policy.ts";

describe("private framework module policy", () => {
  it("canonicalizes bypass spellings", () => {
    for (
      const path of [
        "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts",
        "#veryfront/agent/hosted/x/../internal/control-plane-mcp-source.ts",
        "#veryfront/agent/hosted/%2e%2e/hosted/internal/control-plane-mcp-source.ts",
        "#veryfront/agent/hosted%2Finternal%2Fcontrol-plane-mcp-source.ts",
        "_veryfront//agent/hosted/internal/control-plane-mcp-source",
        "_veryfront/agent\\hosted\\internal\\control-plane-mcp-source",
        "_veryfront/agent/hosted/Internal/control-plane-mcp-source",
        "_veryfront/agent/hosted/internal./control-plane-mcp-source",
        "_veryfront/agent/hosted/internal%20/control-plane-mcp-source",
        "_veryfront/agent/hosted/x/..%20/internal/control-plane-mcp-source",
        "_veryfront/agent/hosted/.%20/internal/control-plane-mcp-source",
        "/_vf_modules/_veryfront/agent/hosted/internal/control-plane-mcp-source.js",
        "#veryfront/tool/internal/remote-mcp-transport.ts",
        "#veryfront/tool/x/../internal/remote-mcp-transport.ts",
        "/_vf_modules/_veryfront/tool/Internal/remote-mcp-transport.js",
      ]
    ) {
      assertEquals(isPrivateFrameworkModulePath(path), true, path);
    }

    assertEquals(
      canonicalizeFrameworkModulePath("#veryfront/agent/hosted/x/../internal/tool.ts"),
      "agent/hosted/internal/tool.ts",
    );
    assertEquals(
      isPrivateFrameworkModulePath("#veryfront/agent/hosted/default-chat-runtime.ts"),
      false,
    );
    assertEquals(
      isPrivateFrameworkModulePath("#veryfront/tool/remote-mcp.ts"),
      false,
    );
  });

  it("retains private-path classification after primordial mutation", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        new URL(
          "./private-framework-module-policy-hostile.fixture.ts",
          import.meta.url,
        ).href,
      ],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.success, true, stderr);
    assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
      canonical: "agent/hosted/internal/control-plane-mcp-source.js",
      private: true,
    });
  });

  it("classifies only file specifiers inside private framework subtrees", () => {
    const frameworkSourceUrl = new URL("../", import.meta.url).href;
    const privateModuleUrl = new URL(
      "agent/hosted/internal/control-plane-mcp-source.ts",
      frameworkSourceUrl,
    ).href;

    for (
      const specifier of [
        privateModuleUrl,
        privateModuleUrl.replace("file:", "FILE:"),
        privateModuleUrl.replace("/src/", "/%73rc/"),
        privateModuleUrl.replace("file:///", "file://localhost/"),
        privateModuleUrl.replace("/src/", "/src/../src/"),
        new URL("tool/internal/remote-mcp-transport.ts", frameworkSourceUrl).pathname,
      ]
    ) {
      assertEquals(
        isPrivateFrameworkFileSpecifier(specifier, frameworkSourceUrl),
        true,
        specifier,
      );
    }

    assertEquals(
      isPrivateFrameworkFileSpecifier(
        new URL("agent/hosted/default-chat-runtime.ts", frameworkSourceUrl).href,
        frameworkSourceUrl,
      ),
      false,
    );
    assertEquals(
      isPrivateFrameworkFileSpecifier(
        new URL("../outside-project.ts", frameworkSourceUrl).href,
        frameworkSourceUrl,
      ),
      false,
    );
    assertEquals(
      isPrivateFrameworkFileSpecifier(
        "https://example.test/src/agent/hosted/internal/private.ts",
        frameworkSourceUrl,
      ),
      false,
    );
  });
});
