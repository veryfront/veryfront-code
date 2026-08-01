import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import type { ApprovalDecision, PendingApproval } from "#veryfront/workflow/types.ts";
import { parsePendingApprovalResponse } from "./workflow-wire.ts";

/** Options accepted by use approval. */
export interface UseApprovalOptions {
  runId: string;
  approvalId: string;
  apiBase?: string;
  approver?: string;
  onDecision?: (decision: ApprovalDecision) => void;
  onError?: (error: Error) => void;
}

/** Result returned from use approval. */
export interface UseApprovalResult {
  approval: PendingApproval | null;
  approve: (comment?: string) => Promise<void>;
  reject: (comment?: string) => Promise<void>;
  submitDecision: (decision: ApprovalDecision) => Promise<void>;
  isSubmitting: boolean;
  isLoading: boolean;
  error: Error | null;
  isPending: boolean;
  isResolved: boolean;
}

interface ApprovalIdentity {
  readonly apiBase: string;
  readonly runId: string;
  readonly approvalId: string;
  active: boolean;
  loadController: AbortController | null;
  submitControllers: Set<AbortController>;
  mutationTail: Promise<void>;
  pendingMutations: number;
  latestApproval: PendingApproval | null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function approvalAbortError(cause?: unknown): Error {
  if (cause instanceof Error && cause.name === "AbortError") return cause;
  const error = new Error("Approval request no longer belongs to the committed identity");
  error.name = "AbortError";
  return error;
}

/** Manage workflow approval interactions. */
export function useApproval(options: UseApprovalOptions): UseApprovalResult {
  const {
    runId,
    approvalId,
    apiBase = "/api/workflows",
    approver = "unknown",
    onDecision,
    onError,
  } = options;

  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const committedIdentityRef = useRef<ApprovalIdentity | null>(null);
  const committedLoadErrorRef = useRef(onError);
  const identity = useMemo<ApprovalIdentity>(() => ({
    apiBase,
    runId,
    approvalId,
    active: false,
    loadController: null,
    submitControllers: new Set(),
    mutationTail: Promise.resolve(),
    pendingMutations: 0,
    latestApproval: null,
  }), [apiBase, runId, approvalId]);

  useEffect(() => {
    committedLoadErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    committedIdentityRef.current = identity;
    identity.active = true;
    identity.latestApproval = null;
    setApproval(null);
    setError(null);
    setIsSubmitting(false);

    if (!identity.runId || !identity.approvalId) {
      setIsLoading(false);
      return () => {
        identity.active = false;
        if (committedIdentityRef.current === identity) committedIdentityRef.current = null;
      };
    }

    const controller = new AbortController();
    identity.loadController = controller;
    setIsLoading(true);

    async function fetchApproval(): Promise<PendingApproval | null> {
      try {
        const response = await fetch(
          `${identity.apiBase}/runs/${encodeURIComponent(identity.runId)}/approvals/${
            encodeURIComponent(identity.approvalId)
          }`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to fetch approval: ${response.status}`,
            status: response.status,
          });
        }

        const data = parsePendingApprovalResponse(await response.json());
        if (data.id !== identity.approvalId) {
          throw REQUEST_ERROR.create({
            detail: "Approval response identity does not match the requested approval",
            status: 502,
          });
        }
        if (
          controller.signal.aborted || !identity.active ||
          committedIdentityRef.current !== identity
        ) return null;
        identity.latestApproval = data;
        setApproval(data);
        setError(null);
        return data;
      } catch (err) {
        if (
          controller.signal.aborted || !identity.active ||
          committedIdentityRef.current !== identity ||
          (err instanceof Error && err.name === "AbortError")
        ) return null;
        const fetchError = toError(err);
        setError(fetchError);
        committedLoadErrorRef.current?.(fetchError);
        return null;
      } finally {
        if (
          !controller.signal.aborted && identity.active &&
          committedIdentityRef.current === identity
        ) {
          setIsLoading(false);
        }
        if (identity.loadController === controller) identity.loadController = null;
      }
    }

    void fetchApproval();

    return () => {
      identity.active = false;
      controller.abort();
      if (identity.loadController === controller) identity.loadController = null;
      for (const submitController of identity.submitControllers) submitController.abort();
      if (committedIdentityRef.current === identity) committedIdentityRef.current = null;
    };
  }, [identity]);

  const submitDecision = useCallback(
    (decision: ApprovalDecision): Promise<void> => {
      if (!runId || !approvalId) return Promise.resolve();
      if (!identity.active || committedIdentityRef.current !== identity) {
        return Promise.reject(approvalAbortError());
      }

      const submittedDecision = { ...decision };
      identity.pendingMutations += 1;
      setIsSubmitting(true);
      setError(null);
      if (identity.loadController) {
        identity.loadController.abort();
        identity.loadController = null;
        setIsLoading(false);
      }

      const execute = async (): Promise<void> => {
        if (!identity.active || committedIdentityRef.current !== identity) {
          throw approvalAbortError();
        }

        const controller = new AbortController();
        identity.submitControllers.add(controller);
        try {
          const response = await fetch(
            `${identity.apiBase}/runs/${encodeURIComponent(identity.runId)}/approvals/${
              encodeURIComponent(identity.approvalId)
            }`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(submittedDecision),
              signal: controller.signal,
            },
          );

          if (!response.ok) {
            throw REQUEST_ERROR.create({
              detail: `Failed to submit decision: ${response.status}`,
              status: response.status,
            });
          }

          if (
            controller.signal.aborted || !identity.active ||
            committedIdentityRef.current !== identity
          ) throw approvalAbortError();

          onDecision?.(submittedDecision);

          if (!identity.latestApproval) {
            try {
              const reconcileResponse = await fetch(
                `${identity.apiBase}/runs/${encodeURIComponent(identity.runId)}/approvals/${
                  encodeURIComponent(identity.approvalId)
                }`,
                { signal: controller.signal },
              );
              if (!reconcileResponse.ok) {
                throw REQUEST_ERROR.create({
                  detail:
                    `Decision accepted but approval reconciliation failed: ${reconcileResponse.status}`,
                  status: reconcileResponse.status,
                });
              }
              const reconciled = parsePendingApprovalResponse(await reconcileResponse.json());
              if (reconciled.id !== identity.approvalId) {
                throw REQUEST_ERROR.create({
                  detail: "Approval reconciliation identity does not match the requested approval",
                  status: 502,
                });
              }
              if (
                controller.signal.aborted || !identity.active ||
                committedIdentityRef.current !== identity
              ) return;
              identity.latestApproval = reconciled;
            } catch (err) {
              if (
                controller.signal.aborted || !identity.active ||
                committedIdentityRef.current !== identity ||
                (err instanceof Error && err.name === "AbortError")
              ) return;
              const reconciliationError = toError(err);
              setError(reconciliationError);
              onError?.(reconciliationError);
              return;
            }
          }

          if (identity.latestApproval) {
            identity.latestApproval = {
              ...identity.latestApproval,
              status: submittedDecision.approved ? "approved" : "rejected",
              decidedAt: identity.latestApproval.decidedAt ?? new Date(),
              decidedBy: submittedDecision.approver,
              comment: submittedDecision.comment,
            };
            setApproval(identity.latestApproval);
          }
          setError(null);
        } catch (err) {
          if (
            controller.signal.aborted || !identity.active ||
            committedIdentityRef.current !== identity ||
            (err instanceof Error && err.name === "AbortError")
          ) throw approvalAbortError(err);

          const submitError = toError(err);
          setError(submitError);
          onError?.(submitError);
          throw submitError;
        } finally {
          identity.submitControllers.delete(controller);
        }
      };

      const operation = identity.mutationTail.then(execute, execute);
      identity.mutationTail = operation.then(() => undefined, () => undefined);
      return operation.finally(() => {
        identity.pendingMutations -= 1;
        if (identity.active && committedIdentityRef.current === identity) {
          setIsSubmitting(identity.pendingMutations > 0);
        }
      });
    },
    [runId, approvalId, identity, onDecision, onError],
  );

  const approve = useCallback(
    async (comment?: string): Promise<void> => {
      return submitDecision({ approved: true, approver, comment });
    },
    [submitDecision, approver],
  );

  const reject = useCallback(
    async (comment?: string): Promise<void> => {
      return submitDecision({ approved: false, approver, comment });
    },
    [submitDecision, approver],
  );

  const ownsState = identity.active && committedIdentityRef.current === identity;
  const visibleApproval = ownsState ? approval : null;
  const visibleIsPending = visibleApproval !== null && visibleApproval.status === "pending";
  const visibleIsResolved = visibleApproval !== null && visibleApproval.status !== "pending";

  return {
    approval: visibleApproval,
    approve,
    reject,
    submitDecision,
    isSubmitting: ownsState ? isSubmitting : false,
    isLoading: ownsState ? isLoading : Boolean(runId && approvalId),
    error: ownsState ? error : null,
    isPending: visibleIsPending,
    isResolved: visibleIsResolved,
  };
}
