import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
import { generateId, parseDuration } from "../types.js";
/** Manages pending approvals, processing decisions, and resuming workflows */
export class ApprovalManager {
    config;
    expirationTimer;
    destroyed = false;
    constructor(config) {
        this.config = {
            expirationCheckInterval: 60000,
            debug: false,
            ...config,
        };
        const interval = this.config.expirationCheckInterval ?? 0;
        if (interval > 0) {
            this.startExpirationChecker();
        }
    }
    /** Create a pending approval request */
    async createApproval(run, nodeId, waitConfig, context) {
        const payload = typeof waitConfig.payload === "function"
            ? await waitConfig.payload(context)
            : waitConfig.payload;
        const expiresAt = waitConfig.timeout
            ? new Date(Date.now() + parseDuration(waitConfig.timeout))
            : undefined;
        const approval = {
            id: generateId("apr"),
            nodeId,
            message: waitConfig.message || "Approval required",
            payload,
            approvers: waitConfig.approvers,
            requestedAt: new Date(),
            expiresAt,
            status: "pending",
        };
        logger.debug("[ApprovalManager] Creating approval", { approvalId: approval.id, runId: run.id });
        await this.config.backend.savePendingApproval(run.id, approval);
        try {
            await this.config.notifier?.(approval, run);
        }
        catch (error) {
            logger.error("[ApprovalManager] Failed to notify approvers", error);
        }
        return {
            approvalId: approval.id,
            runId: run.id,
            nodeId,
            message: approval.message,
            payload: approval.payload,
            expiresAt: approval.expiresAt,
        };
    }
    /** Get pending approval by ID */
    async getApproval(runId, approvalId) {
        // Call method on the backend directly to preserve 'this' binding
        if (this.config.backend.getPendingApproval) {
            return this.config.backend.getPendingApproval(runId, approvalId);
        }
        const all = await this.config.backend.getPendingApprovals(runId);
        return all.find((a) => a.id === approvalId) ?? null;
    }
    /** Get all pending approvals for a run */
    getPendingApprovals(runId) {
        return this.config.backend.getPendingApprovals(runId);
    }
    /** Process an approval decision */
    async processDecision(runId, approvalId, decision) {
        logger.debug("[ApprovalManager] Processing decision", {
            approvalId,
            approved: decision.approved,
        });
        const approval = await this.getApproval(runId, approvalId);
        if (!approval) {
            throw new Error(`Approval not found: ${approvalId}`);
        }
        if (approval.status !== "pending") {
            throw new Error(`Approval already processed: ${approval.status}`);
        }
        if (approval.expiresAt && new Date() > approval.expiresAt) {
            throw new Error("Approval has expired");
        }
        const approvers = approval.approvers;
        if (approvers?.length && !approvers.includes(decision.approver)) {
            throw new Error("Not authorized to approve this request");
        }
        await this.config.backend.updateApproval(runId, approvalId, decision);
        const run = await this.config.backend.getRun(runId);
        if (!run) {
            throw new Error(`Run not found: ${runId}`);
        }
        const decidedAt = new Date();
        const updatedContext = {
            ...run.context,
            [approval.nodeId]: {
                approved: decision.approved,
                approver: decision.approver,
                comment: decision.comment,
                decidedAt: decidedAt.toISOString(),
            },
        };
        const updatedNodeStates = {
            ...run.nodeStates,
            [approval.nodeId]: {
                nodeId: approval.nodeId,
                status: "completed",
                output: {
                    approved: decision.approved,
                    approver: decision.approver,
                    comment: decision.comment,
                },
                attempt: 1,
                completedAt: decidedAt,
            },
        };
        await this.config.backend.updateRun(runId, {
            context: updatedContext,
            nodeStates: updatedNodeStates,
        });
        if (decision.approved) {
            if (!this.config.executor) {
                return;
            }
            try {
                await this.config.executor.resume(runId);
            }
            catch (error) {
                logger.error("[ApprovalManager] Failed to resume workflow", error);
                throw error;
            }
            return;
        }
        await this.config.backend.updateRun(runId, {
            status: "failed",
            error: {
                message: `Approval "${approvalId}" was rejected${decision.comment ? `: ${decision.comment}` : ""}`,
            },
            completedAt: new Date(),
        });
    }
    /** Approve an approval request */
    approve(runId, approvalId, approver, comment) {
        return this.processDecision(runId, approvalId, {
            approved: true,
            approver,
            comment,
        });
    }
    /** Reject an approval request */
    reject(runId, approvalId, approver, comment) {
        return this.processDecision(runId, approvalId, {
            approved: false,
            approver,
            comment,
        });
    }
    /** List all pending approvals across workflows */
    listAllPending(filter) {
        const list = this.config.backend.listPendingApprovals;
        if (!list) {
            logger.warn("[ApprovalManager] listPendingApprovals not supported by backend");
            return Promise.resolve([]);
        }
        return list({ ...filter, status: "pending" });
    }
    /** Check and expire stale approvals */
    async checkExpiredApprovals() {
        if (this.destroyed) {
            return;
        }
        const list = this.config.backend.listPendingApprovals;
        if (!list) {
            return;
        }
        const pending = await list({ status: "pending" });
        const now = new Date();
        for (const { runId, approval } of pending) {
            if (!approval.expiresAt || now <= approval.expiresAt) {
                continue;
            }
            logger.debug("[ApprovalManager] Expiring approval", { approvalId: approval.id });
            await this.config.backend.updateApproval(runId, approval.id, {
                approved: false,
                approver: "system",
                comment: "Approval expired",
            });
            await this.config.backend.updateRun(runId, {
                status: "failed",
                error: { message: `Approval "${approval.id}" expired` },
                completedAt: new Date(),
            });
        }
    }
    startExpirationChecker() {
        this.expirationTimer = dntShim.setInterval(() => {
            this.checkExpiredApprovals().catch((error) => {
                logger.error("[ApprovalManager] Expiration check failed", error);
            });
        }, this.config.expirationCheckInterval);
    }
    /** Stop the approval manager */
    stop() {
        this.destroyed = true;
        if (!this.expirationTimer) {
            return;
        }
        clearInterval(this.expirationTimer);
        this.expirationTimer = undefined;
    }
}
