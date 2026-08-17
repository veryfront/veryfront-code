import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  describeServerExternalBrowserViolation,
  getConfiguredServerExternalPackage,
  getConfiguredServerExternalRuntimeSpecifier,
  isServerOnlyPackage,
} from "./server-only-packages.ts";

describe("isServerOnlyPackage", () => {
  it("recognizes known server-only drivers", () => {
    for (const pkg of ["redis", "ioredis", "pg", "mysql2", "better-sqlite3", "mongodb"]) {
      assertEquals(isServerOnlyPackage(pkg), true, `${pkg} should be server-only`);
    }
  });

  it("strips an npm: prefix before matching", () => {
    assertEquals(isServerOnlyPackage("npm:redis"), true);
  });

  it("recognizes configured package names", () => {
    const configured = ["knex", "@prisma/client"];

    assertEquals(isServerOnlyPackage("knex", configured), true);
    assertEquals(isServerOnlyPackage("npm:knex", configured), true);
    assertEquals(isServerOnlyPackage("@prisma/client", configured), true);
  });

  it("recognizes configured packages in canonical esm.sh URLs", () => {
    const configured = ["knex", "@prisma/client"];

    assertEquals(
      getConfiguredServerExternalPackage("https://esm.sh/knex@3.1.0", configured),
      "knex",
    );
    assertEquals(
      getConfiguredServerExternalPackage(
        "https://esm.sh/@prisma/client@6.0.0/runtime/library?target=es2022",
        configured,
      ),
      "@prisma/client",
    );
    assertEquals(
      getConfiguredServerExternalPackage("https://cdn.example/knex.js", configured),
      undefined,
    );
    assertEquals(
      getConfiguredServerExternalPackage("//ESM.SH/knex@3.1.0", configured),
      "knex",
    );
    assertEquals(
      getConfiguredServerExternalPackage("HTTPS://esm.sh/knex@3.1.0", configured),
      "knex",
    );
    for (
      const specifier of [
        "https://esm.sh/kn%65x@3.1.0",
        "https://esm.sh:443/knex@3.1.0",
        "https://esm.sh./knex@3.1.0",
        "https://user:password@esm.sh/knex@3.1.0",
        "https://esm.sh/v135/knex@3.1.0",
        "https://esm.sh/stable/knex@3.1.0",
        "https://esm.sh/knex@3.1.0/",
        " https://esm.sh/knex@3.1.0\t",
        String.raw`https:\\esm.sh\knex@3.1.0`,
        "h\tttps://esm.sh/knex@3.1.0",
      ]
    ) {
      assertEquals(getConfiguredServerExternalPackage(specifier, configured), "knex");
    }
    assertEquals(
      getConfiguredServerExternalPackage("https://esm.sh/%40prisma/client@6.0.0", configured),
      "@prisma/client",
    );
    assertEquals(
      getConfiguredServerExternalPackage("https://esm.sh/knex@3%2Flib", configured),
      "knex",
    );
    assertEquals(
      getConfiguredServerExternalPackage("https://esm.sh/%40prisma%2Fclient@6.0.0", configured),
      "@prisma/client",
    );
    assertEquals(
      getConfiguredServerExternalPackage(
        "https://esm.sh/v1/%40prisma/client@6.0.0",
        configured,
      ),
      "@prisma/client",
    );
    assertEquals(
      getConfiguredServerExternalPackage("https://esm.sh/%40prisma/client@6.0.0/", configured),
      "@prisma/client",
    );
    assertEquals(
      getConfiguredServerExternalPackage("https://esm.sh/knex@3%5Clib", configured),
      "knex",
    );
  });

  it("normalizes configured versioned packages for runtimes without npm specifiers", () => {
    const configured = ["knex", "@prisma/client"];

    assertEquals(
      getConfiguredServerExternalRuntimeSpecifier("knex@3.1.0/query", configured),
      "knex/query",
    );
    assertEquals(
      getConfiguredServerExternalRuntimeSpecifier(
        "npm:@prisma/client@6.0.0/runtime/library",
        configured,
      ),
      "@prisma/client/runtime/library",
    );
    assertEquals(
      getConfiguredServerExternalRuntimeSpecifier("npm:knex@3.1.0/query", configured, true),
      "npm:knex@3.1.0/query",
    );
    assertEquals(
      getConfiguredServerExternalRuntimeSpecifier(
        "https://esm.sh/v135/knex@3.1.0/es2022/knex.mjs",
        configured,
      ),
      "knex",
    );
    assertEquals(
      getConfiguredServerExternalRuntimeSpecifier(
        "https://esm.sh/stable/@prisma/client@6.0.0/es2022/client.mjs",
        configured,
      ),
      "@prisma/client",
    );
    assertEquals(
      getConfiguredServerExternalRuntimeSpecifier(
        "https://esm.sh/knex@3.1.0/es2022/knex.mjs",
        configured,
      ),
      "knex",
    );
    assertEquals(
      getConfiguredServerExternalRuntimeSpecifier(
        "https://esm.sh/@prisma/client@6.0.0/node/client.mjs",
        configured,
      ),
      "@prisma/client",
    );
  });

  it("uses captured primitives while matching configured esm.sh packages", () => {
    const startsWith = Object.getOwnPropertyDescriptor(String.prototype, "startsWith")!;
    const match = Object.getOwnPropertyDescriptor(String.prototype, "match")!;
    const exec = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")!;
    const urlPrototype = URL.prototype;
    const url = Object.getOwnPropertyDescriptor(globalThis, "URL")!;
    const decode = Object.getOwnPropertyDescriptor(globalThis, "decodeURIComponent")!;
    const protocol = Object.getOwnPropertyDescriptor(URL.prototype, "protocol")!;
    const hostname = Object.getOwnPropertyDescriptor(URL.prototype, "hostname")!;
    const port = Object.getOwnPropertyDescriptor(URL.prototype, "port")!;
    const arrayConstructor = Object.getOwnPropertyDescriptor(Array.prototype, "constructor")!;
    let bare: string | undefined;
    let esmSh: string | undefined;
    try {
      Object.defineProperty(String.prototype, "startsWith", {
        configurable: true,
        value: () => {
          throw new Error("poisoned startsWith");
        },
      });
      Object.defineProperty(String.prototype, "match", {
        configurable: true,
        value: () => null,
      });
      Object.defineProperty(RegExp.prototype, "exec", {
        configurable: true,
        value: () => null,
      });
      Object.defineProperty(globalThis, "URL", {
        configurable: true,
        value: class PoisonedUrl {
          pathname = "/lodash";
        },
      });
      Object.defineProperty(globalThis, "decodeURIComponent", {
        configurable: true,
        value: () => {
          throw new Error("poisoned decodeURIComponent");
        },
      });
      Object.defineProperty(urlPrototype, "protocol", {
        configurable: true,
        get: () => "custom:",
      });
      Object.defineProperty(urlPrototype, "hostname", {
        configurable: true,
        get: () => "cdn.example",
      });
      Object.defineProperty(urlPrototype, "port", {
        configurable: true,
        get: () => "444",
      });
      Object.defineProperty(Array.prototype, "constructor", {
        configurable: true,
        get: () => {
          throw new Error("poisoned Array constructor");
        },
      });
      bare = getConfiguredServerExternalPackage("knex", ["knex"]);
      esmSh = getConfiguredServerExternalPackage("https://esm.sh/knex@3.1.0", ["knex"]);
    } finally {
      Object.defineProperty(String.prototype, "startsWith", startsWith);
      Object.defineProperty(String.prototype, "match", match);
      Object.defineProperty(RegExp.prototype, "exec", exec);
      Object.defineProperty(globalThis, "URL", url);
      Object.defineProperty(globalThis, "decodeURIComponent", decode);
      Object.defineProperty(urlPrototype, "protocol", protocol);
      Object.defineProperty(urlPrototype, "hostname", hostname);
      Object.defineProperty(urlPrototype, "port", port);
      Object.defineProperty(Array.prototype, "constructor", arrayConstructor);
    }

    assertEquals(bare, "knex");
    assertEquals(esmSh, "knex");
  });

  it("leaves browser-safe packages alone", () => {
    for (const pkg of ["react", "react-dom", "zod", "lodash", "@tanstack/react-query"]) {
      assertEquals(isServerOnlyPackage(pkg), false, `${pkg} should not be server-only`);
    }
  });

  it("does not parse specifiers when no package boundary is configured", () => {
    let coercions = 0;
    const unparseableSpecifier = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        throw new Error("specifier parser should not run");
      },
    } as unknown as string;

    assertEquals(getConfiguredServerExternalPackage(unparseableSpecifier, undefined), undefined);
    assertEquals(getConfiguredServerExternalPackage(unparseableSpecifier, []), undefined);
    assertEquals(coercions, 0);
  });

  it("redacts URL module identities from browser diagnostics", () => {
    for (
      const sourceModule of [
        "https://private-host.internal/app/page.ts",
        "http://127.0.0.1:8787/app/page.ts",
        "//private-host.internal/app/page.ts",
        "custom:private-module",
      ]
    ) {
      const diagnostic = describeServerExternalBrowserViolation("knex", sourceModule, "/project");
      assertEquals(diagnostic.sourceIdentity, undefined);
      assertEquals(diagnostic.message.includes(sourceModule), false);
    }
  });

  it("redacts esm.sh query and fragment details from browser diagnostics", () => {
    const diagnostic = describeServerExternalBrowserViolation(
      "https://esm.sh/knex@3.1.0/query?token=PRIVATE_TOKEN#private-fragment",
      "/project/app/database.ts",
      "/project",
    );

    assertEquals(diagnostic.message.includes("PRIVATE_TOKEN"), false);
    assertEquals(diagnostic.message.includes("private-fragment"), false);
    assertEquals(diagnostic.message.includes('"knex/query"'), true);
  });

  it("escapes control characters and quotes in browser diagnostics", () => {
    for (
      const specifier of [
        'knex/\u001b[31mred\n"quoted',
        "https://esm.sh/knex/%1B%5B31mred%0A%22quoted",
      ]
    ) {
      const diagnostic = describeServerExternalBrowserViolation(
        specifier,
        '/project/src/\u001b[31mred\n"quoted.ts',
        "/project",
      );

      assertEquals(diagnostic.message.includes("\u001b"), false);
      assertEquals(diagnostic.message.includes("\n"), false);
      assertEquals(diagnostic.message.includes("\\u001b"), true);
      assertEquals(diagnostic.message.includes("\\n"), true);
      assertEquals(diagnostic.message.includes('\\"quoted'), true);
      assertEquals(diagnostic.sourceIdentity?.includes("\u001b"), false);
      assertEquals(diagnostic.sourceIdentity?.includes("\n"), false);
      assertEquals(diagnostic.sourceIdentity?.includes("\\u001b"), true);
      assertEquals(diagnostic.sourceIdentity?.includes("\\n"), true);
    }
  });

  it("keeps Windows importers project-relative", () => {
    const diagnostic = describeServerExternalBrowserViolation(
      "knex",
      "C:\\project\\app\\page.ts",
      "C:\\project",
    );
    assertEquals(diagnostic.sourceIdentity, "app/page.ts");
  });

  it("redacts traversal segments from browser diagnostics", () => {
    for (
      const sourceModule of [
        "/project/../private-host/secret.ts",
        "/project/app/../../private-host/secret.ts",
        "../private-host/secret.ts",
      ]
    ) {
      const diagnostic = describeServerExternalBrowserViolation("knex", sourceModule, "/project");
      assertEquals(diagnostic.sourceIdentity, undefined);
      assertEquals(diagnostic.message.includes("private-host"), false);
    }
  });
});
