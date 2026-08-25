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
  type DefaultHostedInvokeAgentContext,
  type DefaultHostedInvokeAgentToolOptions,
  deriveAgentServiceAgUiChatContext,
  type DerivedAgentServiceAgUiChatContext,
  type DerivedHostedAgUiChatContext,
  deriveHostedAgUiChatContext,
  getAgentServiceTokenFromRequest,
  getHostedServiceTokenFromRequest,
  type HostedAgentServiceRouteSetOptions,
  type HostedChatRuntimeToolAssemblyResult,
  type HostedConversationRootRunContext,
  isAgentServiceAuthError,
  isHostedServiceAuthError,
  type NormalizedAgentServiceChatRequest,
  type NormalizedHostedChatRequest,
  normalizeParsedAgentServiceChatRequest,
  normalizeParsedHostedChatRequest,
  parseAgentServiceChatRequestFromRequest,
  type ParsedAgentServiceChatRequest,
  type ParsedHostedChatRequest,
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
  // Each pair pins the alias to its hosted type in both directions, so an alias
  // that starts denoting a different shape fails the test-file typecheck.
  const _routeOptionsForward: AgentServiceRouteSetOptions<object> =
    {} as HostedAgentServiceRouteSetOptions<object>;
  const _routeOptionsBack: HostedAgentServiceRouteSetOptions<object> =
    {} as AgentServiceRouteSetOptions<object>;
  const _parsedRequestForward: ParsedAgentServiceChatRequest = {} as ParsedHostedChatRequest;
  const _parsedRequestBack: ParsedHostedChatRequest = {} as ParsedAgentServiceChatRequest;
  const _agUiContextForward: DerivedAgentServiceAgUiChatContext =
    {} as DerivedHostedAgUiChatContext;
  const _agUiContextBack: DerivedHostedAgUiChatContext = {} as DerivedAgentServiceAgUiChatContext;
  const _rootRunContextForward: AgentServiceConversationRootRunContext =
    {} as HostedConversationRootRunContext;
  const _rootRunContextBack: HostedConversationRootRunContext =
    {} as AgentServiceConversationRootRunContext;
  const _normalizedRequestForward: NormalizedAgentServiceChatRequest =
    {} as NormalizedHostedChatRequest;
  const _normalizedRequestBack: NormalizedHostedChatRequest =
    {} as NormalizedAgentServiceChatRequest;
  const _toolAssemblyForward: AgentServiceChatRuntimeToolAssemblyResult =
    {} as HostedChatRuntimeToolAssemblyResult;
  const _toolAssemblyBack: HostedChatRuntimeToolAssemblyResult =
    {} as AgentServiceChatRuntimeToolAssemblyResult;
  const _invokeContextForward: DefaultAgentServiceInvokeAgentContext =
    {} as DefaultHostedInvokeAgentContext;
  const _invokeContextBack: DefaultHostedInvokeAgentContext =
    {} as DefaultAgentServiceInvokeAgentContext;
  const _invokeOptionsForward: DefaultAgentServiceInvokeAgentToolOptions<
    DefaultHostedInvokeAgentContext
  > = {} as DefaultHostedInvokeAgentToolOptions<DefaultHostedInvokeAgentContext>;
  const _invokeOptionsBack: DefaultHostedInvokeAgentToolOptions<
    DefaultAgentServiceInvokeAgentContext
  > = {} as DefaultAgentServiceInvokeAgentToolOptions<DefaultAgentServiceInvokeAgentContext>;

  const invokeOptions: Partial<
    DefaultAgentServiceInvokeAgentToolOptions<DefaultAgentServiceInvokeAgentContext>
  > = {
    createAgentServiceSandboxTools: undefined,
  };

  assertEquals(
    invokeOptions,
    { createAgentServiceSandboxTools: undefined },
    "the invoke tool option alias keeps its hosted sandbox tool factory key",
  );
});
