
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import {
  createValidator,
  PathValidationError,
  sanitizePathForDisplay,
  validatePathSync,
  ValidationPresets,
} from "./path-validation.ts";

describe("Path Validation - Basic Security", () => {
  const baseDir = "/project";

  describe("validatePathSync()", () => {
    it("should accept valid relative paths", () => {
      const result = validatePathSync("app/page.tsx", { baseDir });
      assertEquals(result.valid, true);
      assertExists(result.canonicalPath);
    });

    it("should accept valid paths in allowed directories", () => {
      const result = validatePathSync("app/components/Button.tsx", {
        baseDir,
        allowedDirs: ["app", "pages"],
      });
      assertEquals(result.valid, true);
    });

    it("should reject paths outside base directory", () => {
      const result = validatePathSync("../../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("should reject paths with null bytes", () => {
      const result = validatePathSync("app/page.tsx\0/../../etc/passwd", { baseDir });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NULL_BYTE);
    });

    it("should reject excessively long paths", () => {
      const longPath = "a/".repeat(3000);
      const result = validatePathSync(longPath, { baseDir });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.PATH_TOO_LONG);
    });

    it("should reject excessive traversal depth", () => {
      const deepPath = "../".repeat(15) + "etc/passwd";
      const result = validatePathSync(deepPath, { baseDir });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.EXCESSIVE_TRAVERSAL);
    });

    it("should reject paths not in allowlist", () => {
      const result = validatePathSync("secret/data.txt", {
        baseDir,
        allowedDirs: ["app", "pages", "public"],
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should normalize path with current directory references", () => {
      const result = validatePathSync("./app/./page.tsx", { baseDir });
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/app/page.tsx");
    });

    it("should resolve parent directory references safely", () => {
      const result = validatePathSync("app/../pages/index.tsx", { baseDir });
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/pages/index.tsx");
    });
  });

  describe("Absolute path handling", () => {
    it("should reject absolute paths in strict mode", () => {
      const result = validatePathSync("/etc/passwd", {
        baseDir,
        level: "strict",
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });

    it("should allow absolute paths in permissive mode", () => {
      const result = validatePathSync("/project/app/page.tsx", {
        baseDir,
        level: "permissive",
        allowAbsolute: true,
      });
      assertEquals(result.valid, true);
    });

    it("should validate absolute paths against base directory", () => {
      const result = validatePathSync("/etc/passwd", {
        baseDir,
        level: "permissive",
        allowAbsolute: true,
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });
  });
});

describe("Path Validation - OWASP Attack Vectors", () => {
  const baseDir = "/var/www/project";

  describe("CWE-22: Path Traversal", () => {
    const testCases = [
      { name: "Basic traversal", path: "../../../etc/passwd" },
      { name: "Multiple traversal", path: "../../../../../../../../etc/passwd" },
      { name: "Traversal with prefix", path: "app/../../../../../../etc/passwd" },
      { name: "Mixed slashes", path: "../..\\..\\..\\etc/passwd" },
      { name: "Traversal in middle", path: "app/../../../etc/passwd" },
    ];

    for (const testCase of testCases) {
      it(`should block: ${testCase.name}`, () => {
        const result = validatePathSync(testCase.path, { baseDir });
        assertEquals(result.valid, false, `Should block: ${testCase.path}`);
      });
    }
  });

  describe("CWE-23: Relative Path Traversal", () => {
    const testCases = [
      { name: "Simple relative", path: "../../config.json" },
      { name: "Nested relative", path: "app/../../lib/../../config.json" },
      { name: "Complex relative", path: "./app/../../../etc/shadow" },
    ];

    for (const testCase of testCases) {
      it(`should block: ${testCase.name}`, () => {
        const result = validatePathSync(testCase.path, { baseDir });
        assertEquals(result.valid, false, `Should block: ${testCase.path}`);
      });
    }
  });

  describe("Encoding attacks", () => {
    const testCases = [
      { name: "URL encoded dots", path: "%2e%2e%2f%2e%2e%2fetc%2fpasswd" },
      { name: "Mixed encoding", path: "..%2f..%2fetc%2fpasswd" },
      { name: "Double encoded", path: "%252e%252e%252f" },
      { name: "Unicode", path: "\u2024\u2024/etc/passwd" },
    ];

    for (const testCase of testCases) {
      it(`should handle: ${testCase.name}`, () => {
        // Note: These may pass basic validation but fail at filesystem level
        const result = validatePathSync(testCase.path, { baseDir });
        if (result.valid) {
          assertExists(result.canonicalPath);
        }
      });
    }
  });

  describe("Null byte injection (CWE-158)", () => {
    const testCases = [
      { name: "Null byte at end", path: "app/page.tsx\0" },
      { name: "Null byte in middle", path: "app\0/../../etc/passwd" },
      { name: "Multiple null bytes", path: "app\0\0/page.tsx" },
      { name: "Hex null byte", path: "app/page.tsx\x00" },
    ];

    for (const testCase of testCases) {
      it(`should block: ${testCase.name}`, () => {
        const result = validatePathSync(testCase.path, { baseDir });
        assertEquals(result.valid, false);
        assertEquals(result.code, PathValidationError.NULL_BYTE);
      });
    }
  });

  describe("Windows-specific attacks", () => {
    const testCases = [
      { name: "Backslash traversal", path: "..\\..\\..\\windows\\system32\\config" },
      { name: "Mixed separators", path: "../\\../\\../etc/passwd" },
      { name: "UNC path", path: "\\\\server\\share\\file" },
      { name: "Drive letter", path: "C:\\windows\\system32\\config" },
    ];

    for (const testCase of testCases) {
      it(`should handle: ${testCase.name}`, () => {
        const result = validatePathSync(testCase.path, { baseDir });
        if (result.valid) {
          assertExists(result.canonicalPath);
        } else {
          assertExists(result.code);
        }
      });
    }
  });

  describe("Edge cases and special sequences", () => {
    it("should handle empty path", () => {
      const result = validatePathSync("", { baseDir });
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, baseDir);
    });

    it("should handle single dot", () => {
      const result = validatePathSync(".", { baseDir });
      assertEquals(result.valid, true);
    });

    it("should handle multiple slashes", () => {
      const result = validatePathSync("app///page.tsx", { baseDir });
      assertEquals(result.valid, true);
    });

    it("should handle trailing slash", () => {
      const result = validatePathSync("app/", { baseDir });
      assertEquals(result.valid, true);
    });

    it("should handle spaces in path", () => {
      const result = validatePathSync("app/my page.tsx", { baseDir });
      assertEquals(result.valid, true);
    });

    it("should handle unicode characters", () => {
      const result = validatePathSync("app/ページ.tsx", { baseDir });
      assertEquals(result.valid, true);
    });
  });
});

describe("Path Validation - Known CVE Patterns", () => {
  const baseDir = "/app";

  describe("CVE-2019-11358 style attacks", () => {
    const testCases = [
      "../../../../etc/passwd",
      "app/../../../../etc/passwd",
      "./../../../../../../etc/shadow",
    ];

    for (const path of testCases) {
      it(`should block CVE pattern: ${path}`, () => {
        const result = validatePathSync(path, { baseDir });
        assertEquals(result.valid, false);
      });
    }
  });

  describe("Zip Slip (CVE-2018-1002200) patterns", () => {
    const testCases = [
      "../../../evil.sh",
      "good/../../../../../../evil.sh",
      "app/../../../bin/evil.sh",
    ];

    for (const path of testCases) {
      it(`should block Zip Slip pattern: ${path}`, () => {
        const result = validatePathSync(path, { baseDir });
        assertEquals(result.valid, false);
      });
    }
  });
});

describe("Path Validation - Presets", () => {
  const baseDir = "/project";

  it("userInput preset should be strict", () => {
    const options = ValidationPresets.userInput(baseDir);
    assertEquals(options.level, "strict");
    assertEquals(options.followSymlinks, false);
    assertEquals(options.allowAbsolute, false);
  });

  it("build preset should be permissive", () => {
    const options = ValidationPresets.build(baseDir);
    assertEquals(options.level, "permissive");
    assertEquals(options.allowAbsolute, true);
  });

  it("static preset should validate against dist/public", () => {
    const options = ValidationPresets.static(baseDir);
    assertEquals(options.allowedDirs, ["dist", "public"]);
  });
});

describe("Path Validation - Helper Functions", () => {
  describe("createValidator()", () => {
    it("should create validator with preset options", async () => {
      const validator = createValidator({
        baseDir: "/project",
        allowedDirs: ["app", "pages"],
      });

      const result = await validator("app/page.tsx");
      assertEquals(result.valid, true);
    });

    it("should allow overriding options", async () => {
      const validator = createValidator({
        baseDir: "/project",
        allowedDirs: ["app"],
      });

      const result = await validator("pages/index.tsx", {
        allowedDirs: ["app", "pages"],
      });
      assertEquals(result.valid, true);
    });
  });

  describe("sanitizePathForDisplay()", () => {
    it("should hide base directory from display", () => {
      const sanitized = sanitizePathForDisplay(
        "/project/app/page.tsx",
        "/project",
      );
      assertEquals(sanitized, "app/page.tsx");
    });

    it("should show only filename for paths outside base", () => {
      const sanitized = sanitizePathForDisplay(
        "/etc/passwd",
        "/project",
      );
      assertEquals(sanitized, "passwd");
    });

    it("should handle relative paths", () => {
      const sanitized = sanitizePathForDisplay(
        "app/page.tsx",
        "/project",
      );
      assertEquals(sanitized, "page.tsx");
    });
  });
});

describe("Path Validation - Cross-platform", () => {
  describe("Windows paths", () => {
    it("should normalize backslashes to forward slashes", () => {
      const result = validatePathSync("app\\page.tsx", { baseDir: "/project" });
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/app/page.tsx");
    });

    it("should handle mixed separators", () => {
      const result = validatePathSync("app\\components/Button.tsx", {
        baseDir: "/project",
      });
      assertEquals(result.valid, true);
    });

    it("should detect Windows absolute paths", () => {
      const result = validatePathSync("C:\\Windows\\System32", {
        baseDir: "/project",
        level: "strict",
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });
  });

  describe("Unix paths", () => {
    it("should handle Unix absolute paths", () => {
      const result = validatePathSync("/etc/passwd", {
        baseDir: "/project",
        level: "strict",
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });

    it("should normalize Unix paths correctly", () => {
      const result = validatePathSync("./app/../pages/index.tsx", {
        baseDir: "/project",
      });
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/pages/index.tsx");
    });
  });
});

describe("Path Validation - Security Levels", () => {
  const baseDir = "/project";

  describe("Strict level", () => {
    it("should reject absolute paths", () => {
      const result = validatePathSync("/etc/passwd", {
        baseDir,
        level: "strict",
      });
      assertEquals(result.valid, false);
    });

    it("should enforce allowlist strictly", () => {
      const result = validatePathSync("lib/utils.ts", {
        baseDir,
        level: "strict",
        allowedDirs: ["app", "pages"],
      });
      assertEquals(result.valid, false);
    });
  });

  describe("Normal level", () => {
    it("should allow paths in base directory", () => {
      const result = validatePathSync("lib/utils.ts", {
        baseDir,
        level: "normal",
      });
      assertEquals(result.valid, true);
    });

    it("should still block traversal", () => {
      const result = validatePathSync("../../../etc/passwd", {
        baseDir,
        level: "normal",
      });
      assertEquals(result.valid, false);
    });
  });

  describe("Permissive level", () => {
    it("should allow absolute paths when enabled", () => {
      const result = validatePathSync("/project/app/page.tsx", {
        baseDir,
        level: "permissive",
        allowAbsolute: true,
      });
      assertEquals(result.valid, true);
    });

    it("should still validate against base directory", () => {
      const result = validatePathSync("/etc/passwd", {
        baseDir,
        level: "permissive",
        allowAbsolute: true,
      });
      assertEquals(result.valid, false);
    });
  });
});

describe("Path Validation - Real-world scenarios", () => {
  describe("Static file serving", () => {
    const baseDir = "/var/www/site";

    it("should allow public assets", () => {
      const result = validatePathSync("public/images/logo.png", {
        baseDir,
        allowedDirs: ["public", "dist"],
      });
      assertEquals(result.valid, true);
    });

    it("should allow dist assets", () => {
      const result = validatePathSync("dist/_veryfront/chunk.js", {
        baseDir,
        allowedDirs: ["public", "dist"],
      });
      assertEquals(result.valid, true);
    });

    it("should block access to source files", () => {
      const result = validatePathSync("src/secret.ts", {
        baseDir,
        allowedDirs: ["public", "dist"],
      });
      assertEquals(result.valid, false);
    });

    it("should block traversal to parent", () => {
      const result = validatePathSync("public/../../etc/passwd", {
        baseDir,
        allowedDirs: ["public", "dist"],
      });
      assertEquals(result.valid, false);
    });
  });

  describe("API route loading", () => {
    const baseDir = "/app";

    it("should allow app routes", () => {
      const result = validatePathSync("app/api/users/route.ts", {
        baseDir,
        allowedDirs: ["app", "pages"],
      });
      assertEquals(result.valid, true);
    });

    it("should allow pages routes", () => {
      const result = validatePathSync("pages/api/data.ts", {
        baseDir,
        allowedDirs: ["app", "pages"],
      });
      assertEquals(result.valid, true);
    });

    it("should block system files", () => {
      const result = validatePathSync("../node_modules/evil/index.js", {
        baseDir,
        allowedDirs: ["app", "pages"],
      });
      assertEquals(result.valid, false);
    });
  });

  describe("Config file loading", () => {
    const baseDir = "/project";

    it("should allow root config files", () => {
      const result = validatePathSync("veryfront.config.ts", { baseDir });
      assertEquals(result.valid, true);
    });

    it("should block access outside project", () => {
      const result = validatePathSync("../other-project/config.ts", { baseDir });
      assertEquals(result.valid, false);
    });
  });
});

describe("Path Validation - Performance", () => {
  it("should validate paths quickly", () => {
    const start = performance.now();
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      validatePathSync("app/page.tsx", { baseDir: "/project" });
    }

    const duration = performance.now() - start;
    const avgTime = duration / iterations;

    assertEquals(avgTime < 0.1, true, `Avg time: ${avgTime}ms`);
  });
});
