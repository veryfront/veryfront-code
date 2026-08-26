import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import type { ApprovalDecision, PendingApproval } from "#veryfront/workflow/types.ts";
import {
  encodeWorkflowPathSegment,
  normalizeWorkflowApiBase,
  useStableWorkflowHeaders,
  workflowJsonMutationHeaders,
} from "./mutation-headers.ts";

/** Options accepted by use approval. */
export interface UseApprovalOptions {
  runId: string;
  approvalId: string;
  apiBase?: string;
  /** Additional headers, such as a cross-origin authorization token. */
  headers?: HeadersInit;
  /** Fetch credential mode for cross-origin cookie-backed sessions. */
  credentials?: RequestCredentials;
  approver?: string;
  onDecision?: (decision: ApprovalDecision) => void;
  onError?: (error: Error) => void;
}

/** Result returned from use approval. */
export interface UseApprovalResult {
  approval: PendingApproval | null;
  approve: (comment?: string, data?: unknown) => Promise<void>;
  reject: (comment?: string, data?: unknown) => Promise<void>;
  submitDecision: (decision: ApprovalDecision) => Promise<void>;
  isSubmitting: boolean;
  isLoading: boolean;
  error: Error | null;
  isPending: boolean;
  isResolved: boolean;
}

/** Manage workflow approval interactions. */
export function useApproval(options: UseApprovalOptions): UseApprovalResult {
  const {
    runId,
    approvalId,
    apiBase = "/api/workflows",
    headers,
    credentials,
    approver = "unknown",
    onDecision,
    onError,
  } = options;
  const normalizedApiBase = normalizeWorkflowApiBase(apiBase);
  const stableHeaders = useStableWorkflowHeaders(headers);
  const requestContext = useMemo(
    () => ({ approvalId, credentials, normalizedApiBase, runId, stableHeaders }),
    [approvalId, credentials, normalizedApiBase, runId, stableHeaders],
  );
  const currentRequestContext = useRef(requestContext);
  currentRequestContext.current = requestContext;
  const decisionSequence = useRef(0);

  const [approvalState, setApprovalState] = useState<
    {
      approval: PendingApproval;
      requestContext: typeof requestContext;
    } | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const toError = useCallback((err: unknown): Error => {
    return err instanceof Error ? err : new Error(String(err));
  }, []);

  useEffect(() => {
    decisionSequence.current++;
    setIsSubmitting(false);
  }, [requestContext]);

  useEffect((): (() => void) | void => {
    if (!runId || !approvalId) return;
    const controller = new AbortController();
    let current = true;
    setApprovalState(null);
    setError(null);
    setIsLoading(true);

    async function fetchApproval(): Promise<void> {
      try {
        const response = await fetch(
          `${normalizedApiBase}/runs/${
            encodeWorkflowPathSegment(runId, "Workflow run ID")
          }/approvals/${encodeWorkflowPathSegment(approvalId, "Workflow approval ID")}`,
          { signal: controller.signal, headers: stableHeaders, credentials },
        );

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to fetch approval: ${response.status}`,
            status: response.status,
          });
        }

        const data: PendingApproval = await response.json();
        if (!current) return;
        setApprovalState({ approval: data, requestContext });
        setError(null);
      } catch (err) {
        if (!current || controller.signal.aborted) return;
        const fetchError = toError(err);
        setError(fetchError);
        onError?.(fetchError);
      } finally {
        if (current) setIsLoading(false);
      }
    }

    fetchApproval();
    return () => {
      current = false;
      controller.abort();
    };
  }, [
    runId,
    approvalId,
    credentials,
    normalizedApiBase,
    onError,
    requestContext,
    stableHeaders,
    toError,
  ]);

  const submitDecision = useCallback(
    async (decision: ApprovalDecision): Promise<void> => {
      if (!runId || !approvalId) return;
      const sequence = ++decisionSequence.current;
      const submittedRequestContext = requestContext;
      const isCurrentRequest = (): boolean =>
        sequence === decisionSequence.current &&
        submittedRequestContext === currentRequestContext.current;

      setIsSubmitting(true);
      setError(null);

      try {
        const requestUrl = `${normalizedApiBase}/runs/${
          encodeWorkflowPathSegment(runId, "Workflow run ID")
        }/approvals/${encodeWorkflowPathSegment(approvalId, "Workflow approval ID")}`;
        const response = await fetch(requestUrl, {
          method: "POST",
          headers: workflowJsonMutationHeaders(requestUrl, stableHeaders),
          credentials,
          body: JSON.stringify(decision),
        });

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to submit decision: ${response.status}`,
            status: response.status,
          });
        }

        const responseText = await response.text();
        let responseBody: unknown;
        if (responseText) {
          try {
            responseBody = JSON.parse(responseText) as unknown;
          } catch {
            // Successful legacy/proxied endpoints may return a non-JSON body.
          }
        }
        const responseResolvedBy = responseBody !== null && typeof responseBody === "object" &&
            "resolvedBy" in responseBody
          ? responseBody.resolvedBy
          : undefined;
        const resolvedDecision: ApprovalDecision = {
          ...decision,
          approver: typeof responseResolvedBy === "string" ? responseResolvedBy : decision.approver,
        };

        if (!isCurrentRequest()) return;

        setApprovalState((prev) => {
          if (!prev || prev.requestContext !== submittedRequestContext) return prev;

          return {
            requestContext: prev.requestContext,
            approval: {
              ...prev.approval,
              status: decision.approved ? "approved" : "rejected",
              resolvedAt: new Date(),
              resolvedBy: resolvedDecision.approver,
              comment: decision.comment,
            },
          };
        });

        onDecision?.(resolvedDecision);
      } catch (err) {
        const submitError = toError(err);
        if (isCurrentRequest()) {
          setError(submitError);
          onError?.(submitError);
        }
        throw submitError;
      } finally {
        if (isCurrentRequest()) setIsSubmitting(false);
      }
    },
    [
      runId,
      approvalId,
      credentials,
      normalizedApiBase,
      onDecision,
      onError,
      requestContext,
      stableHeaders,
      toError,
    ],
  );

  const approve = useCallback(
    async (comment?: string, data?: unknown): Promise<void> => {
      return submitDecision({ approved: true, approver, comment, data });
    },
    [submitDecision, approver],
  );

  const reject = useCallback(
    async (comment?: string, data?: unknown): Promise<void> => {
      return submitDecision({ approved: false, approver, comment, data });
    },
    [submitDecision, approver],
  );

  const approval = approvalState?.requestContext === requestContext ? approvalState.approval : null;
  const isPending = approval?.status === "pending";

  return {
    approval,
    approve,
    reject,
    submitDecision,
    isSubmitting,
    isLoading,
    error,
    isPending,
    isResolved: !isPending,
  };
}
