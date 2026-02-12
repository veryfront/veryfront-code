/**
 * Tests for shared catalog
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAllIntegrations,
  getIntegrationSelectOptions,
  getIntegrationSelectOptionsWithHeaders,
  getPopularIntegrations,
  getTemplateSelectOptions,
  INTEGRATION_CATEGORIES,
  TEMPLATES,
} from "./catalog.ts";

describe("catalog", () => {
  describe("TEMPLATES", () => {
    it("contains expected templates", () => {
      assertEquals(TEMPLATES.length, 7);
      const ids = TEMPLATES.map((t) => t.id);
      assertEquals(ids, [
        "minimal",
        "chat",
        "rag",
        "workflow",
        "multi-agent",
        "coding-agent",
        "saas",
      ]);
    });

    it("each template has required properties", () => {
      for (const template of TEMPLATES) {
        assertExists(template.id);
        assertExists(template.label);
        assertExists(template.description);
      }
    });
  });

  describe("getTemplateSelectOptions", () => {
    it("returns SelectOption array with correct structure", () => {
      const options = getTemplateSelectOptions();
      assertEquals(options.length, TEMPLATES.length);

      for (let i = 0; i < options.length; i++) {
        assertEquals(options[i]!.value, TEMPLATES[i]!.id);
        assertEquals(options[i]!.label, TEMPLATES[i]!.label);
        assertEquals(options[i]!.description, TEMPLATES[i]!.description);
      }
    });
  });

  describe("INTEGRATION_CATEGORIES", () => {
    it("contains expected categories", () => {
      const categoryNames = INTEGRATION_CATEGORIES.map((c) => c.name);
      assertEquals(categoryNames, [
        "Communication",
        "Productivity",
        "Development",
        "Storage",
        "Infrastructure",
        "Sales & CRM",
        "Support",
        "Finance",
        "Marketing",
        "Design",
        "AI Providers",
      ]);
    });

    it("each category has integrations with required properties", () => {
      for (const category of INTEGRATION_CATEGORIES) {
        assertExists(category.name);
        assertExists(category.integrations);

        for (const integration of category.integrations) {
          assertExists(integration.id);
          assertExists(integration.label);
          assertExists(integration.description);
        }
      }
    });
  });

  describe("getAllIntegrations", () => {
    it("returns flat array of all integrations", () => {
      const all = getAllIntegrations();
      const expectedCount = INTEGRATION_CATEGORIES.reduce(
        (sum, cat) => sum + cat.integrations.length,
        0,
      );
      assertEquals(all.length, expectedCount);
    });

    it("includes integrations from all categories", () => {
      const all = getAllIntegrations();
      const ids = all.map((i) => i.id);

      // Check some integrations from different categories
      assertEquals(ids.includes("gmail"), true);
      assertEquals(ids.includes("notion"), true);
      assertEquals(ids.includes("github"), true);
      assertEquals(ids.includes("drive"), true);
      assertEquals(ids.includes("stripe"), true);
    });
  });

  describe("getIntegrationSelectOptions", () => {
    it("returns SelectOption array for all integrations", () => {
      const options = getIntegrationSelectOptions();
      const all = getAllIntegrations();
      assertEquals(options.length, all.length);

      for (let i = 0; i < options.length; i++) {
        assertEquals(options[i]!.value, all[i]!.id);
        assertEquals(options[i]!.label, all[i]!.label);
        assertEquals(options[i]!.description, all[i]!.description);
      }
    });
  });

  describe("getPopularIntegrations", () => {
    it("returns subset of popular integrations", () => {
      const popular = getPopularIntegrations();
      assertEquals(popular.length, 8);
    });

    it("includes expected popular integrations", () => {
      const popular = getPopularIntegrations();
      const ids = popular.map((i) => i.id);
      assertEquals(ids, [
        "gmail",
        "slack",
        "notion",
        "github",
        "calendar",
        "drive",
        "jira",
        "linear",
      ]);
    });

    it("returns valid IntegrationOption objects", () => {
      const popular = getPopularIntegrations();
      for (const integration of popular) {
        assertExists(integration.id);
        assertExists(integration.label);
        assertExists(integration.description);
      }
    });
  });

  describe("getIntegrationSelectOptionsWithHeaders", () => {
    it("includes category headers", () => {
      const options = getIntegrationSelectOptionsWithHeaders();
      const headers = options.filter((o) => o.isHeader);
      assertEquals(headers.length, INTEGRATION_CATEGORIES.length);
    });

    it("header values have __header_ prefix", () => {
      const options = getIntegrationSelectOptionsWithHeaders();
      const headers = options.filter((o) => o.isHeader);

      for (const header of headers) {
        assertEquals(header.value.startsWith("__header_"), true);
      }
    });

    it("includes all integrations plus headers", () => {
      const options = getIntegrationSelectOptionsWithHeaders();
      const integrations = options.filter((o) => !o.isHeader);
      const all = getAllIntegrations();
      assertEquals(integrations.length, all.length);
    });

    it("headers have formatted labels with dashes", () => {
      const options = getIntegrationSelectOptionsWithHeaders();
      const headers = options.filter((o) => o.isHeader);

      for (const header of headers) {
        assertEquals(header.label.startsWith("── "), true);
        assertEquals(header.label.endsWith(" ──"), true);
      }
    });
  });
});
