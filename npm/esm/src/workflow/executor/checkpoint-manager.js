import { logger } from "../../utils/index.js";
import { generateId } from "../types.js";
export class CheckpointManager {
    config;
    constructor(config) {
        this.config = { debug: false, ...config };
    }
    async save(runId, checkpoint) {
        logger.debug("[CheckpointManager] Saving checkpoint", { checkpointId: checkpoint.id, runId });
        await this.config.backend.saveCheckpoint(runId, checkpoint);
    }
    async createCheckpoint(runId, nodeId, context, nodeStates) {
        const checkpoint = {
            id: generateId("cp"),
            nodeId,
            timestamp: new Date(),
            context: structuredClone(context),
            nodeStates: structuredClone(nodeStates),
        };
        await this.save(runId, checkpoint);
        return checkpoint;
    }
    getLatest(runId) {
        return this.config.backend.getLatestCheckpoint(runId);
    }
    async getAll(runId) {
        const getCheckpoints = this.config.backend.getCheckpoints;
        if (getCheckpoints) {
            return getCheckpoints(runId);
        }
        const latest = await this.getLatest(runId);
        return latest ? [latest] : [];
    }
    async prepareResume(runId, nodes, fromCheckpoint) {
        const checkpoint = fromCheckpoint
            ? (await this.getAll(runId)).find((c) => c.id === fromCheckpoint) ?? null
            : await this.getLatest(runId);
        if (!checkpoint)
            return null;
        const startFromNode = this.findNextNode(nodes, checkpoint);
        if (!startFromNode)
            return null;
        return {
            checkpoint,
            startFromNode,
            context: structuredClone(checkpoint.context),
            nodeStates: structuredClone(checkpoint.nodeStates),
        };
    }
    findNextNode(nodes, checkpoint) {
        const { nodeId: completedNodeId, nodeStates } = checkpoint;
        const nodeIndex = new Map();
        nodes.forEach((node, index) => nodeIndex.set(node.id, index));
        const checkpointIndex = nodeIndex.get(completedNodeId);
        if (checkpointIndex === undefined) {
            return nodes[0]?.id ?? null;
        }
        for (let i = checkpointIndex + 1; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node)
                continue;
            const state = nodeStates[node.id];
            if (!state || state.status === "pending")
                return node.id;
        }
        for (const node of nodes) {
            if (!node.dependsOn?.includes(completedNodeId))
                continue;
            const state = nodeStates[node.id];
            if (!state || state.status === "pending")
                return node.id;
        }
        return null;
    }
    shouldCheckpoint(node) {
        const { config } = node;
        if (config.checkpoint !== undefined)
            return config.checkpoint;
        const checkpointDefaults = {
            wait: true,
            parallel: true,
            subWorkflow: true,
            branch: false,
        };
        if (config.type === "step") {
            return "agent" in config && !!config.agent;
        }
        return checkpointDefaults[config.type] ?? false;
    }
    async cleanup(runId, keepCount = 5) {
        const all = await this.getAll(runId);
        if (all.length <= keepCount)
            return;
        all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        const idsToDelete = all.slice(keepCount).map((c) => c.id);
        if (idsToDelete.length === 0)
            return;
        logger.debug("[CheckpointManager] Cleaning up old checkpoints", {
            count: idsToDelete.length,
            runId,
        });
        const { backend } = this.config;
        if (backend.deleteCheckpoints) {
            await backend.deleteCheckpoints(runId, idsToDelete);
            return;
        }
        if (backend.deleteCheckpoint) {
            for (const id of idsToDelete) {
                await backend.deleteCheckpoint(runId, id);
            }
        }
    }
}
