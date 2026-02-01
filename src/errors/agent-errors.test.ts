import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert";
import {
  AgentError,
  AgentIntentError,
  AgentNotFoundError,
  AgentTimeoutError,
  OrchestrationError,
} from "./agent-errors.ts";
import { ErrorCode, VeryfrontError } from "./types.ts";

describe("agent-errors", () => {
  describe("AgentError", () => {
    it("should create error with correct code", () => {
      const error = new AgentError("Agent failed");
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.name, "AgentError");
      assertEquals(error.code, ErrorCode.AGENT_ERROR);
      assertEquals(error.message, "Agent failed");
    });

    it("should include context", () => {
      const error = new AgentError("Agent failed", { agentId: "123" });
      assertEquals(error.context?.agentId, "123");
    });
  });

  describe("AgentNotFoundError", () => {
    it("should create error with agent ID in message", () => {
      const error = new AgentNotFoundError("agent-123");
      assertEquals(error.name, "AgentNotFoundError");
      assertEquals(error.code, ErrorCode.AGENT_NOT_FOUND);
      assertEquals(error.message, "Agent with ID 'agent-123' not found");
    });

    it("should include agentId in context", () => {
      const error = new AgentNotFoundError("agent-123", { extra: "data" });
      assertEquals(error.context?.agentId, "agent-123");
      assertEquals(error.context?.extra, "data");
    });
  });

  describe("AgentTimeoutError", () => {
    it("should create error with correct code", () => {
      const error = new AgentTimeoutError("Timeout after 30s");
      assertEquals(error.name, "AgentTimeoutError");
      assertEquals(error.code, ErrorCode.AGENT_TIMEOUT);
    });
  });

  describe("AgentIntentError", () => {
    it("should create error with correct code", () => {
      const error = new AgentIntentError("Intent parsing failed");
      assertEquals(error.name, "AgentIntentError");
      assertEquals(error.code, ErrorCode.AGENT_INTENT_ERROR);
    });
  });

  describe("OrchestrationError", () => {
    it("should create error with correct code", () => {
      const error = new OrchestrationError("Orchestration failed");
      assertEquals(error.name, "OrchestrationError");
      assertEquals(error.code, ErrorCode.ORCHESTRATION_ERROR);
    });
  });
});
