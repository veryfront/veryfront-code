import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  resolveSnippetFilePath,
  resolveSnippetModuleServerUrl,
} from "./snippet-request.ts";

describe("snippet request mapping", () => {
  it("maps explicit and component snippet routes", () => {
    assertEquals(resolveSnippetFilePath("/@/examples/card.mdx"), "examples/card.mdx");
    assertEquals(
      resolveSnippetFilePath("/@components/ui/card"),
      "components/ui/card.snippet.mdx",
    );
    assertEquals(
      resolveSnippetFilePath("/@components/ui/card.snippet.mdx"),
      "components/ui/card.snippet.mdx",
    );
  });

  it("uses the request origin only when no module server URL is configured", () => {
    const requestUrl = new URL("https://runtime.example.test:8443/@/card.mdx?ignored=true");
    assertEquals(resolveSnippetModuleServerUrl(undefined, requestUrl), requestUrl.origin);
    assertEquals(
      resolveSnippetModuleServerUrl("http://modules.example.test:3002", requestUrl),
      "http://modules.example.test:3002",
    );
  });
});
