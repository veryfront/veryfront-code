import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { escapeInvalidJsxAngleBrackets } from "./mdx-compiler.ts";

describe("escapeInvalidJsxAngleBrackets", () => {
  describe("escapes invalid JSX angle brackets", () => {
    it("escapes < followed by digit", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("Response time: <200ms"),
        "Response time: &lt;200ms",
      );
    });

    it("escapes < followed by special characters", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("Less than <5%"),
        "Less than &lt;5%",
      );
    });

    it("escapes multiple occurrences", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("<100ms and <5% error rate"),
        "&lt;100ms and &lt;5% error rate",
      );
    });

    it("escapes < in parentheses", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("Performance optimization (<100ms response)"),
        "Performance optimization (&lt;100ms response)",
      );
    });
  });

  describe("preserves valid JSX elements", () => {
    it("preserves elements starting with lowercase letter", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("<div>content</div>"),
        "<div>content</div>",
      );
    });

    it("preserves elements starting with uppercase letter", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("<Button>Click me</Button>"),
        "<Button>Click me</Button>",
      );
    });

    it("preserves closing tags", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("</div>"),
        "</div>",
      );
    });

    it("preserves elements starting with $", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("<$Component />"),
        "<$Component />",
      );
    });

    it("preserves elements starting with _", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("<_Internal />"),
        "<_Internal />",
      );
    });
  });

  describe("preserves code blocks", () => {
    it("preserves content inside fenced code blocks", () => {
      const input = `Regular <100ms text
\`\`\`mermaid
graph TD
    A[Input] --> B{Query Type?}
\`\`\`
More <5% text`;
      const expected = `Regular &lt;100ms text
\`\`\`mermaid
graph TD
    A[Input] --> B{Query Type?}
\`\`\`
More &lt;5% text`;
      assertEquals(escapeInvalidJsxAngleBrackets(input), expected);
    });

    it("preserves content inside tilde fenced blocks", () => {
      const input = `~~~
<100ms inside code
~~~
Outside: <200ms`;
      const expected = `~~~
<100ms inside code
~~~
Outside: &lt;200ms`;
      assertEquals(escapeInvalidJsxAngleBrackets(input), expected);
    });

    it("preserves content inside inline code", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("Inline: `<100ms` and outside <200ms"),
        "Inline: `<100ms` and outside &lt;200ms",
      );
    });

    it("preserves complex mermaid syntax", () => {
      const input = `\`\`\`mermaid
graph TD
    A[User Input] --> B{Query Type?}
    B -->|Simple| C[Match]
\`\`\``;
      assertEquals(escapeInvalidJsxAngleBrackets(input), input);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      assertEquals(escapeInvalidJsxAngleBrackets(""), "");
    });

    it("handles < at end of string", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("Text ending with <"),
        "Text ending with <",
      );
    });

    it("preserves > character", () => {
      assertEquals(
        escapeInvalidJsxAngleBrackets("Greater than >85%"),
        "Greater than >85%",
      );
    });

    it("handles multiple code blocks", () => {
      const input = `First <100ms
\`\`\`
<inside>
\`\`\`
Middle <200ms
\`\`\`
<also inside>
\`\`\`
Last <300ms`;
      const expected = `First &lt;100ms
\`\`\`
<inside>
\`\`\`
Middle &lt;200ms
\`\`\`
<also inside>
\`\`\`
Last &lt;300ms`;
      assertEquals(escapeInvalidJsxAngleBrackets(input), expected);
    });

    it("handles unclosed code blocks", () => {
      const input = `\`\`\`
<inside unclosed block`;
      // Should preserve content since we're inside an unclosed block
      assertEquals(escapeInvalidJsxAngleBrackets(input), input);
    });
  });
});
