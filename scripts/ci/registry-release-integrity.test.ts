import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatRegistryReleaseFailure,
  pollRegistryPackage,
  RegistryReleaseError,
} from "./registry-release-integrity.ts";

const PACKAGE_NAME = "@veryfront/ext-auth-jwt";
const VERSION = "0.1.1253";
const GIT_HEAD = "0123456789abcdef0123456789abcdef01234567";

function publishedPackage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: PACKAGE_NAME,
    version: VERSION,
    gitHead: GIT_HEAD,
    dist: {
      attestations: {
        provenance: {
          predicateType: "https://slsa.dev/provenance/v1",
        },
      },
    },
    ...overrides,
  };
}

async function captureError(
  action: () => Promise<unknown>,
): Promise<RegistryReleaseError> {
  try {
    await action();
    throw new Error("Expected registry polling to fail");
  } catch (error) {
    assertInstanceOf(error, RegistryReleaseError);
    return error;
  }
}

describe("registry release integrity polling", () => {
  it("retries a missing exact version and accepts it after propagation", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const metadata = await pollRegistryPackage({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedGitHead: GIT_HEAD,
      maxAttempts: 3,
      retryDelayMs: 25,
      requestTimeoutMs: 100,
      fetcher: () => {
        attempts++;
        return Promise.resolve(
          attempts < 3
            ? new Response("not found", { status: 404 })
            : Response.json(publishedPackage()),
        );
      },
      delay: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    assertEquals(metadata.version, VERSION);
    assertEquals(attempts, 3);
    assertEquals(delays, [25, 25]);
  });

  it("looks up the exact version on the configured registry", async () => {
    let requestedUrl = "";

    await pollRegistryPackage({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedGitHead: GIT_HEAD,
      registryUrl: "https://registry.example.test/npm/",
      maxAttempts: 1,
      retryDelayMs: 0,
      requestTimeoutMs: 100,
      fetcher: (input) => {
        requestedUrl = String(input);
        return Promise.resolve(Response.json(publishedPackage()));
      },
      delay: () => Promise.resolve(),
    });

    assertEquals(
      requestedUrl,
      `https://registry.example.test/npm/%40veryfront%2Fext-auth-jwt/${VERSION}`,
    );
  });

  it("retries exact-version metadata while gitHead and provenance propagate", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const metadata = await pollRegistryPackage({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedGitHead: GIT_HEAD,
      maxAttempts: 3,
      retryDelayMs: 25,
      requestTimeoutMs: 100,
      fetcher: () => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve(
            Response.json(publishedPackage({ gitHead: undefined })),
          );
        }
        if (attempts === 2) {
          return Promise.resolve(Response.json(publishedPackage({ dist: {} })));
        }
        return Promise.resolve(Response.json(publishedPackage()));
      },
      delay: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    assertEquals(metadata.gitHead, GIT_HEAD);
    assertEquals(attempts, 3);
    assertEquals(delays, [25, 25]);
  });

  it("classifies an exact version that never propagates as missing-version", async () => {
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts: 2,
        retryDelayMs: 0,
        requestTimeoutMs: 100,
        fetcher: () => Promise.resolve(new Response("not found", { status: 404 })),
        delay: () => Promise.resolve(),
      })
    );

    assertEquals(error.classification, "missing-version");
    assertStringIncludes(error.message, `${PACKAGE_NAME}@${VERSION}`);
  });

  it("classifies returned metadata for the wrong version distinctly", async () => {
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts: 1,
        retryDelayMs: 0,
        requestTimeoutMs: 100,
        fetcher: () =>
          Promise.resolve(
            Response.json(publishedPackage({ version: "0.1.1252" })),
          ),
        delay: () => Promise.resolve(),
      })
    );

    assertEquals(error.classification, "wrong-version");
    assertStringIncludes(error.message, "returned version 0.1.1252");
  });

  it("fails immediately when gitHead does not match the release commit", async () => {
    let attempts = 0;
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts: 5,
        retryDelayMs: 0,
        requestTimeoutMs: 100,
        fetcher: () => {
          attempts++;
          return Promise.resolve(
            Response.json(publishedPackage({ gitHead: "wrong-commit" })),
          );
        },
        delay: () => Promise.resolve(),
      })
    );

    assertEquals(error.classification, "provenance");
    assertEquals(attempts, 1);
    assertStringIncludes(error.message, "wrong gitHead");
  });

  it("does not include registry-controlled metadata in failure logs", async () => {
    const injectedGitHead = "wrong-commit\n::error::injected";
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts: 1,
        retryDelayMs: 0,
        requestTimeoutMs: 100,
        fetcher: () =>
          Promise.resolve(
            Response.json(publishedPackage({ gitHead: injectedGitHead })),
          ),
        delay: () => Promise.resolve(),
      })
    );

    const output = formatRegistryReleaseFailure(error);
    assertStringIncludes(output, "REGISTRY RELEASE FAIL [provenance]");
    assertStringIncludes(output, `${PACKAGE_NAME}@${VERSION}`);
    assertStringIncludes(output, "gitHead mismatch");
    assertEquals(output.includes(injectedGitHead), false);
  });

  it("keeps sanitized package context in immediate lookup failures", async () => {
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: "@veryfront/ext bad\n::error::package",
        version: "0.1.1253\n::error::version",
        expectedGitHead: GIT_HEAD,
        maxAttempts: 1,
        retryDelayMs: 0,
        requestTimeoutMs: 100,
        fetcher: () => Promise.reject(new Error("registry says\n::error::injected")),
        delay: () => Promise.resolve(),
      })
    );

    const output = formatRegistryReleaseFailure(error);
    assertEquals(
      output,
      "REGISTRY RELEASE FAIL [lookup] for @veryfront/ext?bad???error??package@0.1.1253???error??version: registry lookup failed.",
    );
    assertEquals(output.includes("registry says"), false);
    assertEquals(output.includes("::error::injected"), false);
  });

  it("rejects a package without npm SLSA provenance", async () => {
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts: 1,
        retryDelayMs: 0,
        requestTimeoutMs: 100,
        fetcher: () => Promise.resolve(Response.json(publishedPackage({ dist: {} }))),
        delay: () => Promise.resolve(),
      })
    );

    assertEquals(error.classification, "provenance");
    assertStringIncludes(error.message, "SLSA provenance");
  });

  it("classifies bounded request aborts as timeout", async () => {
    let attempts = 0;
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts: 2,
        retryDelayMs: 0,
        requestTimeoutMs: 1,
        fetcher: () => {
          attempts++;
          return Promise.reject(new DOMException("timed out", "TimeoutError"));
        },
        delay: () => Promise.resolve(),
      })
    );

    assertEquals(error.classification, "timeout");
    assertEquals(attempts, 2);
    assertStringIncludes(error.message, "timed out");
  });
});
