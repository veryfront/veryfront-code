import {
  createAgentServiceFormInputTool,
  createAgentServiceProjectSteering,
  createDefaultAgentServiceChatRuntime,
  createDefaultAgentServiceInvokeAgentTool,
  createDefaultAgentServiceProjectSteeringRefresh,
  createDefaultHostedChatRuntime,
  createDefaultHostedInvokeAgentTool,
  createDefaultHostedProjectSteeringRefresh,
  createHostedAgentProjectSteering,
  createHostedFormInputTool,
  createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions,
  createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions,
  fetchDefaultAgentServiceProjectSteering,
  fetchDefaultHostedProjectSteering,
  prepareVeryfrontCloudAgentServiceChatExecution,
  prepareVeryfrontCloudHostedChatExecution,
  runPreparedAgentServiceChatExecutionDetached,
  runPreparedHostedChatExecutionDetached,
  streamPreparedAgentServiceChatExecutionToAgUiResponse,
  streamPreparedHostedChatExecutionToAgUiResponse,
} from "./index.ts";

Deno.test("agent-service API names alias existing hosted runtime primitives", () => {
  if (createDefaultAgentServiceChatRuntime !== createDefaultHostedChatRuntime) {
    throw new Error("Expected chat runtime alias to reference the hosted implementation");
  }
  if (createDefaultAgentServiceInvokeAgentTool !== createDefaultHostedInvokeAgentTool) {
    throw new Error("Expected invoke_agent alias to reference the hosted implementation");
  }
  if (
    createDefaultAgentServiceProjectSteeringRefresh !== createDefaultHostedProjectSteeringRefresh
  ) {
    throw new Error(
      "Expected project steering refresh alias to reference the hosted implementation",
    );
  }
  if (fetchDefaultAgentServiceProjectSteering !== fetchDefaultHostedProjectSteering) {
    throw new Error("Expected project steering fetch alias to reference the hosted implementation");
  }
  if (createAgentServiceProjectSteering !== createHostedAgentProjectSteering) {
    throw new Error("Expected project steering alias to reference the hosted implementation");
  }
  if (createAgentServiceFormInputTool !== createHostedFormInputTool) {
    throw new Error("Expected form input alias to reference the hosted implementation");
  }
  if (
    createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions !==
      createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions
  ) {
    throw new Error(
      "Expected prepared runtime options alias to reference the hosted implementation",
    );
  }
  if (prepareVeryfrontCloudAgentServiceChatExecution !== prepareVeryfrontCloudHostedChatExecution) {
    throw new Error("Expected chat preparation alias to reference the hosted implementation");
  }
  if (runPreparedAgentServiceChatExecutionDetached !== runPreparedHostedChatExecutionDetached) {
    throw new Error("Expected detached execution alias to reference the hosted implementation");
  }
  if (
    streamPreparedAgentServiceChatExecutionToAgUiResponse !==
      streamPreparedHostedChatExecutionToAgUiResponse
  ) {
    throw new Error("Expected AG-UI stream alias to reference the hosted implementation");
  }
});
