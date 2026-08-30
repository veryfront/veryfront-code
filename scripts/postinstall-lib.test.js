import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { computeFileHash, sanitizeLogValue, verifyChecksum } from "./postinstall-lib.js";

function makeTempFile(content) {
  const dir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
  const filePath = join(dir, "testfile");
  writeFileSync(filePath, content);
  return filePath;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

describe("computeFileHash", () => {
  it("computes correct SHA-256 hash for a file", async () => {
    const content = "hello world";
    const filePath = makeTempFile(content);
    try {
      const hash = await computeFileHash(filePath);
      assert.equal(hash, sha256(content));
    } finally {
      unlinkSync(filePath);
    }
  });

  it("computes correct hash for empty file", async () => {
    const filePath = makeTempFile("");
    try {
      const hash = await computeFileHash(filePath);
      assert.equal(hash, sha256(""));
    } finally {
      unlinkSync(filePath);
    }
  });

  it("computes correct hash for binary content", async () => {
    const content = Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x01]);
    const filePath = makeTempFile(content);
    try {
      const hash = await computeFileHash(filePath);
      assert.equal(hash, createHash("sha256").update(content).digest("hex"));
    } finally {
      unlinkSync(filePath);
    }
  });

  it("rejects for non-existent file", async () => {
    await assert.rejects(() => computeFileHash("/tmp/nonexistent-file-xyz-123"));
  });
});

describe("verifyChecksum", () => {
  it("succeeds when checksum matches", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);
    const expectedHash = sha256(content);

    const mockDownload = async () => expectedHash;

    try {
      await verifyChecksum(filePath, "https://example.com/checksum", mockDownload);
      assert.ok(existsSync(filePath), "file should still exist after successful verification");
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("succeeds with '<hash>  <filename>' format", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);
    const expectedHash = sha256(content);

    const mockDownload = async () => `${expectedHash}  veryfront-linux-x64`;

    try {
      await verifyChecksum(filePath, "https://example.com/checksum", mockDownload);
      assert.ok(existsSync(filePath));
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("succeeds with uppercase hash (case-insensitive)", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);
    const expectedHash = sha256(content).toUpperCase();

    const mockDownload = async () => expectedHash;

    try {
      await verifyChecksum(filePath, "https://example.com/checksum", mockDownload);
      assert.ok(existsSync(filePath));
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("deletes file and throws on checksum mismatch", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);
    const wrongHash = "a".repeat(64);

    const mockDownload = async () => wrongHash;

    await assert.rejects(
      () => verifyChecksum(filePath, "https://example.com/checksum", mockDownload),
      (err) => {
        assert.ok(err.message.includes("Checksum mismatch"));
        return true;
      }
    );
    assert.ok(!existsSync(filePath), "file should be deleted after mismatch");
  });

  it("skips verification on HTTP 404 (older release without checksum)", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);

    const mockDownload = async () => { throw new Error("HTTP 404"); };

    try {
      await verifyChecksum(filePath, "https://example.com/checksum", mockDownload);
      assert.ok(existsSync(filePath), "file should still exist after 404 skip");
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("throws on non-404 download errors (fail-closed)", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);

    const mockDownload = async () => { throw new Error("HTTP 500"); };

    try {
      await assert.rejects(
        () => verifyChecksum(filePath, "https://example.com/checksum", mockDownload),
        (err) => {
          assert.ok(err.message.includes("Failed to fetch checksum"));
          assert.ok(err.message.includes("HTTP 500"));
          return true;
        }
      );
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("throws on network errors (fail-closed)", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);

    const mockDownload = async () => { throw new Error("ECONNREFUSED"); };

    try {
      await assert.rejects(
        () => verifyChecksum(filePath, "https://example.com/checksum", mockDownload),
        (err) => {
          assert.ok(err.message.includes("Failed to fetch checksum"));
          return true;
        }
      );
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("throws on invalid checksum format (non-hex)", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);

    const mockDownload = async () => "not-a-valid-hash";

    try {
      await assert.rejects(
        () => verifyChecksum(filePath, "https://example.com/checksum", mockDownload),
        (err) => {
          assert.ok(err.message.includes("Invalid checksum format"));
          return true;
        }
      );
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("throws on invalid checksum format (too short)", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);

    const mockDownload = async () => "abcdef1234";

    try {
      await assert.rejects(
        () => verifyChecksum(filePath, "https://example.com/checksum", mockDownload),
        (err) => {
          assert.ok(err.message.includes("Invalid checksum format"));
          return true;
        }
      );
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("throws on empty checksum response", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);

    const mockDownload = async () => "";

    try {
      await assert.rejects(
        () => verifyChecksum(filePath, "https://example.com/checksum", mockDownload),
        (err) => {
          assert.ok(err.message.includes("Invalid checksum format"));
          return true;
        }
      );
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it("handles checksum with trailing whitespace/newline", async () => {
    const content = "binary content";
    const filePath = makeTempFile(content);
    const expectedHash = sha256(content);

    const mockDownload = async () => `${expectedHash}\n`;

    try {
      await verifyChecksum(filePath, "https://example.com/checksum", mockDownload);
      assert.ok(existsSync(filePath));
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });
});

describe("sanitizeLogValue", () => {
  it("removes the line terminators used to forge log entries", () => {
    const forged = "HTTP 500\n✅ Checksum verified\r\n[INFO] installed";
    const sanitized = sanitizeLogValue(forged);
    assert.ok(!sanitized.includes("\n"), "must not contain LF");
    assert.ok(!sanitized.includes("\r"), "must not contain CR");
    assert.equal(sanitized, "HTTP 500 ✅ Checksum verified [INFO] installed");
  });

  it("removes Unicode line and paragraph separators", () => {
    const sanitized = sanitizeLogValue("a\u2028b\u2029c");
    assert.ok(!sanitized.includes("\u2028"));
    assert.ok(!sanitized.includes("\u2029"));
    assert.equal(sanitized, "a b c");
  });

  it("removes control characters, including terminal escapes", () => {
    const sanitized = sanitizeLogValue("HTTP \u001b[2K\u0000500\u009f");
    assert.equal(sanitized, "HTTP [2K 500");
  });

  it("collapses whitespace runs left behind by stripping", () => {
    assert.equal(sanitizeLogValue("  HTTP\n\n\n   500  "), "HTTP 500");
  });

  it("caps the length so one message cannot flood the log", () => {
    assert.equal(sanitizeLogValue("x".repeat(5000)).length, 500);
  });

  it("keeps the multi-line checksum mismatch message readable", () => {
    const expected = "a".repeat(64);
    const actual = "b".repeat(64);
    const sanitized = sanitizeLogValue(
      `Checksum mismatch!\n   Expected: ${expected}\n   Actual:   ${actual}`
    );
    assert.equal(
      sanitized,
      `Checksum mismatch! Expected: ${expected} Actual: ${actual}`
    );
  });

  it("coerces non-string input instead of throwing", () => {
    assert.equal(sanitizeLogValue(undefined), "undefined");
    assert.equal(sanitizeLogValue(42), "42");
  });
});
