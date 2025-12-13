import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert, assertNotEquals } from "std/assert/mod.ts";
import {
  computeEtag,
  hasMatchingEtag,
  parseIfNoneMatch,
  matchesAnyEtag,
  computeStrongEtag,
} from "./etag.ts";

describe("computeEtag", () => {
  it("should compute etag for string content", () => {
    const content = "Hello, World!";
    const etag = computeEtag(content);

    assert(etag.startsWith('W/"'));
    assert(etag.endsWith('"'));
    assert(etag.length > 4);
  });

  it("should compute etag for Uint8Array content", () => {
    const content = new Uint8Array([1, 2, 3, 4, 5]);
    const etag = computeEtag(content);

    assert(etag.startsWith('W/"'));
    assert(etag.endsWith('"'));
    assert(etag.length > 4);
  });

  it("should produce different etags for different content", () => {
    const etag1 = computeEtag("content1");
    const etag2 = computeEtag("content2");

    assertNotEquals(etag1, etag2);
  });

  it("should produce same etag for same content", () => {
    const content = "same content";
    const etag1 = computeEtag(content);
    const etag2 = computeEtag(content);

    assertEquals(etag1, etag2);
  });

  it("should produce weak etag format", () => {
    const etag = computeEtag("test");
    assert(etag.startsWith('W/"'));
  });

  it("should handle empty string", () => {
    const etag = computeEtag("");
    assert(etag.startsWith('W/"'));
    assert(etag.endsWith('"'));
  });

  it("should handle empty Uint8Array", () => {
    const etag = computeEtag(new Uint8Array([]));
    assert(etag.startsWith('W/"'));
    assert(etag.endsWith('"'));
  });
});

describe("hasMatchingEtag", () => {
  it("should return true when etags match", () => {
    const etag = 'W/"abc123"';
    const req = new Request("http://example.com", {
      headers: { "if-none-match": etag },
    });

    assertEquals(hasMatchingEtag(req, etag), true);
  });

  it("should return false when etags do not match", () => {
    const etag = 'W/"abc123"';
    const req = new Request("http://example.com", {
      headers: { "if-none-match": 'W/"different"' },
    });

    assertEquals(hasMatchingEtag(req, etag), false);
  });

  it("should return false when if-none-match header is missing", () => {
    const etag = 'W/"abc123"';
    const req = new Request("http://example.com");

    assertEquals(hasMatchingEtag(req, etag), false);
  });

  it("should handle exact string comparison", () => {
    const etag = 'W/"test"';
    const req = new Request("http://example.com", {
      headers: { "if-none-match": 'W/"test"' },
    });

    assertEquals(hasMatchingEtag(req, etag), true);
  });
});

describe("parseIfNoneMatch", () => {
  it("should parse single etag", () => {
    const result = parseIfNoneMatch('W/"abc123"');
    assertEquals(result, ['W/"abc123"']);
  });

  it("should parse multiple etags", () => {
    const result = parseIfNoneMatch('W/"abc123", W/"def456"');
    assertEquals(result, ['W/"abc123"', 'W/"def456"']);
  });

  it("should handle wildcard", () => {
    const result = parseIfNoneMatch("*");
    assertEquals(result, ["*"]);
  });

  it("should return empty array for null", () => {
    const result = parseIfNoneMatch(null);
    assertEquals(result, []);
  });

  it("should return empty array for empty string", () => {
    const result = parseIfNoneMatch("");
    assertEquals(result, []);
  });

  it("should trim whitespace", () => {
    const result = parseIfNoneMatch('  W/"abc"  ,  W/"def"  ');
    assertEquals(result, ['W/"abc"', 'W/"def"']);
  });

  it("should filter empty tags", () => {
    const result = parseIfNoneMatch('W/"abc", , W/"def"');
    assertEquals(result, ['W/"abc"', 'W/"def"']);
  });
});

describe("matchesAnyEtag", () => {
  it("should match with wildcard", () => {
    const result = matchesAnyEtag('W/"abc123"', "*");
    assertEquals(result, true);
  });

  it("should match when etag is in list", () => {
    const result = matchesAnyEtag('W/"abc123"', 'W/"abc123", W/"def456"');
    assertEquals(result, true);
  });

  it("should not match when etag is not in list", () => {
    const result = matchesAnyEtag('W/"xyz789"', 'W/"abc123", W/"def456"');
    assertEquals(result, false);
  });

  it("should not match with null header", () => {
    const result = matchesAnyEtag('W/"abc123"', null);
    assertEquals(result, false);
  });

  it("should match exact etag", () => {
    const result = matchesAnyEtag('W/"test"', 'W/"test"');
    assertEquals(result, true);
  });

  it("should handle multiple etags with spaces", () => {
    const result = matchesAnyEtag('W/"def"', 'W/"abc" , W/"def" , W/"ghi"');
    assertEquals(result, true);
  });
});

describe("computeStrongEtag", () => {
  it("should compute strong etag for string", () => {
    const etag = computeStrongEtag("test content");
    assert(etag.startsWith('"'));
    assert(etag.endsWith('"'));
    assert(!etag.startsWith('W/"'));
  });

  it("should compute strong etag for Uint8Array", () => {
    const content = new Uint8Array([1, 2, 3]);
    const etag = computeStrongEtag(content);
    assert(etag.startsWith('"'));
    assert(etag.endsWith('"'));
    assert(!etag.startsWith('W/"'));
  });

  it("should produce different etags for different content", () => {
    const etag1 = computeStrongEtag("content1");
    const etag2 = computeStrongEtag("content2");
    assertNotEquals(etag1, etag2);
  });

  it("should produce same etag for same content", () => {
    const content = "same content";
    const etag1 = computeStrongEtag(content);
    const etag2 = computeStrongEtag(content);
    assertEquals(etag1, etag2);
  });

  it("should not include W/ prefix for strong etag", () => {
    const etag = computeStrongEtag("test");
    assertEquals(etag.startsWith('W/'), false);
  });
});
