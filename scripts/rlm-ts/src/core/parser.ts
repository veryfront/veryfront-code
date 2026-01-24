/**
 * Response Parser
 *
 * Extracts code blocks and final answers from LLM responses
 */

import type { CodeBlock, ParsedResponse } from "../types.ts";

// Default patterns
const DEFAULT_CODE_BLOCK_PATTERN = /```(\w*)\n([\s\S]*?)```/g;
const DEFAULT_FINAL_ANSWER_PATTERNS = [
  /FINAL ANSWER:\s*([\s\S]*?)(?=```|$)/i,
  /\*\*FINAL ANSWER\*\*:\s*([\s\S]*?)(?=```|$)/i,
  /Answer:\s*([\s\S]*?)(?=```|$)/i,
  /<final_answer>([\s\S]*?)<\/final_answer>/i,
  /\[ANSWER\]\s*([\s\S]*?)\[\/ANSWER\]/i,
];

export interface ParserOptions {
  codeBlockPattern?: RegExp;
  finalAnswerPatterns?: RegExp[];
  defaultLanguage?: string;
  extractInlineCode?: boolean;
}

export class ResponseParser {
  private codeBlockPattern: RegExp;
  private finalAnswerPatterns: RegExp[];
  private defaultLanguage: string;

  constructor(options: ParserOptions = {}) {
    this.codeBlockPattern = options.codeBlockPattern ?? DEFAULT_CODE_BLOCK_PATTERN;
    this.finalAnswerPatterns = options.finalAnswerPatterns ?? DEFAULT_FINAL_ANSWER_PATTERNS;
    this.defaultLanguage = options.defaultLanguage ?? "javascript";
    // extractInlineCode option reserved for future use
  }

  /**
   * Parse LLM response into structured format
   */
  parse(response: string): ParsedResponse {
    const codeBlocks = this.extractCodeBlocks(response);
    const textSegments = this.extractTextSegments(response, codeBlocks);
    const finalAnswer = this.extractFinalAnswer(response);

    return {
      rawResponse: response,
      codeBlocks,
      textSegments,
      finalAnswer,
      hasFinalAnswer: finalAnswer !== undefined,
    };
  }

  /**
   * Extract all code blocks from response
   */
  extractCodeBlocks(response: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];

    // Reset regex state
    this.codeBlockPattern.lastIndex = 0;

    let match;
    while ((match = this.codeBlockPattern.exec(response)) !== null) {
      const language = match[1] || this.defaultLanguage;
      const code = match[2].trim();

      // Calculate line numbers
      const startIndex = match.index;
      const startLine = response.substring(0, startIndex).split("\n").length;
      const endLine = startLine + code.split("\n").length - 1;

      // Skip empty code blocks
      if (code.length > 0) {
        blocks.push({
          code,
          language: this.normalizeLanguage(language),
          startLine,
          endLine,
        });
      }
    }

    return blocks;
  }

  /**
   * Extract text segments (non-code parts)
   */
  extractTextSegments(response: string, codeBlocks: CodeBlock[]): string[] {
    if (codeBlocks.length === 0) {
      return [response.trim()].filter(Boolean);
    }

    const segments: string[] = [];
    let lastEnd = 0;

    // Reset regex state
    this.codeBlockPattern.lastIndex = 0;

    let match;
    while ((match = this.codeBlockPattern.exec(response)) !== null) {
      const before = response.substring(lastEnd, match.index).trim();
      if (before) {
        segments.push(before);
      }
      lastEnd = match.index + match[0].length;
    }

    // Add remaining text after last code block
    const after = response.substring(lastEnd).trim();
    if (after) {
      segments.push(after);
    }

    return segments;
  }

  /**
   * Extract final answer from response
   */
  extractFinalAnswer(response: string): string | undefined {
    for (const pattern of this.finalAnswerPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(response);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  /**
   * Check if response contains executable code
   */
  hasExecutableCode(response: string): boolean {
    const blocks = this.extractCodeBlocks(response);
    return blocks.some((block) => this.isExecutableLanguage(block.language));
  }

  /**
   * Check if language is executable (JavaScript/TypeScript)
   */
  isExecutableLanguage(language: string): boolean {
    const normalized = this.normalizeLanguage(language);
    return ["javascript", "typescript", "js", "ts", "jsx", "tsx"].includes(normalized);
  }

  /**
   * Filter for only executable code blocks
   */
  getExecutableBlocks(blocks: CodeBlock[]): CodeBlock[] {
    return blocks.filter((block) => this.isExecutableLanguage(block.language));
  }

  /**
   * Normalize language identifier
   */
  private normalizeLanguage(language: string): string {
    const lower = language.toLowerCase().trim();

    // Map common aliases
    const aliases: Record<string, string> = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      rb: "ruby",
      sh: "bash",
      shell: "bash",
      yml: "yaml",
      "": this.defaultLanguage,
    };

    return aliases[lower] ?? lower;
  }

  /**
   * Combine multiple code blocks into single executable script
   */
  combineCodeBlocks(blocks: CodeBlock[]): string {
    return blocks
      .filter((block) => this.isExecutableLanguage(block.language))
      .map((block) => block.code)
      .join("\n\n");
  }

  /**
   * Remove code blocks from response, leaving only text
   */
  stripCodeBlocks(response: string): string {
    return response.replace(this.codeBlockPattern, "").trim();
  }

  /**
   * Count tokens in response (rough estimate)
   */
  estimateTokens(response: string): number {
    return Math.ceil(response.length / 4);
  }
}

/**
 * Utility function to quickly parse a response
 */
export function parseResponse(response: string, options?: ParserOptions): ParsedResponse {
  const parser = new ResponseParser(options);
  return parser.parse(response);
}

/**
 * Utility function to extract executable code
 */
export function extractExecutableCode(response: string): string {
  const parser = new ResponseParser();
  const parsed = parser.parse(response);
  return parser.combineCodeBlocks(parsed.codeBlocks);
}
