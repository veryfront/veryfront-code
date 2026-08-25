import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractFrontmatter, isFrontmatterSyntaxError } from "./frontmatter-extractor.ts";

const FRONTMATTER_SYNTAX_ERROR = Symbol.for("veryfront.transforms.mdx.frontmatter-syntax-error");

describe("transforms/mdx/compiler/frontmatter-extractor", () => {
  describe("extractFrontmatter", () => {
    it("should return empty frontmatter for content without frontmatter", () => {
      const content = "# Hello World";
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter, {});
      assertEquals(result.body, content);
    });

    it("should extract YAML frontmatter", () => {
      const content = `---
title: My Post
date: 2024-01-01
---
# Content here`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.title, "My Post");
      assertEquals(result.body.includes("# Content here"), true);
    });

    it("should merge provided frontmatter with extracted", () => {
      const content = `---
title: From YAML
---
Body text`;
      const result = extractFrontmatter(content, { author: "Test" });

      assertEquals(result.frontmatter.title, "From YAML");
      assertEquals(result.frontmatter.author, "Test");
    });

    it("should extract export const strings", () => {
      const content = `export const title = "My Title";
export const draft = true;
# Content`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.title, "My Title");
      assertEquals(result.frontmatter.draft, true);
    });

    it("should extract export const numbers", () => {
      const content = `export const order = 42;
export const rating = 4.5;
Body`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.order, 42);
      assertEquals(result.frontmatter.rating, 4.5);
    });

    it("should extract export const false", () => {
      const content = `export const published = false;
Body`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.published, false);
    });

    it("should extract export const null", () => {
      const content = `export const category = null;
Body`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.category, null);
    });

    it("should remove extracted export lines from body", () => {
      const content = `export const title = "Test";
# Heading`;
      const result = extractFrontmatter(content);

      assertEquals(result.body.includes("export const title"), false);
      assertEquals(result.body.includes("# Heading"), true);
    });

    it("should handle content with both YAML and export constants", () => {
      const content = `---
layout: post
---
export const title = "Override";
# Hello`;
      const result = extractFrontmatter(content);

      assertEquals(result.frontmatter.layout, "post");
      assertEquals(result.frontmatter.title, "Override");
    });

    it("ranks export constants over provided frontmatter over YAML", () => {
      const content = `---
title: from-yaml
---
export const title = "from-export";
# Hello`;
      const result = extractFrontmatter(content, { title: "from-provided" });

      assertEquals(
        result.frontmatter.title,
        "from-export",
        "export const wins over both YAML and provided frontmatter",
      );

      const withoutExport = extractFrontmatter(
        `---
title: from-yaml
---
Body`,
        { title: "from-provided" },
      );

      assertEquals(
        withoutExport.frontmatter.title,
        "from-provided",
        "provided frontmatter wins over YAML",
      );
    });

    it("should handle empty content", () => {
      const result = extractFrontmatter("");

      assertEquals(result.body, "");
      assertEquals(result.frontmatter, {});
    });

    it("marks frontmatter syntax failures with an own data property", () => {
      const error = assertThrows(
        () => extractFrontmatter("---\ntitle: [unterminated\n---"),
        SyntaxError,
      );

      assertEquals(isFrontmatterSyntaxError(error), true);
    });

    it("requires an own data marker without invoking accessors", () => {
      const previous = Object.getOwnPropertyDescriptor(
        SyntaxError.prototype,
        FRONTMATTER_SYNTAX_ERROR,
      );
      const previousDescriptorValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let inheritedGetterRead = false;
      let ownGetterRead = false;

      try {
        Object.defineProperty(SyntaxError.prototype, FRONTMATTER_SYNTAX_ERROR, {
          configurable: true,
          value: true,
        });
        assertEquals(isFrontmatterSyntaxError(new SyntaxError("framework failed")), false);

        Object.defineProperty(SyntaxError.prototype, FRONTMATTER_SYNTAX_ERROR, {
          configurable: true,
          get() {
            inheritedGetterRead = true;
            return true;
          },
        });
        assertEquals(isFrontmatterSyntaxError(new SyntaxError("framework failed")), false);

        const accessorBacked = new SyntaxError("framework failed");
        Object.defineProperty(accessorBacked, FRONTMATTER_SYNTAX_ERROR, {
          configurable: true,
          get() {
            ownGetterRead = true;
            return true;
          },
        });
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          value: true,
        });
        assertEquals(isFrontmatterSyntaxError(accessorBacked), false);
        assertEquals(inheritedGetterRead, false);
        assertEquals(ownGetterRead, false);
      } finally {
        if (previous) {
          Object.defineProperty(SyntaxError.prototype, FRONTMATTER_SYNTAX_ERROR, previous);
        } else {
          delete (SyntaxError.prototype as { [FRONTMATTER_SYNTAX_ERROR]?: unknown })[
            FRONTMATTER_SYNTAX_ERROR
          ];
        }
        if (previousDescriptorValue) {
          Object.defineProperty(Object.prototype, "value", previousDescriptorValue);
        } else {
          delete (Object.prototype as { value?: unknown }).value;
        }
      }
    });

    it("fails closed when a proxy throws during marker inspection", () => {
      const hostileDescriptors = new Proxy(new SyntaxError("framework failed"), {
        getOwnPropertyDescriptor() {
          throw new Error("marker descriptor invoked proxy code");
        },
      });
      const hostilePrototype = new Proxy(new SyntaxError("framework failed"), {
        getPrototypeOf() {
          throw new Error("prototype inspection invoked proxy code");
        },
      });

      assertEquals(isFrontmatterSyntaxError(hostileDescriptors), false);
      assertEquals(isFrontmatterSyntaxError(hostilePrototype), false);
    });

    it("uses the descriptor intrinsic captured during module initialization", () => {
      const previous = Object.getOwnPropertyDescriptor(Reflect, "getOwnPropertyDescriptor");
      if (!previous || typeof previous.value !== "function") {
        throw new Error("Expected Reflect.getOwnPropertyDescriptor descriptor");
      }
      Object.defineProperty(Reflect, "getOwnPropertyDescriptor", {
        ...previous,
        value: () => ({ value: true }),
      });

      try {
        assertEquals(isFrontmatterSyntaxError(new SyntaxError("framework failed")), false);
      } finally {
        Object.defineProperty(Reflect, "getOwnPropertyDescriptor", previous);
      }
    });

    it("uses the definition intrinsic captured during module initialization", () => {
      const defineProperty = Object.defineProperty;
      const previous = Object.getOwnPropertyDescriptor(Object, "defineProperty");
      if (!previous || typeof previous.value !== "function") {
        throw new Error("Expected Object.defineProperty descriptor");
      }
      defineProperty(Object, "defineProperty", {
        ...previous,
        value: () => {
          throw new Error("poisoned marker definition");
        },
      });

      try {
        const error = assertThrows(
          () => extractFrontmatter("---\ntitle: [unterminated\n---"),
          SyntaxError,
        );
        assertEquals(isFrontmatterSyntaxError(error), true);
      } finally {
        defineProperty(Object, "defineProperty", previous);
      }
    });
  });
});
