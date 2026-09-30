import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatRegistryReleaseFailure,
  pollRegistryPackage,
  readPropagationBudget,
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
      tarball: "https://registry.example.test/package.tgz",
      integrity: `sha512-${"A".repeat(86)}==`,
      attestations: {
        provenance: {
          predicateType: "https://slsa.dev/provenance/v1",
        },
      },
    },
    ...overrides,
  };
}

function installIndex(entryOverrides: Record<string, unknown> = {}) {
  return {
    name: PACKAGE_NAME,
    versions: {
      [VERSION]: {
        name: PACKAGE_NAME,
        version: VERSION,
        dist: {
          tarball: "https://registry.example.test/package.tgz",
          integrity: `sha512-${"A".repeat(86)}==`,
        },
        ...entryOverrides,
      },
    },
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

describe("registry propagation budget", () => {
  it("waits long enough for npm to publish the version everywhere", () => {
    // `npm publish` returns before the version is readable and nothing calls
    // back when it becomes one, so the budget has to cover npm's slowest
    // processing. The 30x10s budget gave up on main three times and fifteen
    // minutes once more: rc.19779 was published at 01:43:10Z and recorded at
    // 02:03:27Z, twenty minutes later.
    // The poll waits BETWEEN attempts, so n attempts spend (n-1) delays.
    const { maxAttempts, retryDelayMs } = readPropagationBudget({});
    assertEquals(
      (maxAttempts - 1) * retryDelayMs >= 1_800_000,
      true,
      `${maxAttempts}x${retryDelayMs}ms`,
    );
  });

  it("spends every attempt the budget allows when lookups answer at once", async () => {
    // Fast 404s: the budget must still buy every lookup it allows, so a
    // version that appears in the final ten seconds of the window is seen.
    let attempts = 0;
    let now = 0;
    const { maxAttempts, retryDelayMs } = readPropagationBudget({});
    await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts,
        retryDelayMs,
        requestTimeoutMs: 15_000,
        now: () => now,
        delay: (ms) => {
          now += ms;
          return Promise.resolve();
        },
        fetcher: () => {
          attempts += 1;
          return Promise.resolve(new Response("{}", { status: 404 }));
        },
      })
    );
    assertEquals(attempts, maxAttempts);
  });

  it("uses the rest of the budget when a lookup's latency eats into it", async () => {
    // 60s budget, 10s delay, 12s lookups: without shortening the last wait the
    // poll would stop at 56s and miss a version that appears at 58s.
    let now = 0;
    const seenAt: number[] = [];
    const metadata = await pollRegistryPackage({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedGitHead: GIT_HEAD,
      maxAttempts: 1_000,
      retryDelayMs: 10_000,
      requestTimeoutMs: 15_000,
      budgetMs: 60_000,
      now: () => now,
      delay: (ms) => {
        now += ms;
        return Promise.resolve();
      },
      fetcher: (input) => {
        if (!String(input).endsWith(`/${VERSION}`)) {
          return Promise.resolve(Response.json(installIndex()));
        }
        seenAt.push(now);
        now += 12_000;
        return Promise.resolve(
          now >= 58_000
            ? Response.json(publishedPackage())
            : new Response("not found", { status: 404 }),
        );
      },
    });

    assertEquals(metadata.version, VERSION);
    assertEquals(seenAt.at(-1)! <= 60_000, true, seenAt.join(", "));
  });

  it("stops polling at the budget however slow each lookup is", async () => {
    // A lookup that takes its full request timeout must not stretch the poll
    // past the budget: the job around it is sized for that budget.
    let attempts = 0;
    let now = 0;
    const error = await captureError(() =>
      pollRegistryPackage({
        packageName: PACKAGE_NAME,
        version: VERSION,
        expectedGitHead: GIT_HEAD,
        maxAttempts: 1_000,
        retryDelayMs: 10_000,
        requestTimeoutMs: 15_000,
        budgetMs: 60_000,
        now: () => now,
        delay: (ms) => {
          now += ms;
          return Promise.resolve();
        },
        fetcher: () => {
          attempts += 1;
          // Each lookup spends its whole request timeout.
          now += 15_000;
          return Promise.resolve(new Response("{}", { status: 404 }));
        },
      })
    );
    assertEquals(error.classification, "missing-version");
    // 60s of budget at 25s per attempt: three lookups, never a thousand.
    assertEquals(attempts, 3);
  });

  it("takes the budget from the environment when CI sets one", () => {
    assertEquals(
      readPropagationBudget({
        VF_REGISTRY_PROPAGATION_ATTEMPTS: "5",
        VF_REGISTRY_PROPAGATION_DELAY_MS: "2000",
      }),
      { maxAttempts: 5, retryDelayMs: 2000 },
    );
    // Anything unusable leaves the default in place rather than a zero budget.
    // A digit-only value can still be unusable: `Infinity` never exhausts the
    // loop, and an unsafe integer stops the attempt counter advancing.
    for (
      const value of ["0", "-1", "abc", "", "1e400", "99999999999999999999"]
    ) {
      assertEquals(
        readPropagationBudget({ VF_REGISTRY_PROPAGATION_ATTEMPTS: value })
          .maxAttempts,
        readPropagationBudget({}).maxAttempts,
        value,
      );
    }
  });
});

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
      fetcher: (input) => {
        if (!String(input).endsWith(`/${VERSION}`)) {
          return Promise.resolve(Response.json(installIndex()));
        }
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
    const requestedUrls: string[] = [];

    await pollRegistryPackage({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedGitHead: GIT_HEAD,
      registryUrl: "https://registry.example.test/npm/",
      maxAttempts: 1,
      retryDelayMs: 0,
      requestTimeoutMs: 100,
      fetcher: (input) => {
        requestedUrls.push(String(input));
        return Promise.resolve(
          Response.json(
            String(input).endsWith(`/${VERSION}`) ? publishedPackage() : installIndex(),
          ),
        );
      },
      delay: () => Promise.resolve(),
    });

    assertEquals(
      requestedUrls,
      [
        `https://registry.example.test/npm/@veryfront%2Fext-auth-jwt/${VERSION}`,
        "https://registry.example.test/npm/@veryfront%2Fext-auth-jwt",
      ],
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
      fetcher: (input) => {
        if (!String(input).endsWith(`/${VERSION}`)) {
          return Promise.resolve(Response.json(installIndex()));
        }
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

  for (const returnedName of [undefined, "@veryfront/ext-wrong"]) {
    const nameCase = returnedName === undefined ? "missing" : "mismatched";
    it(`classifies a ${nameCase} registry package name distinctly`, async () => {
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
              Response.json(publishedPackage({ name: returnedName })),
            ),
          delay: () => Promise.resolve(),
        })
      );

      assertEquals(error.classification, "wrong-name");
    });
  }

  it("does not include a registry-controlled package name in failure logs", async () => {
    const injectedName = "@veryfront/ext-wrong\n::error::injected";
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
            Response.json(publishedPackage({ name: injectedName })),
          ),
        delay: () => Promise.resolve(),
      })
    );

    const output = formatRegistryReleaseFailure(error);
    assertEquals(
      output,
      `REGISTRY RELEASE FAIL [wrong-name] for ${PACKAGE_NAME}@${VERSION}: package name mismatch.`,
    );
    assertEquals(output.includes(injectedName), false);
    assertEquals(output.includes("::error::injected"), false);
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

describe("registry install-index readiness", () => {
  it("waits when the exact-version endpoint is ready before npm's install index", async () => {
    let indexes = 0;
    const delays: number[] = [];
    const metadata = await pollRegistryPackage({
      packageName: PACKAGE_NAME,
      version: VERSION,
      expectedGitHead: GIT_HEAD,
      maxAttempts: 3,
      retryDelayMs: 25,
      requestTimeoutMs: 100,
      fetcher: (input, init) => {
        if (String(input).endsWith(`/${VERSION}`)) {
          return Promise.resolve(Response.json(publishedPackage()));
        }
        assertEquals(
          new Headers(Reflect.get(init ?? {}, "headers")).get("accept"),
          "application/vnd.npm.install-v1+json",
        );
        indexes++;
        return Promise.resolve(
          Response.json(
            indexes < 3 ? { name: PACKAGE_NAME, versions: {} } : installIndex(),
          ),
        );
      },
      delay: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    assertEquals(metadata.version, VERSION);
    assertEquals(indexes, 3);
    assertEquals(delays, [25, 25]);
  });
});

describe("registry install-index integrity", () => {
  const options = {
    packageName: PACKAGE_NAME,
    version: VERSION,
    expectedGitHead: GIT_HEAD,
    maxAttempts: 2,
    retryDelayMs: 0,
    requestTimeoutMs: 100,
    delay: () => Promise.resolve(),
  };

  for (
    const [label, index, classification] of [
      [
        "package name",
        { ...installIndex(), name: "private-registry-value" },
        "wrong-name",
      ],
      [
        "entry name",
        installIndex({ name: "private-registry-value" }),
        "wrong-name",
      ],
      [
        "entry version",
        installIndex({ version: "private-registry-value" }),
        "wrong-version",
      ],
      [
        "tarball",
        installIndex({
          dist: {
            tarball: "private-registry-value",
            integrity: `sha512-${"A".repeat(86)}==`,
          },
        }),
        "provenance",
      ],
      [
        "integrity",
        installIndex({
          dist: {
            tarball: "https://registry.example.test/package.tgz",
            integrity: "private-registry-value",
          },
        }),
        "provenance",
      ],
    ] as const
  ) {
    it(`refuses a substituted install ${label} without retrying or logging its value`, async () => {
      let indexes = 0;
      const error = await captureError(() =>
        pollRegistryPackage({
          ...options,
          fetcher: (input) => {
            if (String(input).endsWith(`/${VERSION}`)) {
              return Promise.resolve(Response.json(publishedPackage()));
            }
            indexes++;
            return Promise.resolve(Response.json(index));
          },
        })
      );
      assertEquals(error.classification, classification);
      assertEquals(indexes, 1);
      assertEquals(
        formatRegistryReleaseFailure(error).includes("private-registry-value"),
        false,
      );
    });
  }

  it("does not report readiness if the install index never exposes the version", async () => {
    let indexes = 0;
    const error = await captureError(() =>
      pollRegistryPackage({
        ...options,
        fetcher: (input) => {
          if (String(input).endsWith(`/${VERSION}`)) {
            return Promise.resolve(Response.json(publishedPackage()));
          }
          indexes++;
          return Promise.resolve(
            Response.json({ name: PACKAGE_NAME, versions: {} }),
          );
        },
      })
    );
    assertEquals(error.classification, "missing-version");
    assertEquals(indexes, 2);
    assertStringIncludes(
      formatRegistryReleaseFailure(error),
      "install index metadata missing",
    );
  });

  for (
    const [label, response, classification, expectedRequests] of [
      [
        "missing index",
        () => new Response("missing", { status: 404 }),
        "missing-version",
        2,
      ],
      [
        "missing entry version",
        () => Response.json(installIndex({ version: undefined })),
        "missing-version",
        2,
      ],
      [
        "missing tarball",
        () =>
          Response.json(
            installIndex({ dist: { integrity: "sha512-example" } }),
          ),
        "missing-version",
        2,
      ],
      [
        "missing integrity",
        () =>
          Response.json(
            installIndex({
              dist: { tarball: "https://registry.example.test/package.tgz" },
            }),
          ),
        "missing-version",
        2,
      ],
      [
        "failed index lookup",
        () => new Response("private-registry-value", { status: 503 }),
        "lookup",
        1,
      ],
    ] as const
  ) {
    it(`classifies ${label} without reporting readiness`, async () => {
      let indexes = 0;
      const error = await captureError(() =>
        pollRegistryPackage({
          ...options,
          fetcher: (input) => {
            if (String(input).endsWith(`/${VERSION}`)) {
              return Promise.resolve(Response.json(publishedPackage()));
            }
            indexes++;
            return Promise.resolve(response());
          },
        })
      );
      assertEquals(error.classification, classification);
      assertEquals(indexes, expectedRequests);
      assertEquals(
        formatRegistryReleaseFailure(error).includes("private-registry-value"),
        false,
      );
    });
  }

  for (const field of ["tarball", "integrity"]) {
    it(`waits for canonical ${field} metadata before consulting the index`, async () => {
      const incomplete = publishedPackage();
      delete (incomplete.dist as Record<string, unknown>)[field];
      let indexes = 0;
      const error = await captureError(() =>
        pollRegistryPackage({
          ...options,
          fetcher: (input) => {
            if (String(input).endsWith(`/${VERSION}`)) {
              return Promise.resolve(Response.json(incomplete));
            }
            indexes++;
            return Promise.resolve(Response.json(installIndex()));
          },
        })
      );
      assertEquals(error.classification, "provenance");
      assertEquals(indexes, 0);
    });
  }

  it("shares one request timeout between version and install-index lookups", async () => {
    let versionSignal: AbortSignal | null | undefined;
    let indexes = 0;
    const error = await captureError(() =>
      pollRegistryPackage({
        ...options,
        maxAttempts: 1,
        fetcher: (input, init) => {
          if (String(input).endsWith(`/${VERSION}`)) {
            versionSignal = Reflect.get(init ?? {}, "signal");
            assertInstanceOf(versionSignal, AbortSignal);
            return Promise.resolve(Response.json(publishedPackage()));
          }
          indexes++;
          assertEquals(
            Reflect.get(init ?? {}, "signal") === versionSignal &&
              versionSignal !== undefined,
            true,
          );
          return Promise.reject(new DOMException("timed out", "TimeoutError"));
        },
      })
    );
    assertEquals(error.classification, "timeout");
    assertEquals(indexes, 1);
  });

  it("spends the existing budget on a slow install index without extending it", async () => {
    let now = 0;
    let indexes = 0;
    const error = await captureError(() =>
      pollRegistryPackage({
        ...options,
        maxAttempts: 1000,
        retryDelayMs: 10000,
        requestTimeoutMs: 15000,
        budgetMs: 60000,
        now: () => now,
        delay: (ms) => {
          now += ms;
          return Promise.resolve();
        },
        fetcher: (input) => {
          if (String(input).endsWith(`/${VERSION}`)) {
            return Promise.resolve(Response.json(publishedPackage()));
          }
          indexes++;
          now += 15000;
          return Promise.resolve(
            Response.json({ name: PACKAGE_NAME, versions: {} }),
          );
        },
      })
    );
    assertEquals(error.classification, "missing-version");
    assertEquals(indexes, 3);
    assertEquals(now, 65000);
  });
});
