import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import {
  createOfflineReactModuleResponseForTests,
  installOfflineReactTransportForTests,
  isOfflineUnitModuleUrlForTests,
} from "./offline-react-transport.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";

Deno.test("offline React transport serves the pinned module graph and nothing else", async () => {
  const entryUrls = [
    `https://esm.sh/react@${REACT_DEFAULT_VERSION}?target=es2022`,
    `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime?external=react`,
    `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime?external=react`,
    `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}?external=react`,
    `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client?external=react`,
    `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server?external=react`,
    "https://esm.sh/react@18.3.1?target=es2022",
    "https://esm.sh/react-dom@19.1.1/server?external=react",
    "https://esm.sh/lodash",
  ];

  for (const url of entryUrls) {
    const moduleUrl = new URL(url);
    assertEquals(
      isOfflineUnitModuleUrlForTests(moduleUrl),
      true,
    );
    const response = await createOfflineReactModuleResponseForTests(moduleUrl);
    assert(response !== undefined, url);
    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get("content-type") ?? "", "javascript");
    assertStringIncludes(await response.text(), "export");
  }

  assertEquals(
    await createOfflineReactModuleResponseForTests(
      new URL("https://esm.sh/date-fns@4.1.0"),
    ),
    undefined,
  );
  assertEquals(
    isOfflineUnitModuleUrlForTests(new URL("https://esm.sh/date-fns@4.1.0")),
    false,
  );
  assertEquals(
    await createOfflineReactModuleResponseForTests(
      new URL(`https://esm.sh/react@${REACT_DEFAULT_VERSION}/unsupported`),
    ),
    undefined,
  );
});

Deno.test("offline module transport passes its sentinel through the egress guard", async () => {
  const restore = installOfflineReactTransportForTests();
  try {
    for (
      const url of [
        `https://esm.sh/react@${REACT_DEFAULT_VERSION}?target=es2022`,
        "https://esm.sh/lodash",
      ]
    ) {
      const response = await guardedOutboundFetch(url);
      assertEquals(response.status, 200);
      assertStringIncludes(await response.text(), "export");
    }
  } finally {
    restore();
  }
});
