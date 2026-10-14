/**
 * Deterministic supplementary checks for canonical control payloads.
 *
 * Run the selected structural JSON Schema separately. This module accepts a
 * payload, a CloudEvent/typed-row wrapper, or an array of those values. It follows
 * only known source fields and never interprets arbitrary prompts, model tool
 * schemas, provider blocks, authorization records or forwarded JSON as events.
 */

const BOUNDARY_BYTES = 2 * 1024 * 1024;
const TOOL_SCHEMA_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const own = (value, key) => Object.hasOwn(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const jsonBytes = value => {
  try {
    const encoded = JSON.stringify(value);
    // Non-JSON values and toJSON hooks may produce no serialized string.
    return typeof encoded === 'string' ? encoder.encode(encoded).byteLength : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export const PAYLOAD_SEMANTIC_COVERAGE = Object.freeze([
  'context-compaction-budget-and-before-after-inequalities',
  'v1-loaded-tool-names-code-unit-order',
  'provider-replay-position-alignment-order-range-and-group-counts',
  'provider-boundary-tool-call-id-uniqueness-and-2mib-json-bytes',
  'request-tools-parameters-inputSchema-outputSchema-16kib-json-bytes',
  'runtime-project-target-branch-selection',
  'managed-runtime-source-project-environment-release-agreement',
  'integration-authorization-binding-integration-uniqueness',
  'fresh-runtime-retry-kind-attempt-presence',
]);

export const PAYLOAD_SEMANTIC_LIMITATIONS = Object.freeze([
  'Structural types, requiredness, string grammar/length, nullability, versions, additional properties and API/Code/view profile selection remain the selected JSON Schema contract.',
  'No run/project/actor/writer authorization, lease/generation liveness, receiver or dispatch matching, actual run message identity, protocol negotiation/order, history ordering or duplicate acceptance is proved.',
  'No provider-native Anthropic replay validator, opaque metadata depth/node/byte gate, model mandatory sink, tool-argument parser, authorization builder/current reauthorization, upload allowance or research-purpose sanitizer is executed.',
  'Only boundary and individual AgentStreamTool schema-document byte limits are checked. Other event/request/context/body size gates and UTF-16 length/trim source semantics remain external.',
  'Request/start tool-schema byte checks do not apply to model.input function-tool inputSchema; the source model schema deliberately admits arbitrary JSON without that 16KiB tool-document bound.',
  'Absent/unrecognized retry kind is left to the explicitly selected legacy/structural profile. Recognized fresh kinds enforce their current attempt rules.',
  'The boundary byte check measures the supplied canonical JSON payload. Source admission/backfill must separately retain the pre-discriminator-substitution byte-budget rule.',
]);

/** Return deterministic violation messages without mutating the supplied value. */
export function validatePayloadSemantics(value) {
  const violations = [];
  const issue = (path, message) => violations.push(`${path}: ${message}`);

  const checkRuntimeProject = (project, path) => {
    if (!isRecord(project)) return;
    const kind = project.runtimeTargetKind;
    const hasEnvironment = Boolean(project.runtimeTargetEnvironmentId);
    const hasBranch = Boolean(project.runtimeTargetBranchId);
    if (kind === undefined || kind === null || kind === 'main_branch') {
      if (hasEnvironment || hasBranch) issue(path, 'main_branch or absent runtimeTargetKind permits no environment or branch ID');
    } else if (kind === 'environment') {
      if (!hasEnvironment || hasBranch) issue(path, 'environment runtimeTargetKind requires an environment ID and no branch ID');
    } else if (kind === 'preview_branch') {
      if (!hasBranch || hasEnvironment) issue(path, 'preview_branch runtimeTargetKind requires a branch ID and no environment ID');
    }
  };

  const checkManagedSource = (snapshot, path) => {
    if (!isRecord(snapshot)) return;
    const binding = snapshot.sourceBinding;
    const project = snapshot.sourceProject;
    const source = snapshot.agentSource;
    checkRuntimeProject(project, `${path}.sourceProject`);
    if (!isRecord(binding) || !isRecord(project) || !isRecord(source)) return;
    if (project.projectId !== binding.projectId) issue(`${path}.sourceProject.projectId`, 'must equal sourceBinding.projectId');
    if (project.runtimeTargetKind !== 'environment') issue(`${path}.sourceProject.runtimeTargetKind`, 'managed source project requires environment');
    if (project.runtimeTargetEnvironmentId !== binding.environmentId) issue(`${path}.sourceProject.runtimeTargetEnvironmentId`, 'must equal sourceBinding.environmentId');
    if (project.executionEnvironmentId !== undefined && project.executionEnvironmentId !== binding.environmentId) issue(`${path}.sourceProject.executionEnvironmentId`, 'must equal sourceBinding.environmentId when present');
    if (source.type !== 'environment') issue(`${path}.agentSource.type`, 'managed source requires environment');
    if (source.releaseId !== binding.releaseId) issue(`${path}.agentSource.releaseId`, 'must equal sourceBinding.releaseId');
  };

  const checkRequest = (payload, path) => {
    if (Array.isArray(payload.tools)) {
      payload.tools.forEach((tool, index) => {
        if (!isRecord(tool)) return;
        for (const field of ['parameters', 'inputSchema', 'outputSchema']) {
          if (tool[field] !== undefined && jsonBytes(tool[field]) > TOOL_SCHEMA_BYTES) issue(`${path}.tools[${index}].${field}`, 'serialized JSON must be at most 16384 UTF-8 bytes');
        }
      });
    }
    checkManagedSource(payload.managedRuntimeSource, `${path}.managedRuntimeSource`);
    if (Array.isArray(payload.integrationConnectionBindings)) {
      const integrations = new Set();
      payload.integrationConnectionBindings.forEach((binding, index) => {
        if (!isRecord(binding) || typeof binding.integration !== 'string') return;
        if (integrations.has(binding.integration)) issue(`${path}.integrationConnectionBindings[${index}].integration`, 'integration values must be unique');
        integrations.add(binding.integration);
      });
    }
  };

  const checkReplay = (payload, path) => {
    const blocks = payload.providerBlocks;
    const positions = payload.providerBlockPositions;
    if (Array.isArray(blocks) && Array.isArray(positions) && blocks.length !== positions.length) issue(`${path}.providerBlockPositions`, 'must align one-to-one with providerBlocks');
    if (Array.isArray(blocks) && isNumber(payload.totalPartCount) && payload.totalPartCount < blocks.length) issue(`${path}.totalPartCount`, 'cannot be lower than providerBlocks length');
    if (Array.isArray(positions)) {
      positions.forEach((position, index) => {
        if (!isNumber(position)) return;
        if (index > 0 && isNumber(positions[index - 1]) && position <= positions[index - 1]) issue(`${path}.providerBlockPositions[${index}]`, 'positions must be strictly increasing');
        if (isNumber(payload.totalPartCount) && position >= payload.totalPartCount) issue(`${path}.providerBlockPositions[${index}]`, 'position must be lower than totalPartCount');
      });
    }
    const counts = payload.providerMessageBlockCounts;
    if (Array.isArray(blocks) && Array.isArray(counts) && counts.every(isNumber) && counts.reduce((sum, count) => sum + count, 0) !== blocks.length) issue(`${path}.providerMessageBlockCounts`, 'counts must sum to providerBlocks length');
  };

  const checkBoundary = (payload, path) => {
    if (jsonBytes(payload) > BOUNDARY_BYTES) issue(path, 'provider replay boundary serialized JSON must be at most 2097152 UTF-8 bytes');
    if (!Array.isArray(payload.invokeAgentToolCalls)) return;
    const callIds = new Set();
    payload.invokeAgentToolCalls.forEach((call, index) => {
      if (!isRecord(call) || typeof call.toolCallId !== 'string') return;
      if (callIds.has(call.toolCallId)) issue(`${path}.invokeAgentToolCalls[${index}].toolCallId`, 'delegated toolCallId values must be unique');
      callIds.add(call.toolCallId);
    });
  };

  const checkCompaction = (payload, path) => {
    if (isNumber(payload.tokenBudget) && isNumber(payload.reserveTokens)) {
      if (payload.reserveTokens >= payload.tokenBudget) issue(`${path}.reserveTokens`, 'must be lower than tokenBudget');
      if (isNumber(payload.tokensAfter) && payload.tokensAfter > payload.tokenBudget - payload.reserveTokens) issue(`${path}.tokensAfter`, 'must fit tokenBudget minus reserveTokens');
    }
    if (isNumber(payload.tokensAfter) && isNumber(payload.tokensBefore) && payload.tokensAfter > payload.tokensBefore) issue(`${path}.tokensAfter`, 'cannot exceed tokensBefore');
  };

  const checkToolExposure = (payload, path) => {
    if (payload.version !== 1 || !Array.isArray(payload.loadedToolNames)) return;
    for (let index = 1; index < payload.loadedToolNames.length; index += 1) {
      const previous = payload.loadedToolNames[index - 1];
      const current = payload.loadedToolNames[index];
      // Native JS comparison is UTF-16 code-unit order, independent of locale.
      if (typeof previous === 'string' && typeof current === 'string' && previous > current) issue(`${path}.loadedToolNames[${index}]`, 'version 1 names must be sorted by JavaScript code-unit order');
    }
  };

  const checkRetry = (payload, path) => {
    if (payload.kind === 'server_restart') {
      if (own(payload, 'attempt')) issue(`${path}.attempt`, 'server_restart retry must omit attempt');
    } else if (['pre_stream', 'replay_conflict', 'transport_recovery'].includes(payload.kind)) {
      if (!own(payload, 'attempt') || !isNumber(payload.attempt)) issue(`${path}.attempt`, 'fresh non-server_restart retry requires a finite numeric attempt');
    }
  };

  const visit = (candidate, path) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(candidate)) return;
    if (candidate.specversion === '1.0' && isRecord(candidate.data)) {
      visit(candidate.data, `${path}.data`);
      return;
    }
    switch (candidate.type) {
      case 'com.veryfront.run.context.compacted': checkCompaction(candidate, path); return;
      case 'com.veryfront.run.tool.exposure.checkpointed': checkToolExposure(candidate, path); return;
      case 'com.veryfront.run.provider.replay.checkpointed': checkReplay(candidate, path); return;
      case 'com.veryfront.run.provider.replay.boundary.recorded': checkBoundary(candidate, path); return;
      case 'com.veryfront.run.requested':
      case 'com.veryfront.run.enqueued': checkRequest(candidate, path); return;
      case 'com.veryfront.run.runtime.retry.recorded': checkRetry(candidate, path); return;
      default:
        if (own(candidate, 'event_type') && isRecord(candidate.payload)) visit(candidate.payload, `${path}.payload`);
    }
  };

  visit(value, '$');
  return violations;
}

/**
 * Materialize the companion deterministic case format from saved control
 * examples. $repeat markers exist only in test-case mutation values, never in
 * validated production payloads. Large fixtures stay small on disk.
 */
export function materializePayloadSemanticCase(testCase, fixtures) {
  const corpus = Array.isArray(fixtures) ? fixtures : fixtures.examples;
  const fixture = corpus.find(example => example.id === testCase.baseExampleId);
  if (!fixture) throw new Error(`Missing semantic case base example: ${testCase.baseExampleId}`);
  const expand = value => {
    if (Array.isArray(value)) return value.map(expand);
    if (!isRecord(value)) return value;
    if (Object.keys(value).length === 1 && isRecord(value.$repeat)) {
      const { text, count, prefix = '', suffix = '' } = value.$repeat;
      if (typeof text !== 'string' || !Number.isSafeInteger(count) || count < 0 || typeof prefix !== 'string' || typeof suffix !== 'string') throw new Error('Invalid deterministic $repeat fixture marker');
      return prefix + text.repeat(count) + suffix;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expand(entry)]));
  };
  let payload = structuredClone(fixture.data);
  for (const mutation of testCase.mutations ?? []) {
    if (!Array.isArray(mutation.path) || mutation.path.length === 0) throw new Error('Semantic case mutation path must name a field');
    let parent = payload;
    for (const key of mutation.path.slice(0, -1)) {
      if (!isRecord(parent) && !Array.isArray(parent)) throw new Error('Semantic case mutation crosses a non-object value');
      if (!own(parent, key)) parent[key] = {};
      parent = parent[key];
    }
    const key = mutation.path.at(-1);
    if (mutation.op === 'set') parent[key] = expand(mutation.value);
    else if (mutation.op === 'delete') delete parent[key];
    else throw new Error(`Unsupported semantic case mutation: ${mutation.op}`);
  }
  if (testCase.wrap === 'cloud-event-data') payload = { specversion: '1.0', type: payload.type, data: payload };
  else if (testCase.wrap === 'typed-row-payload') payload = { event_type: payload.type, payload };
  else if (testCase.wrap === 'array') payload = [payload];
  return payload;
}
