import * as agentMod from "#veryfront/agent";
import * as toolMod from "#veryfront/tool";
import * as platformMod from "#veryfront/platform";
import * as promptMod from "#veryfront/prompt";
import * as resourceMod from "#veryfront/resource";
import * as embeddingMod from "#veryfront/embedding/index.ts";
import * as knowledgeMod from "#veryfront/knowledge";
import * as workflowMod from "#veryfront/workflow";
import * as evalMod from "#veryfront/eval";
import * as metricsMod from "#veryfront/metrics";
import * as schemasMod from "#veryfront/schemas";
import * as chatUploadsMod from "#veryfront/chat/uploads";
import { registerDiscoveryRuntimeModules } from "./runtime-modules.ts";

registerDiscoveryRuntimeModules({
  "veryfront/agent": agentMod,
  "veryfront/tool": toolMod,
  "veryfront/platform": platformMod,
  "veryfront/prompt": promptMod,
  "veryfront/resource": resourceMod,
  "veryfront/embedding": embeddingMod,
  "veryfront/knowledge": knowledgeMod,
  "veryfront/workflow": workflowMod,
  "veryfront/eval": evalMod,
  "veryfront/metrics": metricsMod,
  "veryfront/schemas": schemasMod,
  "veryfront/chat/uploads": chatUploadsMod,
});
