import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { clientAllowsStudioMcp, resolveRuntimeClientProfile } from "./client-profile.ts";

Deno.test("resolveRuntimeClientProfile normalizes nested Veryfront client metadata", () => {
  assertEquals(
    resolveRuntimeClientProfile({
      veryfront: {
        client: {
          id: "veryfront-studio",
          type: "web",
          platform: "browser",
          version: "1.0.0",
        },
      },
    }),
    {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels", "form_input", "media_display", "project_switching"],
    },
  );
});

Deno.test("resolveRuntimeClientProfile ignores legacy flat client ids", () => {
  assertEquals(resolveRuntimeClientProfile({ clientId: "veryfront-studio" }), null);
});

Deno.test("resolveRuntimeClientProfile does not grant capabilities to unknown clients", () => {
  const profile = resolveRuntimeClientProfile({
    veryfront: {
      client: {
        id: "third-party-api",
        type: "api",
      },
    },
  });

  assertEquals(profile, {
    id: "third-party-api",
    type: "api",
    trusted: false,
    capabilities: [],
  });
  assertEquals(clientAllowsStudioMcp(profile), false);
});

Deno.test("clientAllowsStudioMcp allows trusted studio-capable clients", () => {
  const profile = resolveRuntimeClientProfile({
    clientId: "veryfront-studio",
    veryfront: {
      client: {
        id: "veryfront-studio",
        type: "web",
        platform: "browser",
      },
    },
    model: "anthropic/claude-sonnet-4",
    activeChatId: "chat-123",
  });

  assertEquals(profile, {
    id: "veryfront-studio",
    type: "web",
    trusted: true,
    capabilities: ["ui_panels", "form_input", "media_display", "project_switching"],
  });
  assertEquals(clientAllowsStudioMcp(profile), true);
});
