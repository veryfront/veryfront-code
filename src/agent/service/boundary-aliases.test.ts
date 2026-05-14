import { assertEquals, assertInstanceOf } from "@std/assert";
import {
  AgentServiceAuthError,
  type AgentServiceChatRuntimeToolAssemblyResult,
  type AgentServiceConversationRootRunContext,
  type AgentServiceRouteSetOptions,
  appendAgentServiceChildMirrorChunk,
  appendHostedChildMirrorChunk,
  buildParsedAgentServiceAgUiRequest,
  buildParsedAgentServiceChatRequest,
  buildParsedHostedAgUiRequest,
  buildParsedHostedChatRequest,
  createAgentServiceAgUiValidationErrorResponse,
  createAgentServiceAuth,
  createAgentServiceRouteSet,
  createHostedAgentServiceRouteSet,
  createHostedAgUiValidationErrorResponse,
  createHostedServiceAuth,
  type DefaultAgentServiceInvokeAgentContext,
  type DefaultAgentServiceInvokeAgentToolOptions,
  deriveAgentServiceAgUiChatContext,
  type DerivedAgentServiceAgUiChatContext,
  deriveHostedAgUiChatContext,
  getAgentServiceTokenFromRequest,
  getHostedServiceTokenFromRequest,
  isAgentServiceAuthError,
  isHostedServiceAuthError,
  type NormalizedAgentServiceChatRequest,
  normalizeParsedAgentServiceChatRequest,
  normalizeParsedHostedChatRequest,
  parseAgentServiceChatRequestFromRequest,
  type ParsedAgentServiceChatRequest,
  parseHostedChatRequestFromRequest,
  prepareAgentServiceChatExecution,
  prepareAgentServiceChatRuntimeCreationOptions,
  prepareAgentServiceChatRuntimeMessages,
  prepareAgentServiceConversationRootRunContext,
  prepareHostedChatExecution,
  prepareHostedChatRuntimeCreationOptions,
  prepareHostedChatRuntimeMessages,
  prepareHostedConversationRootRunContext,
  toMirroredAgentServiceStreamPart,
  toMirroredHostedStreamPart,
} from "../index.ts";
import { HostedServiceAuthError } from "./auth.ts";

Deno.test("agent-service boundary aliases point at hosted compatibility exports", () => {
  assertEquals(createAgentServiceRouteSet, createHostedAgentServiceRouteSet);
  assertEquals(buildParsedAgentServiceChatRequest, buildParsedHostedChatRequest);
  assertEquals(parseAgentServiceChatRequestFromRequest, parseHostedChatRequestFromRequest);
  assertEquals(buildParsedAgentServiceAgUiRequest, buildParsedHostedAgUiRequest);
  assertEquals(
    createAgentServiceAgUiValidationErrorResponse,
    createHostedAgUiValidationErrorResponse,
  );
  assertEquals(deriveAgentServiceAgUiChatContext, deriveHostedAgUiChatContext);
  assertEquals(
    prepareAgentServiceConversationRootRunContext,
    prepareHostedConversationRootRunContext,
  );
  assertEquals(normalizeParsedAgentServiceChatRequest, normalizeParsedHostedChatRequest);
  assertEquals(prepareAgentServiceChatExecution, prepareHostedChatExecution);
  assertEquals(
    prepareAgentServiceChatRuntimeCreationOptions,
    prepareHostedChatRuntimeCreationOptions,
  );
  assertEquals(prepareAgentServiceChatRuntimeMessages, prepareHostedChatRuntimeMessages);
  assertEquals(appendAgentServiceChildMirrorChunk, appendHostedChildMirrorChunk);
  assertEquals(toMirroredAgentServiceStreamPart, toMirroredHostedStreamPart);
  assertEquals(createAgentServiceAuth, createHostedServiceAuth);
  assertEquals(getAgentServiceTokenFromRequest, getHostedServiceTokenFromRequest);
  assertEquals(isAgentServiceAuthError, isHostedServiceAuthError);
  assertEquals(AgentServiceAuthError, HostedServiceAuthError);

  const error = new AgentServiceAuthError(401, "Token required");
  assertInstanceOf(error, HostedServiceAuthError);
  assertEquals(isAgentServiceAuthError(error), true);
});

Deno.test("agent-service boundary aliases are available as types", () => {
  const routeOptions: Partial<AgentServiceRouteSetOptions<object>> = {};
  const parsedRequest: Partial<ParsedAgentServiceChatRequest> = {};
  const agUiContext: Partial<DerivedAgentServiceAgUiChatContext> = {};
  const rootRunContext: Partial<AgentServiceConversationRootRunContext> = {};
  const normalizedRequest: Partial<NormalizedAgentServiceChatRequest> = {};
  const toolAssembly: Partial<AgentServiceChatRuntimeToolAssemblyResult> = {};
  const invokeOptions: Partial<
    DefaultAgentServiceInvokeAgentToolOptions<DefaultAgentServiceInvokeAgentContext>
  > = {
    createAgentServiceSandboxTools: undefined,
  };

  assertEquals(routeOptions, {});
  assertEquals(parsedRequest, {});
  assertEquals(agUiContext, {});
  assertEquals(rootRunContext, {});
  assertEquals(normalizedRequest, {});
  assertEquals(toolAssembly, {});
  assertEquals(invokeOptions, { createAgentServiceSandboxTools: undefined });
});
