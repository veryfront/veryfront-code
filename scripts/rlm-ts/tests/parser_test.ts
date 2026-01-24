/**
 * Response Parser Tests
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ResponseParser, parseResponse, extractExecutableCode } from "../src/core/parser.ts";

Deno.test("ResponseParser - extracts single code block", () => {
  const parser = new ResponseParser();
  const response = `Here is some code:

\`\`\`javascript
console.log("hello");
\`\`\`

That's it!`;

  const result = parser.parse(response);

  assertEquals(result.codeBlocks.length, 1);
  assertEquals(result.codeBlocks[0].code, 'console.log("hello");');
  assertEquals(result.codeBlocks[0].language, "javascript");
});

Deno.test("ResponseParser - extracts multiple code blocks", () => {
  const parser = new ResponseParser();
  const response = `First:

\`\`\`javascript
const a = 1;
\`\`\`

Second:

\`\`\`python
print("hello")
\`\`\`

Done.`;

  const result = parser.parse(response);

  assertEquals(result.codeBlocks.length, 2);
  assertEquals(result.codeBlocks[0].language, "javascript");
  assertEquals(result.codeBlocks[1].language, "python");
});

Deno.test("ResponseParser - normalizes language aliases", () => {
  const parser = new ResponseParser();
  const response = `\`\`\`js
const x = 1;
\`\`\`

\`\`\`ts
const y: number = 2;
\`\`\``;

  const result = parser.parse(response);

  assertEquals(result.codeBlocks[0].language, "javascript");
  assertEquals(result.codeBlocks[1].language, "typescript");
});

Deno.test("ResponseParser - extracts final answer with FINAL ANSWER:", () => {
  const parser = new ResponseParser();
  const response = `Let me calculate...

FINAL ANSWER: The result is 42.`;

  const result = parser.parse(response);

  assertEquals(result.hasFinalAnswer, true);
  assertEquals(result.finalAnswer, "The result is 42.");
});

Deno.test("ResponseParser - extracts final answer with **FINAL ANSWER**:", () => {
  const parser = new ResponseParser();
  const response = `**FINAL ANSWER**: The answer is yes.`;

  const result = parser.parse(response);

  assertEquals(result.hasFinalAnswer, true);
  assertEquals(result.finalAnswer, "The answer is yes.");
});

Deno.test("ResponseParser - extracts final answer with XML tags", () => {
  const parser = new ResponseParser();
  const response = `<final_answer>This is the answer.</final_answer>`;

  const result = parser.parse(response);

  assertEquals(result.hasFinalAnswer, true);
  assertEquals(result.finalAnswer, "This is the answer.");
});

Deno.test("ResponseParser - extracts text segments", () => {
  const parser = new ResponseParser();
  const response = `Introduction text.

\`\`\`javascript
code here
\`\`\`

Middle text.

\`\`\`javascript
more code
\`\`\`

Conclusion text.`;

  const result = parser.parse(response);

  assertEquals(result.textSegments.length, 3);
  assertEquals(result.textSegments[0], "Introduction text.");
  assertEquals(result.textSegments[1], "Middle text.");
  assertEquals(result.textSegments[2], "Conclusion text.");
});

Deno.test("ResponseParser - hasExecutableCode returns true for JS/TS", () => {
  const parser = new ResponseParser();

  assertEquals(parser.hasExecutableCode("```javascript\ncode\n```"), true);
  assertEquals(parser.hasExecutableCode("```typescript\ncode\n```"), true);
  assertEquals(parser.hasExecutableCode("```js\ncode\n```"), true);
  assertEquals(parser.hasExecutableCode("```ts\ncode\n```"), true);
});

Deno.test("ResponseParser - hasExecutableCode returns false for non-JS", () => {
  const parser = new ResponseParser();

  assertEquals(parser.hasExecutableCode("```python\ncode\n```"), false);
  assertEquals(parser.hasExecutableCode("```rust\ncode\n```"), false);
  assertEquals(parser.hasExecutableCode("No code here"), false);
});

Deno.test("ResponseParser - getExecutableBlocks filters non-executable", () => {
  const parser = new ResponseParser();
  const parsed = parser.parse(`\`\`\`javascript
js code
\`\`\`

\`\`\`python
py code
\`\`\`

\`\`\`typescript
ts code
\`\`\``);

  const executable = parser.getExecutableBlocks(parsed.codeBlocks);

  assertEquals(executable.length, 2);
  assertEquals(executable[0].language, "javascript");
  assertEquals(executable[1].language, "typescript");
});

Deno.test("ResponseParser - combineCodeBlocks joins executable blocks", () => {
  const parser = new ResponseParser();
  const parsed = parser.parse(`\`\`\`javascript
const a = 1;
\`\`\`

\`\`\`javascript
const b = 2;
\`\`\``);

  const combined = parser.combineCodeBlocks(parsed.codeBlocks);

  assertEquals(combined, "const a = 1;\n\nconst b = 2;");
});

Deno.test("ResponseParser - stripCodeBlocks removes all code blocks", () => {
  const parser = new ResponseParser();
  const response = `Text before.

\`\`\`javascript
code
\`\`\`

Text after.`;

  const stripped = parser.stripCodeBlocks(response);

  assertEquals(stripped.includes("```"), false);
  assertEquals(stripped.includes("Text before"), true);
  assertEquals(stripped.includes("Text after"), true);
});

Deno.test("ResponseParser - estimateTokens gives rough estimate", () => {
  const parser = new ResponseParser();

  // ~4 chars per token
  assertEquals(parser.estimateTokens("1234"), 1);
  assertEquals(parser.estimateTokens("12345678"), 2);
  assertEquals(parser.estimateTokens("Hello, world!"), 4); // 13 chars -> 4 tokens
});

Deno.test("parseResponse utility function works", () => {
  const result = parseResponse("```javascript\ntest\n```\n\nFINAL ANSWER: done");

  assertEquals(result.codeBlocks.length, 1);
  assertEquals(result.hasFinalAnswer, true);
  assertEquals(result.finalAnswer, "done");
});

Deno.test("extractExecutableCode utility function works", () => {
  const code = extractExecutableCode(`\`\`\`javascript
const x = 1;
\`\`\`

\`\`\`javascript
const y = 2;
\`\`\``);

  assertEquals(code, "const x = 1;\n\nconst y = 2;");
});

Deno.test("ResponseParser - handles empty response", () => {
  const parser = new ResponseParser();
  const result = parser.parse("");

  assertEquals(result.codeBlocks.length, 0);
  assertEquals(result.textSegments.length, 0);
  assertEquals(result.hasFinalAnswer, false);
});

Deno.test("ResponseParser - handles response with no code blocks", () => {
  const parser = new ResponseParser();
  const result = parser.parse("Just some text without any code.");

  assertEquals(result.codeBlocks.length, 0);
  assertEquals(result.textSegments.length, 1);
  assertEquals(result.textSegments[0], "Just some text without any code.");
});

Deno.test("ResponseParser - handles code block with no language", () => {
  const parser = new ResponseParser();
  const result = parser.parse("```\nsome code\n```");

  assertEquals(result.codeBlocks.length, 1);
  assertEquals(result.codeBlocks[0].language, "javascript"); // default
});
