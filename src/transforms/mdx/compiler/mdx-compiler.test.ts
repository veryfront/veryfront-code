import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/content-processor-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  register as registerContract,
  tryResolve as tryResolveContract,
  unregister as unregisterContract,
} from "#veryfront/extensions/contracts.ts";
import type {
  ContentCompileOptions,
  ContentProcessor,
} from "#veryfront/extensions/content/index.ts";
import {
  type YamlParserProvider,
  YamlParserProviderName,
} from "#veryfront/extensions/parser/yaml-parser.ts";
import { compileMDXRuntime } from "./mdx-compiler.ts";

describe("transforms/mdx/compiler/mdx-compiler", () => {
  describe("compileMDXRuntime", () => {
    it("is a function", () => {
      assertEquals(typeof compileMDXRuntime, "function");
    });

    it("compiles simple MDX content", async () => {
      const result = await compileMDXRuntime(
        "production",
        "/project",
        "# Hello World\n\nSome text.",
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(result.compiledCode.length > 0, true);
    });

    it("compiles MDX with frontmatter", async () => {
      const content = "---\ntitle: Test\n---\n\n# Hello";
      const result = await compileMDXRuntime(
        "production",
        "/project",
        content,
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
      assertEquals(
        result.frontmatter.title,
        "Test",
        "YAML frontmatter must survive MDX compilation",
      );
    });

    it("lets caller frontmatter override the YAML block", async () => {
      const result = await compileMDXRuntime(
        "production",
        "/project",
        "---\ntitle: From Body\n---\n# Hello",
        { title: "From Caller" },
        "test.mdx",
        "server",
      );

      assertEquals(
        result.frontmatter.title,
        "From Caller",
        "caller frontmatter must be forwarded and outrank the YAML block",
      );
    });

    it("compiles MDX for browser target", async () => {
      const result = await compileMDXRuntime(
        "production",
        "/project",
        "# Hello",
        undefined,
        "test.mdx",
        "browser",
      );
      assertEquals(typeof result.compiledCode, "string");
    });

    it("forwards every compile argument to the ContentProcessor", async () => {
      const previous = tryResolveContract<ContentProcessor>("ContentProcessor");
      let received: ContentCompileOptions | undefined;
      registerContract(
        "ContentProcessor",
        {
          compileMdx(options) {
            received = options;
            return Promise.resolve({ compiledCode: "", frontmatter: {}, globals: {} });
          },
          compileMarkdown() {
            throw new Error("not used");
          },
          getRemarkPlugins() {
            return [];
          },
          getRehypePlugins() {
            return [];
          },
        } satisfies ContentProcessor,
      );

      try {
        await compileMDXRuntime(
          "production",
          "/project",
          "# Hello",
          { title: "T" },
          "test.mdx",
          "browser",
          "https://cdn.example.com",
          true,
        );

        assertEquals(
          received,
          {
            mode: "production",
            projectDir: "/project",
            content: "# Hello",
            frontmatter: { title: "T" },
            filePath: "test.mdx",
            target: "browser",
            baseUrl: "https://cdn.example.com",
            studioEmbed: true,
          },
          "every compile argument must reach the ContentProcessor unchanged",
        );
      } finally {
        registerContract("ContentProcessor", previous);
      }
    });

    it("handles empty content", async () => {
      const result = await compileMDXRuntime(
        "production",
        "/project",
        "",
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
    });

    it("handles content with JSX components", async () => {
      const content = "# Hello\n\n<div>JSX content</div>";
      const result = await compileMDXRuntime(
        "production",
        "/project",
        content,
        undefined,
        "test.mdx",
        "server",
      );
      assertEquals(typeof result.compiledCode, "string");
    });

    it("classifies tenant MDX syntax failures explicitly", async () => {
      const error = await assertRejects(
        () =>
          compileMDXRuntime(
            "production",
            "/project",
            "<Unclosed",
            undefined,
            "broken.mdx",
            "server",
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "mdx-compile-error");
      assertEquals(error.category, "BUILD");
    });

    it("classifies tenant MDX frontmatter failures explicitly", async () => {
      const error = await assertRejects(
        () =>
          compileMDXRuntime(
            "production",
            "/project",
            "---\ntitle: [unterminated\n---\n# Content",
            undefined,
            "broken-frontmatter.mdx",
            "server",
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "mdx-compile-error");
      assertEquals(error.category, "BUILD");
    });

    it("classifies frontmatter SyntaxErrors from compliant YAML providers", async () => {
      const previous = tryResolveContract<YamlParserProvider>(YamlParserProviderName);
      registerContract(
        YamlParserProviderName,
        {
          parseYaml() {
            throw new SyntaxError("invalid YAML");
          },
        } satisfies YamlParserProvider,
      );

      try {
        const error = await assertRejects(
          () =>
            compileMDXRuntime(
              "production",
              "/project",
              "---\ntitle: broken\n---\n# Content",
              undefined,
              "broken-frontmatter.mdx",
              "server",
            ),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "mdx-compile-error");
        assertEquals(error.category, "BUILD");
      } finally {
        if (previous) {
          registerContract(YamlParserProviderName, previous);
        } else {
          unregisterContract(YamlParserProviderName);
        }
      }
    });

    it("preserves non-source processor failures", async () => {
      const previous = tryResolveContract<ContentProcessor>("ContentProcessor");
      registerContract(
        "ContentProcessor",
        {
          compileMdx() {
            throw new Error("Expected ContentProcessor to initialize");
          },
          compileMarkdown() {
            throw new Error("not used");
          },
          getRemarkPlugins() {
            return [];
          },
          getRehypePlugins() {
            return [];
          },
        } satisfies ContentProcessor,
      );

      try {
        const error = await assertRejects(() =>
          compileMDXRuntime(
            "production",
            "/project",
            "# Hello",
            undefined,
            "framework-failure.mdx",
            "server",
          )
        );

        assertInstanceOf(error, Error);
        assertEquals(error instanceof VeryfrontError, false);
        assertEquals((error as Error).message, "Expected ContentProcessor to initialize");
      } finally {
        registerContract("ContentProcessor", previous);
      }
    });

    it("preserves processor failures when MDX source fields are inherited", async () => {
      const previous = tryResolveContract<ContentProcessor>("ContentProcessor");
      const inheritedFields = {
        source: "remark-mdx",
        ruleId: "unexpected-token",
        line: 1,
        column: 1,
      } as const;
      const previousDescriptors = new Map(
        Object.keys(inheritedFields).map((key) => [
          key,
          Object.getOwnPropertyDescriptor(Error.prototype, key),
        ]),
      );
      const frameworkFailure = new Error("Expected ContentProcessor to initialize");
      for (const [key, value] of Object.entries(inheritedFields)) {
        Object.defineProperty(Error.prototype, key, { configurable: true, value });
      }
      registerContract(
        "ContentProcessor",
        {
          compileMdx() {
            throw frameworkFailure;
          },
          compileMarkdown() {
            throw new Error("not used");
          },
          getRemarkPlugins() {
            return [];
          },
          getRehypePlugins() {
            return [];
          },
        } satisfies ContentProcessor,
      );

      try {
        const error = await assertRejects(() =>
          compileMDXRuntime(
            "production",
            "/project",
            "# Hello",
            undefined,
            "framework-failure.mdx",
            "server",
          )
        );
        assertStrictEquals(error, frameworkFailure);
      } finally {
        registerContract("ContentProcessor", previous);
        for (const [key, descriptor] of previousDescriptors) {
          if (descriptor) Object.defineProperty(Error.prototype, key, descriptor);
          else delete (Error.prototype as unknown as Record<string, unknown>)[key];
        }
      }
    });

    it("does not invoke accessor-backed MDX source fields", async () => {
      const previous = tryResolveContract<ContentProcessor>("ContentProcessor");
      const frameworkFailure = new Error("Expected ContentProcessor to initialize");
      let getterReads = 0;
      for (
        const [key, value] of Object.entries({
          source: "remark-mdx",
          ruleId: "unexpected-token",
          line: 1,
          column: 1,
        })
      ) {
        Object.defineProperty(frameworkFailure, key, {
          configurable: true,
          get() {
            getterReads++;
            return value;
          },
        });
      }
      registerContract(
        "ContentProcessor",
        {
          compileMdx() {
            throw frameworkFailure;
          },
          compileMarkdown() {
            throw new Error("not used");
          },
          getRemarkPlugins() {
            return [];
          },
          getRehypePlugins() {
            return [];
          },
        } satisfies ContentProcessor,
      );

      try {
        const error = await assertRejects(() =>
          compileMDXRuntime(
            "production",
            "/project",
            "# Hello",
            undefined,
            "framework-failure.mdx",
            "server",
          )
        );
        assertStrictEquals(error, frameworkFailure);
        assertEquals(getterReads, 0);
      } finally {
        registerContract("ContentProcessor", previous);
      }
    });

    it("preserves framework SyntaxErrors when the frontmatter prototype is polluted", async () => {
      const marker = Symbol.for("veryfront.transforms.mdx.frontmatter-syntax-error");
      const previousMarker = Object.getOwnPropertyDescriptor(SyntaxError.prototype, marker);
      const previousProcessor = tryResolveContract<ContentProcessor>("ContentProcessor");
      const frameworkFailure = new SyntaxError("Expected ContentProcessor to initialize");
      Object.defineProperty(SyntaxError.prototype, marker, {
        configurable: true,
        value: true,
      });
      registerContract(
        "ContentProcessor",
        {
          compileMdx() {
            throw frameworkFailure;
          },
          compileMarkdown() {
            throw new Error("not used");
          },
          getRemarkPlugins() {
            return [];
          },
          getRehypePlugins() {
            return [];
          },
        } satisfies ContentProcessor,
      );

      try {
        const error = await assertRejects(
          () =>
            compileMDXRuntime(
              "production",
              "/project",
              "# Hello",
              undefined,
              "framework-failure.mdx",
              "server",
            ),
          SyntaxError,
        );
        assertStrictEquals(error, frameworkFailure);
      } finally {
        registerContract("ContentProcessor", previousProcessor);
        if (previousMarker) {
          Object.defineProperty(SyntaxError.prototype, marker, previousMarker);
        } else {
          delete (SyntaxError.prototype as { [marker]?: unknown })[marker];
        }
      }
    });
  });
});
