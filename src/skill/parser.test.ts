import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  parseSkillFileFrontmatter,
  parseSkillFrontmatter,
  validateSkillFileMetadata,
  validateSkillMetadata,
} from "./parser.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH,
} from "./limits.ts";
import { SKILL_METADATA_MAX_ENTRIES, SKILL_NAME_REGEX } from "./types.ts";

describe("src/skill/parser", () => {
  describe("parseSkillFrontmatter", () => {
    it("should parse valid frontmatter with all fields", async () => {
      const content = `---
name: my-skill
description: A test skill
allowed-tools: Read Write
license: MIT
---
# Instructions
Do the thing.`;

      const result = await parseSkillFrontmatter(content);
      assertEquals(result.frontmatter.name, "my-skill");
      assertEquals(result.frontmatter.description, "A test skill");
      assertEquals(result.frontmatter["allowed-tools"], "Read Write");
      assertEquals(result.frontmatter.license, "MIT");
      assertEquals(result.body.trim(), "# Instructions\nDo the thing.");
    });

    it("should parse minimal frontmatter", async () => {
      const content = `---
name: minimal
description: Just a description
---
Body text.`;

      const result = await parseSkillFrontmatter(content);
      assertEquals(result.frontmatter.name, "minimal");
      assertEquals(result.frontmatter.description, "Just a description");
      assertEquals(result.body.trim(), "Body text.");
    });

    it("should handle no frontmatter", async () => {
      const content = "Just a plain markdown file.";
      const result = await parseSkillFrontmatter(content);
      assertEquals(Object.keys(result.frontmatter).length, 0);
      assertEquals(result.body, "Just a plain markdown file.");
    });

    it("should handle empty content", async () => {
      const result = await parseSkillFrontmatter("");
      assertEquals(result.body, "");
    });

    it("fails closed on malformed YAML through the public parser", async () => {
      await assertRejects(
        () =>
          parseSkillFrontmatter(`---
name: malformed
description: [unterminated
---
Body`),
        Error,
      );
    });

    it("bounds public documents", async () => {
      const content = "x".repeat(1_048_577);
      await assertRejects(
        () => parseSkillFrontmatter(content),
        RangeError,
        "exceeds",
      );
    });

    it("strict file parsing rejects malformed and oversized documents", async () => {
      await assertRejects(
        () =>
          parseSkillFileFrontmatter(`---
name: malformed
description: [unterminated
---
Body`),
        Error,
      );
      await assertRejects(
        () => parseSkillFileFrontmatter("x".repeat(1_048_577)),
        RangeError,
        "exceeds",
      );
    });
  });

  describe("validateSkillMetadata", () => {
    it("should validate valid frontmatter", () => {
      const result = validateSkillMetadata(
        { name: "my-skill", description: "A skill" },
        "my-skill",
      );
      assertEquals(result.name, "my-skill");
      assertEquals(result.displayName, undefined);
      assertEquals(result.description, "A skill");
    });

    it("returns detached metadata through the historical mutable public contract", () => {
      const allowedTools = ["Read"];
      const metadata = { author: "Veryfront" };
      const result = validateSkillMetadata(
        {
          name: "my-skill",
          description: "A skill",
          "allowed-tools": allowedTools,
          metadata,
        },
        "my-skill",
      );

      result.allowedTools?.push("Write");
      if (result.metadata) result.metadata.author = "Changed";
      assertEquals(result.allowedTools, ["Read", "Write"]);
      assertEquals(result.metadata, { author: "Changed" });
      assertEquals(allowedTools, ["Read"]);
      assertEquals(metadata, { author: "Veryfront" });
    });

    it("should fall back to directory name when name is missing", () => {
      const result = validateSkillMetadata(
        { description: "A skill" },
        "dir-name",
      );
      assertEquals(result.name, "dir-name");
    });

    it("should throw on missing description", () => {
      try {
        validateSkillMetadata({ name: "test" }, "test");
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("missing"), true);
      }
    });

    it("should preserve a legacy display-style frontmatter name as displayName", () => {
      const result = validateSkillMetadata(
        { name: "Process Email", description: "desc" },
        "process-email",
      );
      assertEquals(result.name, "process-email");
      assertEquals(result.displayName, "Process Email");
    });

    it("should preserve a mismatched frontmatter name as displayName", () => {
      const result = validateSkillMetadata(
        { name: "email", description: "desc" },
        "process-email",
      );
      assertEquals(result.name, "process-email");
      assertEquals(result.displayName, "email");
    });

    it("should prefer metadata.display_name over a legacy frontmatter display name", () => {
      const result = validateSkillMetadata(
        {
          name: "Process Email",
          description: "desc",
          metadata: { display_name: "Email Processor", owner: "ops" },
        },
        "process-email",
      );
      assertEquals(result.name, "process-email");
      assertEquals(result.displayName, "Email Processor");
      assertEquals(result.metadata, { display_name: "Email Processor", owner: "ops" });
    });

    it("should throw on invalid directory/canonical name", () => {
      try {
        validateSkillMetadata(
          { name: "process-email", description: "desc" },
          "Process Email",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid skill name"), true);
      }
    });

    it("does not echo invalid canonical identities in validation errors", () => {
      const token = "TOP_SECRET_ID";
      let error: Error | undefined;
      try {
        validateSkillFileMetadata(
          { name: "safe", description: "Safe" },
          `safe\u001b[31m${token}`,
        );
      } catch (cause) {
        if (cause instanceof Error) error = cause;
      }

      assertEquals(error?.message.includes("\u001b"), false);
      assertEquals(error?.message.includes(token), false);
    });

    it("should reject whitespace around the directory canonical name", () => {
      try {
        validateSkillMetadata(
          { description: "desc" },
          " process-email ",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid skill name"), true);
      }
    });

    it("should throw on name too long", () => {
      const longName = "a".repeat(65);
      try {
        validateSkillMetadata(
          { name: longName, description: "desc" },
          longName,
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid skill name"), true);
      }
    });

    it("preserves the historical public name matcher", () => {
      assertEquals(SKILL_NAME_REGEX.source, "^[a-z0-9][a-z0-9-]{0,63}$");
      for (const name of ["trailing-", "double--hyphen"]) {
        assertEquals(
          validateSkillMetadata({ name, description: "desc" }, name).name,
          name,
        );
      }
    });

    it("should parse allowed-tools from space-delimited string", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": "Read Write Bash" },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write", "Bash"]);
    });

    it("should parse allowed_tools as an alias for allowed-tools", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", allowed_tools: "Read Write Bash" },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write", "Bash"]);
    });

    it("should parse allowed-tools from array", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": ["Read", "Write"] },
        "test",
      );
      assertEquals(result.allowedTools, ["Read", "Write"]);
    });

    it("preserves unbounded programmatic allowed-tools compatibility", () => {
      const patterns = Array.from(
        { length: SKILL_ALLOWED_TOOL_MAX_PATTERNS + 1 },
        (_, index) => `Tool${index}`,
      );

      assertEquals(
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": patterns },
          "test",
        ).allowedTools,
        patterns,
      );
    });

    it("should reject non-string entries in allowed-tools array", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": ["Read", 123] },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("expected all entries to be strings"), true);
      }
    });

    it("preserves legacy empty allowed-tools omission", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": "" },
        "test",
      );
      assertEquals(result.allowedTools, undefined);
    });

    it("preserves legacy null and canonical alias precedence", () => {
      assertEquals(
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": null },
          "test",
        ).allowedTools,
        undefined,
      );
      assertEquals(
        validateSkillMetadata(
          {
            name: "test",
            description: "desc",
            "allowed-tools": "Read",
            allowed_tools: "Write",
          },
          "test",
        ).allowedTools,
        ["Read"],
      );
    });

    it("should reject non-string non-array allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": 123 },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject object allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": { Read: true } },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject boolean allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": true },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject false boolean allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": false },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should reject zero numeric allowed-tools (fail closed)", () => {
      try {
        validateSkillMetadata(
          { name: "test", description: "desc", "allowed-tools": 0 },
          "test",
        );
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals(
          (e as Error).message.includes("expected a string or array of strings"),
          true,
        );
      }
    });

    it("should accept the spec's own Bash(git:*) example verbatim", () => {
      // `allowed-tools` is pre-approval metadata in the Agent Skills spec, not
      // an authorization boundary, so a spec-conformant declaration must parse
      // rather than be rejected by a Veryfront-specific pattern grammar.
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": "Bash(git:*)" },
        "test",
      );
      assertEquals(result.allowedTools, ["Bash(git:*)"]);
    });

    it("should accept prefix wildcard patterns", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", "allowed-tools": "api:* Read" },
        "test",
      );
      assertEquals(result.allowedTools, ["api:*", "Read"]);
    });

    it("should parse metadata as string map", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", metadata: { author: "test", version: "2" } },
        "test",
      );
      assertEquals(result.metadata, { author: "test", version: "2" });
    });

    it("coerces primitive metadata values through the historical public contract", () => {
      assertEquals(
        validateSkillMetadata(
          { name: "test", description: "desc", metadata: { version: 2, stable: true } },
          "test",
        ).metadata,
        { version: "2", stable: "true" },
      );
    });

    it("should pass through license and compatibility", () => {
      const result = validateSkillMetadata(
        { name: "test", description: "desc", license: "MIT", compatibility: ">=1.0" },
        "test",
      );
      assertEquals(result.license, "MIT");
      assertEquals(result.compatibility, ">=1.0");
    });

    it("truncates descriptions through the historical public contract", () => {
      const longDesc = "x".repeat(2000);
      assertEquals(
        validateSkillMetadata({ name: "test", description: longDesc }, "test").description,
        "x".repeat(1024),
      );
    });

    it("preserves unbounded compatibility through the historical public contract", () => {
      assertEquals(
        validateSkillMetadata(
          { name: "test", description: "desc", compatibility: "x".repeat(501) },
          "test",
        ).compatibility,
        "x".repeat(501),
      );
    });

    it("preserves metadata keys that overlap object prototype accessors", () => {
      const metadata = Object.fromEntries([
        ["__proto__", "legacy-value"],
      ]) as Record<string, string>;

      const result = validateSkillMetadata(
        { name: "test", description: "desc", metadata },
        "test",
      );

      assertEquals(result.metadata?.__proto__, "legacy-value");
      assertEquals(Object.hasOwn(result.metadata ?? {}, "__proto__"), true);
    });
  });

  describe("validateSkillFileMetadata", () => {
    it("does not invoke inherited indexed setters while parsing allowed-tools", () => {
      const inherited = Object.getOwnPropertyDescriptor(Array.prototype, "0");
      let setterCalls = 0;
      let allowedTools: string[] | undefined;
      try {
        Object.defineProperty(Array.prototype, "0", {
          configurable: true,
          set(this: unknown[], _value: unknown) {
            setterCalls += 1;
            Object.defineProperty(this, "0", {
              configurable: true,
              enumerable: true,
              value: "api:*",
              writable: true,
            });
          },
        });
        allowedTools = validateSkillFileMetadata(
          {
            name: "safe",
            description: "Safe policy",
            "allowed-tools": "Read",
          },
          "safe",
        ).allowedTools;
      } finally {
        if (inherited === undefined) {
          delete (Array.prototype as { 0?: unknown })[0];
        } else {
          Object.defineProperty(Array.prototype, "0", inherited);
        }
      }

      assertEquals(setterCalls, 0);
      assertEquals(allowedTools, ["Read"]);
    });

    it("accepts the specification's own allowed-tools example on the strict path", () => {
      // The grammar this PR removes rejected `Bash(git:*)`, which is the example
      // in the Agent Skills specification. The strict file path had no coverage
      // for it, so conformance was only proven on the lenient path.
      assertEquals(
        validateSkillFileMetadata(
          { name: "test", description: "desc", "allowed-tools": "Bash(git:*) Bash(jq:*) Read" },
          "test",
        ).allowedTools,
        ["Bash(git:*)", "Bash(jq:*)", "Read"],
      );
    });

    it("still rejects entries that are not bounded strings", () => {
      // Not enforcing the field is not a reason to stop validating its shape:
      // it is parsed from an untrusted skill file, stored, and surfaced.
      assertThrows(() =>
        validateSkillFileMetadata(
          { name: "test", description: "desc", "allowed-tools": [42] },
          "test",
        )
      );
      assertThrows(() =>
        validateSkillFileMetadata(
          { name: "test", description: "desc", "allowed-tools": ["a".repeat(257)] },
          "test",
        )
      );
    });

    it("retains strict file-boundary metadata validation", () => {
      assertEquals(
        validateSkillFileMetadata(
          {
            name: "test",
            description: "desc",
            "allowed-tools": [],
          },
          "test",
        ).allowedTools,
        [],
      );
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              "allowed-tools": "Read",
              allowed_tools: "Write",
            },
            "test",
          ),
        TypeError,
        "must not declare both",
      );
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              metadata: { version: 2 },
            },
            "test",
          ),
        TypeError,
        "metadata values must be strings",
      );
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "x".repeat(2000),
            },
            "test",
          ),
        RangeError,
        "description exceeds",
      );
      for (const name of ["trailing-", "double--hyphen"]) {
        assertThrows(
          () =>
            validateSkillFileMetadata(
              { name, description: "desc" },
              name,
            ),
          Error,
          "Invalid skill name",
        );
      }
    });

    it("rejects terminal control characters in displayed Skill fields", () => {
      for (const field of ["description", "license", "compatibility"] as const) {
        assertThrows(
          () =>
            validateSkillFileMetadata(
              {
                name: "safe",
                description: "Safe description",
                [field]: "trusted\u001b[31mforged",
              },
              "safe",
            ),
          TypeError,
          "control characters",
        );
      }
    });

    it("rejects accessor-backed allowed-tools without invoking getters", () => {
      let getterReads = 0;
      const allowedTools: string[] = [];
      Object.defineProperty(allowedTools, 0, {
        enumerable: true,
        get() {
          getterReads += 1;
          return "read_file";
        },
      });

      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              "allowed-tools": allowedTools,
            },
            "test",
          ),
        TypeError,
        "data property",
      );
      assertEquals(getterReads, 0);
    });

    it("does not inherit descriptor values through Object.prototype pollution", () => {
      const inherited = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let inheritedValueReads = 0;
      const allowedTools: string[] = [];
      Object.defineProperty(allowedTools, 0, {
        enumerable: true,
        get() {
          throw new Error("array accessor must not run");
        },
      });

      try {
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          get() {
            inheritedValueReads += 1;
            return "Read";
          },
        });
        assertThrows(
          () =>
            validateSkillFileMetadata(
              {
                name: "test",
                description: "desc",
                "allowed-tools": allowedTools,
              },
              "test",
            ),
          TypeError,
          "data property",
        );
      } finally {
        if (inherited === undefined) {
          delete (Object.prototype as { value?: unknown }).value;
        } else {
          Object.defineProperty(Object.prototype, "value", inherited);
        }
      }

      assertEquals(inheritedValueReads, 0);
    });

    it("keeps allowed-tools policy independent of later String.prototype.trim mutation", () => {
      const originalTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim");
      let hookCalls = 0;
      let result: ReturnType<typeof validateSkillFileMetadata> | undefined;
      Object.defineProperty(String.prototype, "trim", {
        configurable: true,
        value(this: string) {
          hookCalls += 1;
          return this === "Read" ? "api:*" : this;
        },
        writable: true,
      });

      try {
        result = validateSkillFileMetadata(
          {
            name: "test",
            description: "desc",
            "allowed-tools": ["Read"],
          },
          "test",
        );
      } finally {
        if (originalTrim) {
          Object.defineProperty(String.prototype, "trim", originalTrim);
        }
      }

      assertEquals(result?.allowedTools, ["Read"]);
      assertEquals(hookCalls, 0);
    });

    it("rejects top-level Proxy frontmatter without invoking traps", () => {
      let proxyTrapCalls = 0;
      const frontmatter = new Proxy(
        { name: "test", description: "desc" },
        {
          get(target, property, receiver) {
            proxyTrapCalls += 1;
            return Reflect.get(target, property, receiver);
          },
          getOwnPropertyDescriptor(target, property) {
            proxyTrapCalls += 1;
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
        },
      );

      assertThrows(
        () => validateSkillFileMetadata(frontmatter, "test"),
        TypeError,
        "must not be a proxy",
      );
      assertEquals(proxyTrapCalls, 0);
    });

    it("rejects nested Proxy containers without invoking traps", () => {
      for (const field of ["allowed-tools", "metadata"] as const) {
        let proxyTrapCalls = 0;
        const target = field === "allowed-tools" ? ["Read"] : { author: "Veryfront" };
        const proxied = new Proxy(target, {
          get(innerTarget, property, receiver) {
            proxyTrapCalls += 1;
            return Reflect.get(innerTarget, property, receiver);
          },
          getOwnPropertyDescriptor(innerTarget, property) {
            proxyTrapCalls += 1;
            return Reflect.getOwnPropertyDescriptor(innerTarget, property);
          },
          ownKeys(innerTarget) {
            proxyTrapCalls += 1;
            return Reflect.ownKeys(innerTarget);
          },
        });

        assertThrows(
          () =>
            validateSkillFileMetadata(
              { name: "test", description: "desc", [field]: proxied },
              "test",
            ),
          TypeError,
          "must not be a proxy",
        );
        assertEquals(proxyTrapCalls, 0);
      }
    });

    it("rejects metadata accessors without invoking getters", () => {
      let getterReads = 0;
      const metadata: Record<string, unknown> = {};
      Object.defineProperty(metadata, "author", {
        enumerable: true,
        get() {
          getterReads += 1;
          return "Veryfront";
        },
      });

      assertThrows(
        () =>
          validateSkillFileMetadata(
            { name: "test", description: "desc", metadata },
            "test",
          ),
        TypeError,
        "data properties",
      );
      assertEquals(getterReads, 0);
    });

    it("checks container caps before inspecting nested entries", () => {
      let allowedToolGetterReads = 0;
      const allowedTools = Array.from(
        { length: SKILL_ALLOWED_TOOL_MAX_PATTERNS + 1 },
        () => "Read",
      );
      Object.defineProperty(allowedTools, 0, {
        enumerable: true,
        get() {
          allowedToolGetterReads += 1;
          return "api:*";
        },
      });

      assertThrows(
        () =>
          validateSkillFileMetadata(
            { name: "test", description: "desc", "allowed-tools": allowedTools },
            "test",
          ),
        RangeError,
        `at most ${SKILL_ALLOWED_TOOL_MAX_PATTERNS}`,
      );
      assertEquals(allowedToolGetterReads, 0);

      let metadataGetterReads = 0;
      const metadata: Record<string, unknown> = {};
      for (let index = 0; index <= SKILL_METADATA_MAX_ENTRIES; index += 1) {
        Object.defineProperty(metadata, `key${index}`, {
          configurable: true,
          enumerable: true,
          value: "value",
        });
      }
      Object.defineProperty(metadata, "key0", {
        configurable: true,
        enumerable: true,
        get() {
          metadataGetterReads += 1;
          return "forged";
        },
      });

      assertThrows(
        () =>
          validateSkillFileMetadata(
            { name: "test", description: "desc", metadata },
            "test",
          ),
        RangeError,
        `at most ${SKILL_METADATA_MAX_ENTRIES}`,
      );
      assertEquals(metadataGetterReads, 0);
    });

    it("bounds string-form allowed-tools before calling mutable split hooks", () => {
      const originalSplit = Object.getOwnPropertyDescriptor(String.prototype, "split");
      const overlongDeclaration = "x".repeat(
        SKILL_ALLOWED_TOOL_MAX_PATTERNS * (SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH + 1) + 1,
      );
      let hookCalls = 0;
      let failure: unknown;
      Object.defineProperty(String.prototype, "split", {
        configurable: true,
        value() {
          hookCalls += 1;
          return ["Read"];
        },
        writable: true,
      });

      try {
        validateSkillFileMetadata(
          {
            name: "test",
            description: "desc",
            "allowed-tools": overlongDeclaration,
          },
          "test",
        );
      } catch (error) {
        failure = error;
      } finally {
        if (originalSplit) {
          Object.defineProperty(String.prototype, "split", originalSplit);
        }
      }

      assertEquals(failure instanceof RangeError, true);
      assertEquals(hookCalls, 0);
    });

    it("uses captured descriptor intrinsics for strict snapshots", () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Object,
        "getOwnPropertyDescriptor",
      );
      const nativeGetOwnPropertyDescriptor = originalDescriptor?.value as
        | typeof Object.getOwnPropertyDescriptor
        | undefined;
      let hookCalls = 0;
      let result: ReturnType<typeof validateSkillFileMetadata> | undefined;
      Object.defineProperty(Object, "getOwnPropertyDescriptor", {
        configurable: true,
        value(target: object, property: PropertyKey) {
          hookCalls += 1;
          return Reflect.apply(nativeGetOwnPropertyDescriptor!, Object, [target, property]);
        },
        writable: true,
      });

      try {
        result = validateSkillFileMetadata(
          {
            name: "test",
            description: "desc",
            metadata: { author: "Veryfront" },
          },
          "test",
        );
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(Object, "getOwnPropertyDescriptor", originalDescriptor);
        }
      }

      assertEquals(result?.metadata, { author: "Veryfront" });
      assertEquals(hookCalls, 0);
    });

    it("round-trips every admitted string metadata key as own data", () => {
      const metadata = Object.fromEntries([
        ["__proto__", "strict-value"],
      ]) as Record<string, string>;

      const result = validateSkillFileMetadata(
        {
          name: "test",
          description: "desc",
          metadata,
        },
        "test",
      );

      assertEquals(result.metadata?.__proto__, "strict-value");
      assertEquals(Object.hasOwn(result.metadata ?? {}, "__proto__"), true);
    });

    it("rejects non-printable metadata keys and values", () => {
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              metadata: { "bad\nkey": "value" },
            },
            "test",
          ),
        TypeError,
        "printable characters",
      );
      assertThrows(
        () =>
          validateSkillFileMetadata(
            {
              name: "test",
              description: "desc",
              metadata: { key: "bad\u0000value" },
            },
            "test",
          ),
        TypeError,
        "printable characters",
      );
    });
  });
});
