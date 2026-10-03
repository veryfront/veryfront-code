export interface paths {
    "/account/analytics/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run analytics
         * @description Get run analytics.
         *
         *     - Historical runs may lack a trigger or target.id; newly created runs have both.
         */
        get: operations["getAccountRunAnalytics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/conversations/{conversation_id}/child-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List conversation child runs
         * @description List conversation child runs.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         *     - Persist terminal child outcome and delivery intent atomically. Delivery is at least once; the parent consumes an outcome once per child and durable invocation, preserving identity across retries/restarts. Handled failure or cancellation allows recovery; unhandled child outcome fails the parent and requests cancellation of its remaining descendants. Do not cancel siblings merely because one child failed while the parent handles it.
         */
        get: operations["listConversationChildRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/conversations/{conversation_id}/input-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List conversation input requests
         * @description List conversation input requests.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         *     - Project and private-conversation permissions apply; password values are never returned.
         */
        get: operations["listConversationInputRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/conversations/{conversation_id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List conversation runs
         * @description List conversation runs.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         */
        get: operations["listConversationRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/input-requests/{input_request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get input request
         * @description Get input request.
         *
         *     - Project and private-conversation permissions apply; password values are never returned.
         *     - Execution credentials need run.input_requests.read and access to the bound run.
         */
        get: operations["getInputRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/input-requests/{input_request_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel input request
         * @description Cancel input request.
         *
         *     - Only an open input request can be cancelled; an already resolved request returns 409 unless this is an identical idempotent replay.
         *     - Cancelling the request does not cancel the run; notify its matching durable wait with cancellation rather than fabricated field values.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         */
        post: operations["cancelInputRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/input-requests/{input_request_id}/responses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Respond to input request
         * @description Respond to input request.
         *
         *     - Submit values keyed by field name; responder identity comes from authentication.
         *     - Values must match the stored fields and required responder role; runtime execution credentials do not impersonate human responders.
         *     - Submission, cancellation and expiry compete atomically; a different resolution after completion returns 409.
         *     - Only the matching durable wait is resumed; the response returns the updated input request with password values omitted.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         */
        post: operations["createInputResponse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_reference}/evals/{eval_id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List evaluation runs
         * @description List evaluation runs.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         */
        get: operations["listEvalRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_reference}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List project runs
         * @description List project runs.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         */
        get: operations["listProjectRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_reference}/webhooks/{webhook_definition_id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List webhook runs
         * @description List webhook runs.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         */
        get: operations["listProjectWebhookRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List runs
         * @description List runs.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         */
        get: operations["listRuns"];
        put?: never;
        /**
         * Create run
         * @description Create run.
         *
         *     - 202 means the run was accepted; it can remain pending until an executor is available.
         *     - Use a project API key or user token for a root run; child creation requires the parent’s execution credential and run.child_runs.create permission.
         *     - trigger identifies the authenticated user or credential for a direct run, or the parent execution definition for a child; parent_run_id identifies that exact execution.
         *     - source selects a saved definition in the create request only; the response returns the resolved target and server-derived trigger. Manual invocation records the authenticated user or credential as trigger.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         *     - Create a child with parent_run_id and one verified invocation reference: node_id for a workflow node, or tool_call_id for an agent tool call; they are mutually exclusive and require parent_run_id. Verify correlation against the authenticated parent execution. Task parents use the existing durable invocation identity and Idempotency-Key. Derive trigger from the parent target; reject wrong parent-type correlation and cycles.
         */
        post: operations["createRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run
         * @description Get run.
         *
         *     - Historical runs may lack a trigger or target.id; newly created runs have both.
         *     - Execution credentials need run.read and access to the bound run.
         */
        get: operations["getRun"];
        put?: never;
        post?: never;
        /**
         * Delete run
         * @description Delete run.
         *
         *     - Only a terminal run without direct children or a retention hold can be deleted; administrator access is required.
         *     - 204 confirms deletion of the run and its events.
         */
        delete: operations["deleteRun"];
        options?: never;
        head?: never;
        /**
         * Update run
         * @description Update run.
         *
         *     - Only title and labels can change; omitted fields stay unchanged, title:null clears the title and labels:{} clears labels.
         *     - Send the ETag in If-Match; a stale version returns 412.
         */
        patch: operations["updateRun"];
        trace?: never;
    };
    "/runs/{run_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel run
         * @description Cancel run.
         *
         *     - 202 confirms a cancellation request; inspect status and control.cancellation for confirmation.
         *     - A terminal state prevents further execution; conflicting terminal actions return 409.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         *     - Cancel requests cancellation of the run and all its descendants. Atomically gate new work and new child admission against cancellation of any ancestor; retry delivery of stop requests. Do not cancel ancestors or unrelated siblings. stopped_at requires acknowledgement that this run stopped; the subtree is stopped only when descendants.active is zero. Already terminal outcomes are not rewritten.
         */
        post: operations["cancelRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/child-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List child runs
         * @description List child runs.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         *     - Execution credentials need run.child_runs.read and access to the bound run.
         *     - Persist terminal child outcome and delivery intent atomically. Delivery is at least once; the parent consumes an outcome once per child and durable invocation, preserving identity across retries/restarts. Handled failure or cancellation allows recovery; unhandled child outcome fails the parent and requests cancellation of its remaining descendants. Do not cancel siblings merely because one child failed while the parent handles it.
         */
        get: operations["listRunChildRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/event-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create run event token
         * @description Create run event token.
         *
         *     - The parent execution credential may mint append-only authority for the direct child identified by run_id.
         *     - The token cannot read events, finalize, heartbeat or create children.
         */
        post: operations["createRunEventToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List run events
         * @description List run events.
         *
         *     - Filter by event_type only when needed; omit filters to list all visible events.
         *     - Each known event has a named payload type; unknown historical or future types use the fallback.
         *     - Recorded payloads retain their original field names, including inputRequest.id; resource renames do not rewrite event history.
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         *     - Execution credentials need run.events.read and access to the bound run.
         */
        get: operations["listRunEvents"];
        put?: never;
        /**
         * Append run events
         * @description Append run events.
         *
         *     - Each event uses its named payload schema; the payload type selects the variant.
         *     - Append permission is required for the bound run and current execution generation; durable cursors identify persisted events.
         */
        post: operations["appendRunEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/events/{event_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run event
         * @description Get run event.
         *
         *     - Historical runs may lack a trigger or target.id; newly created runs have both.
         *     - Execution credentials need run.events.read and access to the bound run.
         */
        get: operations["getRunEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/events/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run event summary
         * @description Get run event summary.
         *
         *     - Historical runs may lack a trigger or target.id; newly created runs have both.
         *     - Execution credentials need run.events.read and access to the bound run.
         */
        get: operations["getRunEventsSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Finalize run
         * @description Finalize run.
         *
         *     - Current execution authority is required; send completed with output or failed with error.
         *     - Validate output against the pinned schema before the terminal commit; invalid output returns 400 and oversized output returns 413.
         *     - 200 confirms the terminal commit; stale authority or a conflicting result returns 409.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         *     - A successful finalize requires no active descendants and returns 409 otherwise. Failed finalize gates new parent work and requests cancellation of remaining descendants. One terminal outcome wins against cancel/finalize races; a conflicting request returns 409 and GET returns the committed outcome. Never overwrite an earlier result.
         *     - Persist terminal child outcome and delivery intent atomically. Delivery is at least once; the parent consumes an outcome once per child and durable invocation, preserving identity across retries/restarts. Handled failure or cancellation allows recovery; unhandled child outcome fails the parent and requests cancellation of its remaining descendants. Do not cancel siblings merely because one child failed while the parent handles it.
         */
        post: operations["finalizeRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/heartbeats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send run heartbeat
         * @description Send run heartbeat.
         *
         *     - Renews execution authority for the bound run, using 60 seconds when the body is empty.
         *     - Terminal, cancelled or stale execution authority returns 409; a heartbeat never starts a new execution.
         */
        post: operations["createRunHeartbeat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/input-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List run input requests
         * @description List run input requests.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         *     - Project and private-conversation permissions apply; password values are never returned.
         *     - Execution credentials need run.input_requests.read and access to the bound run.
         */
        get: operations["listRunInputRequests"];
        put?: never;
        /**
         * Create input request
         * @description Create input request.
         *
         *     - The run supplies project and conversation scope; send only the question and fields.
         *     - Creation does not pause execution; the runtime must register the matching durable wait.
         *     - Password fields cannot have defaults; values must never appear in reads, events, replay responses or logs.
         *     - Execution credentials need run.input_requests.create and access to the bound run.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         */
        post: operations["createRunInputRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause run
         * @description Pause run.
         *
         *     - 202 confirms the pause request, not that execution stopped.
         *     - A confirmed pause has status=waiting and control.waiting.reason=manual_pause; control.pause records when it was requested.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         *     - Pause affects this run at its next safe boundary, not its descendants. Resume requeues this same run and only clears its matching wait. Child outcomes arriving while manually paused remain durable until resume.
         */
        post: operations["pauseRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume run
         * @description Resume run.
         *
         *     - Only a signal matching the current wait is accepted; a mismatch returns 409.
         *     - Use type=manual for a confirmed manual pause; workflow approval and event signals must include the current wait_id.
         *     - The same run is queued again; its original trigger do not change.
         *     - Retry with the same Idempotency-Key and payload to receive the original response; a changed payload with the same key returns 409.
         *     - Pause affects this run at its next safe boundary, not its descendants. Resume requeues this same run and only clears its matching wait. Child outcomes arriving while manually paused remain durable until resume.
         */
        post: operations["resumeRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run snapshot
         * @description Get run snapshot.
         *
         *     - Historical runs may lack a trigger or target.id; newly created runs have both.
         *     - Execution credentials need run.events.read and access to the bound run.
         */
        get: operations["getRunSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream run events
         * @description Stream run events.
         *
         *     - Live delivery can be repeated and does not prove durable persistence; use recorded events for the durable history.
         *     - Execution credentials need run.events.read and access to the bound run.
         */
        get: operations["streamRunEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/event-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List run event types
         * @description List run event types.
         *
         *     - Omit optional filters for the default collection; follow page_info.next with unchanged filters when pagination is provided.
         */
        get: operations["listRunEventTypes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ActivityDeltaPayload: {
            /** @enum {string} */
            type: "ACTIVITY_DELTA";
        } & {
            /** @enum {string} */
            type: "ACTIVITY_DELTA";
        };
        ActivitySnapshotPayload: {
            /** @enum {string} */
            type: "ACTIVITY_SNAPSHOT";
        } & {
            /** @enum {string} */
            type: "ACTIVITY_SNAPSHOT";
        };
        /** @description Immediate authenticated initiator, recorded by the server; execution credentials identify their issuing service account, not the original caller. */
        Actor: {
            id: string;
            /** @enum {string} */
            type: "user" | "api_key" | "service_account" | "system";
        };
        AgentRunAuthorizationSealedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_AUTHORIZATION_SEALED";
        };
        AgentRunBillingUsageRetainedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_BILLING_USAGE_RETAINED";
        };
        AgentRunContextCompactedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTEXT_COMPACTED";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            firstKeptEntryId: string;
            /** @enum {string} */
            reason: "context_window" | "transport_body";
            /** Format: int64 */
            reserveTokens: number;
            summary: {
                text: string;
            };
            /** Format: int64 */
            tokenBudget: number;
            /** Format: int64 */
            tokensAfter: number;
            /** Format: int64 */
            tokensBefore: number;
            /** @enum {string} */
            type: "AGENT_RUN_CONTEXT_COMPACTED";
        };
        AgentRunControlPlaneDispatchAcceptedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
        } & {
            requestHash: string;
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
        };
        AgentRunControlPlaneDispatchReceiptPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
        } & {
            requestHash: string;
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
        };
        AgentRunDefaultChatStartEnqueuedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED";
        };
        AgentRunDetachedAcceptedPayload: {
            /** Format: uuid */
            dispatchAttemptId: string;
            leaseOwner: string;
            /** @enum {string} */
            type: "AGENT_RUN_DETACHED_ACCEPTED";
        };
        AgentRunIntegrationConnectionRefusedPayload: {
            integration: string;
            message: string;
            toolName: string;
            /** @enum {string} */
            type: "AGENT_RUN_INTEGRATION_CONNECTION_REFUSED";
        };
        AgentRunInvokeAgentBillingModeRetainedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED";
        };
        AgentRunModelCallContextPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messages: ({
                content: string;
                providerOptions?: {
                    [key: string]: {
                        cacheControl: {
                            /** @enum {string} */
                            ttl?: "5m" | "1h";
                            /** @enum {string} */
                            type: "ephemeral";
                        };
                    };
                };
                /** @enum {string} */
                role: "system";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    filename?: string;
                    mediaType: string;
                    /** @enum {string} */
                    type: "image" | "file";
                    url: string;
                })[];
                /** @enum {string} */
                role: "user";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    input: unknown;
                    providerExecuted?: boolean;
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-call";
                })[];
                /** @enum {string} */
                role: "assistant";
            } | {
                content: {
                    output: {
                        /** @enum {string} */
                        type: "json";
                        value: unknown;
                    };
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-result";
                }[];
                /** @enum {string} */
                role: "tool";
            })[];
            model?: {
                id: string;
                modelProvider?: string;
            };
            request?: {
                /** Format: double */
                frequencyPenalty?: number;
                /** Format: double */
                maxOutputTokens?: number;
                /** Format: double */
                presencePenalty?: number;
                reasoning?: {
                    /** Format: int64 */
                    budgetTokens?: number;
                    /** @enum {string} */
                    effort?: "low" | "medium" | "high" | "max";
                    enabled?: boolean;
                };
                /** Format: double */
                seed?: number;
                stopSequences?: string[];
                /** Format: double */
                temperature?: number;
                /** Format: double */
                topK?: number;
                /** Format: double */
                topP?: number;
            };
            tools?: ({
                description?: string;
                inputSchema: unknown;
                name: string;
                /** @enum {string} */
                type: "function";
            } | {
                args: {
                    [key: string]: unknown;
                };
                id: string;
                name: string;
                /** @enum {string} */
                type: "provider";
            })[];
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT";
        };
        AgentRunModelCallContextRecordedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messages: ({
                content: string;
                providerOptions?: {
                    [key: string]: {
                        cacheControl: {
                            /** @enum {string} */
                            ttl?: "5m" | "1h";
                            /** @enum {string} */
                            type: "ephemeral";
                        };
                    };
                };
                /** @enum {string} */
                role: "system";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    filename?: string;
                    mediaType: string;
                    /** @enum {string} */
                    type: "image" | "file";
                    url: string;
                })[];
                /** @enum {string} */
                role: "user";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    input: unknown;
                    providerExecuted?: boolean;
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-call";
                })[];
                /** @enum {string} */
                role: "assistant";
            } | {
                content: {
                    output: {
                        /** @enum {string} */
                        type: "json";
                        value: unknown;
                    };
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-result";
                }[];
                /** @enum {string} */
                role: "tool";
            })[];
            model?: {
                id: string;
                modelProvider?: string;
            };
            request?: {
                /** Format: double */
                frequencyPenalty?: number;
                /** Format: double */
                maxOutputTokens?: number;
                /** Format: double */
                presencePenalty?: number;
                reasoning?: {
                    /** Format: int64 */
                    budgetTokens?: number;
                    /** @enum {string} */
                    effort?: "low" | "medium" | "high" | "max";
                    enabled?: boolean;
                };
                /** Format: double */
                seed?: number;
                stopSequences?: string[];
                /** Format: double */
                temperature?: number;
                /** Format: double */
                topK?: number;
                /** Format: double */
                topP?: number;
            };
            tools?: ({
                description?: string;
                inputSchema: unknown;
                name: string;
                /** @enum {string} */
                type: "function";
            } | {
                args: {
                    [key: string]: unknown;
                };
                id: string;
                name: string;
                /** @enum {string} */
                type: "provider";
            })[];
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
        };
        AgentRunProviderReplayCheckpointedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messageId: string;
            /** @enum {string} */
            provider: "anthropic" | "openai-responses";
            providerBlockPositions: number[];
            providerBlocks: {
                block: {
                    [key: string]: unknown;
                };
                /** @enum {string} */
                provider: "anthropic" | "openai-responses";
                /** @enum {string} */
                type: "provider-block";
            }[];
            providerMessageBlockCounts?: number[];
            /** Format: int64 */
            totalPartCount: number;
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
            /**
             * Format: double
             * @enum {number}
             */
            version: 1;
        };
        AgentRunProviderReplayCheckpointPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messageId: string;
            /** @enum {string} */
            provider: "anthropic" | "openai-responses";
            providerBlockPositions: number[];
            providerBlocks: {
                block: {
                    [key: string]: unknown;
                };
                /** @enum {string} */
                provider: "anthropic" | "openai-responses";
                /** @enum {string} */
                type: "provider-block";
            }[];
            providerMessageBlockCounts?: number[];
            /** Format: int64 */
            totalPartCount: number;
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
            /**
             * Format: double
             * @enum {number}
             */
            version: 1;
        };
        AgentRunProviderReplayTurnFinishedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED";
        };
        AgentRunProviderReplayTurnStartedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED";
        };
        AgentRunReplayedUploadsSealedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_REPLAYED_UPLOADS_SEALED";
        };
        AgentRunRequestEnqueuedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_REQUEST_ENQUEUED";
        };
        AgentRunRuntimeInvokeRetriedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_RUNTIME_INVOKE_RETRIED";
        };
        AgentRunRuntimeOwnerBoundPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_RUNTIME_OWNER_BOUND";
        };
        AgentRunToolExposureCheckpointedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
        } & {
            authorizedCatalogFingerprint?: string;
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            loadedToolNames: string[];
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
            version: 1 | 2;
        };
        AgentRunToolExposureCheckpointPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
        } & {
            authorizedCatalogFingerprint?: string;
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            loadedToolNames: string[];
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
            version: 1 | 2;
        };
        AgentRunToolResultDeliveryFailedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED";
        };
        AgentRunToolResultSubmittedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_RESULT_SUBMITTED";
        };
        AppendRunEventsRequest: {
            events: (components["schemas"]["TextMessageStartPayload"] | components["schemas"]["TextMessageContentPayload"] | components["schemas"]["TextMessageEndPayload"] | components["schemas"]["ToolCallStartPayload"] | components["schemas"]["ToolCallArgsPayload"] | components["schemas"]["ToolCallChunkPayload"] | components["schemas"]["ToolCallEndPayload"] | components["schemas"]["ToolCallResultPayload"] | components["schemas"]["MessagesSnapshotPayload"] | components["schemas"]["StateSnapshotPayload"] | components["schemas"]["StateDeltaPayload"] | components["schemas"]["RunStartedPayload"] | components["schemas"]["RunFinishedPayload"] | components["schemas"]["RunErrorPayload"] | components["schemas"]["StepStartedPayload"] | components["schemas"]["StepFinishedPayload"] | components["schemas"]["ReasoningStartPayload"] | components["schemas"]["ReasoningMessageStartPayload"] | components["schemas"]["ReasoningMessageContentPayload"] | components["schemas"]["ReasoningMessageEndPayload"] | components["schemas"]["ReasoningContentPayload"] | components["schemas"]["ReasoningEndPayload"] | components["schemas"]["ActivitySnapshotPayload"] | components["schemas"]["ActivityDeltaPayload"] | components["schemas"]["ToolCallStatusChangedPayload"] | components["schemas"]["InputRequestCreatedPayload"] | components["schemas"]["InputRequestUpdatedPayload"] | components["schemas"]["ChildRunStatusChangedPayload"] | components["schemas"]["ModelCallCompletedPayload"] | components["schemas"]["RunParkedPayload"] | components["schemas"]["RunLogCapturedPayload"] | components["schemas"]["StreamHeartbeatEmittedPayload"] | components["schemas"]["UrlCitedPayload"] | components["schemas"]["DocumentCitedPayload"] | components["schemas"]["FileAttachedPayload"] | components["schemas"]["FilesChangedPayload"] | components["schemas"]["RuntimeEventRecordedPayload"] | components["schemas"]["AgentRunContextCompactedPayload"] | components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayload"] | components["schemas"]["AgentRunControlPlaneDispatchReceiptPayload"] | components["schemas"]["AgentRunToolExposureCheckpointedPayload"] | components["schemas"]["AgentRunToolExposureCheckpointPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointedPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointPayload"] | components["schemas"]["AgentRunModelCallContextRecordedPayload"] | components["schemas"]["AgentRunModelCallContextPayload"])[];
            expected_previous_event_id?: number | null;
            expected_previous_external_event_sequence?: number | null;
            /** @enum {string} */
            external_sequence_scope?: "agent" | "publish_only";
        };
        AppendRunEventsResponse: {
            /** Format: int64 */
            appended_count: number;
            /** Format: int64 */
            latest_event_id: number;
            /** Format: int64 */
            latest_external_event_sequence?: number;
            /** Format: uuid */
            run_id: string;
        };
        ChildRunStatusChangedPayload: {
            childAgentId?: string | null;
            childConversationId?: string | null;
            childMessageId?: string | null;
            childRunId: string;
            description?: string;
            status: string;
            toolCallId: string;
            /** @enum {string} */
            type: "CHILD_RUN_STATUS_CHANGED";
        } & {
            childAgentId?: string | null;
            childConversationId?: string | null;
            childMessageId?: string | null;
            childRunId: string;
            description?: string;
            status: string;
            toolCallId: string;
            /** @enum {string} */
            type: "CHILD_RUN_STATUS_CHANGED";
        };
        /** @description Provider and platform charges in EUR before tax; total is their sum when known. Credits are billed units, not a currency or a fixed EUR conversion. Signed decimal strings have at most eight fractional digits. Negative amounts are billing adjustments. Status is independent of token capture; unavailable requires all amounts null. Posted amounts come from the billing ledger and may change through later adjustments. */
        Cost: {
            credits: string | null;
            /** @enum {string} */
            currency: "EUR";
            platform: string | null;
            provider: string | null;
            /** @enum {string} */
            status: "estimated" | "posted" | "unavailable";
            total: string | null;
        } & unknown;
        /** @description A newly created run with resolved target and recorded trigger. */
        CreatedRun: {
            /** @description Files produced by the run. */
            artifacts?: components["schemas"]["RunArtifact"][];
            /**
             * Format: uuid
             * @description Batch containing the run.
             */
            batch_id?: string;
            /** @description Definition-specific execution configuration. */
            config?: {
                [key: string]: unknown;
            };
            /** @description Pending control requests and the current wait. */
            control?: {
                cancellation?: components["schemas"]["RunCancellation"];
                pause?: components["schemas"]["RunPause"];
                waiting?: components["schemas"]["RunWait"];
            };
            /**
             * Format: uuid
             * @description Conversation containing the run.
             */
            conversation_id?: string;
            /**
             * Format: date-time
             * @description When the run was accepted.
             */
            created_at: string;
            /** @description Counts and usage across all descendant runs, excluding this run. */
            descendants?: {
                /**
                 * Format: int64
                 * @description Descendants that are pending, running or waiting.
                 */
                active: number;
                /** @description Whether any descendant has failed. */
                has_failures: boolean;
                /**
                 * Format: int64
                 * @description Total descendants at every depth.
                 */
                total: number;
                usage?: components["schemas"]["Usage"];
            };
            /** @description Failure details, present only when the run failed. */
            error?: components["schemas"]["RunFailure"];
            /** @description Resolved execution settings and diagnostics. */
            execution?: {
                /**
                 * Format: int64
                 * @description Current or last execution attempt, starting at 1; absent before execution.
                 */
                attempt?: number;
                /**
                 * Format: int64
                 * @description Elapsed time from first start to finish, including waits and retries; null when not finished.
                 */
                duration_ms?: number | null;
                exit_code?: number | null;
                logs?: string;
                /** Format: int64 */
                retry_limit?: number;
                /** @description Resolved logical runtime selection; main_branch identifies the selected main-branch deployment, not a worker process. */
                runtime?: components["schemas"]["RunRuntime"];
                /** @description Recorded execution start mode, when available. */
                start_mode?: string;
                /** Format: int64 */
                timeout_seconds?: number;
                /** Format: int64 */
                tool_error_count?: number;
            };
            /**
             * Format: date-time
             * @description When the run completed, failed or was cancelled.
             */
            finished_at?: string;
            /**
             * Format: uuid
             * @description Unique run UUID.
             */
            id: string;
            /** @description Business input supplied when the run was created. */
            input: unknown;
            /**
             * Format: uuid
             * @description Conversation message that supplied the input.
             */
            input_message_id?: string;
            /** @description Labels used to organize runs. */
            labels?: components["schemas"]["RunLabels"];
            /** @description Additional resource metadata. */
            metadata?: {
                [key: string]: unknown;
            };
            /** @description Final business output; null until successful finalization. */
            output: unknown;
            /**
             * Format: uuid
             * @description Conversation message containing the result.
             */
            output_message_id?: string;
            /**
             * Format: uuid
             * @description Immediate parent run ID, present on child runs.
             */
            parent_run_id?: string;
            /**
             * Format: uuid
             * @description Project containing the run.
             */
            project_id: string;
            /**
             * Format: uuid
             * @description Top-level ancestor run ID, present on child runs.
             */
            root_run_id?: string;
            /** @description Pinned schemas for business input and output; null means no declared schema. */
            schemas?: {
                input: {
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    sha256: string;
                } | null;
                output: {
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    sha256: string;
                } | null;
            };
            /**
             * Format: date-time
             * @description When the first execution attempt started, omitted before execution.
             */
            started_at?: string;
            /**
             * @description Current execution state.
             * @enum {string}
             */
            status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
            /** @description Resolved execution definition. */
            target: components["schemas"]["RunTarget"];
            /** @description Orchestration task ID, distinct from the execution definition. */
            task_id?: string;
            /** @description Display title, omitted when unset. */
            title?: string;
            /** @description How execution was initiated. */
            trigger: components["schemas"]["RunTrigger"];
            /**
             * Format: date-time
             * @description When the resource last changed, including usage updates.
             */
            updated_at: string;
            /** @description Usage when available; unknown measurements are null. */
            usage?: components["schemas"]["Usage"];
        } & (unknown & unknown & unknown & unknown & unknown & unknown & unknown);
        CreateInputRequestRequest: {
            description?: string;
            /** Format: date-time */
            expires_at?: string;
            fields: components["schemas"]["InputRequestField"][];
            metadata?: {
                [key: string]: unknown;
            };
            /**
             * @default human
             * @enum {string}
             */
            requested_responder_type: "human" | "agent" | "system";
            title: string;
            tool_call_id?: string;
        };
        CreateInputRequestRequestInput: {
            description?: string;
            /** Format: date-time */
            expires_at?: string;
            fields: components["schemas"]["InputRequestFieldInput"][];
            metadata?: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            requested_responder_type?: "human" | "agent" | "system";
            title: string;
            tool_call_id?: string;
        };
        CreateRunHeartbeatRequest: {
            /**
             * Format: int64
             * @default 60
             */
            lease_duration_seconds: number;
        };
        CreateRunHeartbeatRequestInput: {
            /** Format: int64 */
            lease_duration_seconds?: number;
        };
        /** @description Create a direct run with project_id, target:{type,id}, and optional input, or execute a saved schedule or webhook. Input is business data; configuration and execution settings are separate. */
        CreateRunRequest: components["schemas"]["DirectRunRequest"] | components["schemas"]["ScheduleRunRequest"] | components["schemas"]["WebhookRunRequest"];
        DirectRunRequest: {
            /** Format: uuid */
            batch_id?: string;
            config?: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            conversation_id?: string;
            execution?: components["schemas"]["RunExecutionOptions"];
            /** @description A JSON value. */
            input?: unknown;
            labels?: components["schemas"]["RunLabels"];
            node_id?: string;
            /** Format: uuid */
            parent_run_id?: string;
            /** Format: uuid */
            project_id: string;
            target: components["schemas"]["RunTarget"];
            title?: string;
            tool_call_id?: string;
        } & unknown;
        DocumentCitedPayload: {
            filename?: string;
            mediaType: string;
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "DOCUMENT_CITED";
        } & {
            filename?: string;
            mediaType: string;
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "DOCUMENT_CITED";
        };
        EvaluationMetricResult: {
            evidence?: {
                [key: string]: unknown;
            };
            explanation?: string;
            /** @enum {string} */
            family: "answer" | "agent" | "ops" | "judge" | "knowledge" | "check";
            name: string;
            passed?: boolean;
            /** Format: double */
            score?: number;
            /** @enum {string} */
            severity: "gate" | "soft" | "budget";
            skipped?: boolean;
        };
        EvaluationRecord: {
            checks: components["schemas"]["EvaluationMetricResult"][];
            citations?: {
                metadata?: {
                    [key: string]: unknown;
                };
                quote?: string;
                source: string;
                text?: string;
            }[];
            completed: boolean;
            /** Format: int64 */
            duration_ms: number;
            error?: components["schemas"]["RunFailure"];
            example_id: string;
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            execution_input?: unknown;
            id: string;
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            input: unknown;
            metadata: {
                [key: string]: unknown;
            };
            metrics: components["schemas"]["EvaluationMetricResult"][];
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            output: unknown;
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            reference?: unknown;
            /** Format: int64 */
            repetition: number;
            retrieved_context?: {
                content?: string;
                metadata?: {
                    [key: string]: unknown;
                };
                source: string;
                title?: string;
            }[];
            trace?: components["schemas"]["EvaluationTrace"];
            usage?: components["schemas"]["Usage"];
        };
        /** @description Public evaluation report version 1, mapped from the internal report format; internal schemaVersion is a separate version. */
        EvaluationReport: {
            /** Format: date-time */
            completed_at: string;
            dataset?: {
                /** Format: int64 */
                examples: number;
                hash: string;
                kind: string;
                path?: string;
            };
            eval_id: string;
            exports?: {
                [key: string]: unknown;
            }[];
            metadata?: {
                [key: string]: unknown;
            };
            records: components["schemas"]["EvaluationRecord"][];
            /** Format: uuid */
            run_id: string;
            /**
             * Format: double
             * @enum {number}
             */
            schema_version: 1;
            /** Format: date-time */
            started_at: string;
            summary: components["schemas"]["EvaluationSummary"];
            target: string;
        };
        /** @description Read output.report from standard run detail: either the inline report or an explicit artifact reference; serialized run.output remains at most 1 MiB. */
        EvaluationRunOutput: {
            report: components["schemas"]["EvaluationReport"];
            /** @enum {string} */
            report_storage: "inline";
        } | {
            report: components["schemas"]["RunArtifact"];
            /** @enum {string} */
            report_storage: "artifact";
            summary: components["schemas"]["EvaluationSummary"];
        };
        EvaluationSummary: {
            duration?: {
                /** Format: int64 */
                max_ms: number;
                /** Format: double */
                mean_ms: number;
                /** Format: int64 */
                min_ms: number;
                /** Format: int64 */
                p50_ms: number;
                /** Format: int64 */
                p95_ms: number;
                /** Format: int64 */
                total_ms: number;
            };
            /** Format: int64 */
            failed: number;
            failed_examples?: {
                example_id: string;
                /** Format: int64 */
                failed: number;
                flaky: boolean;
                /** Format: double */
                pass_rate: number;
                /** Format: int64 */
                passed: number;
                /** Format: int64 */
                records: number;
            }[];
            flakes?: {
                /** Format: int64 */
                examples: number;
                /** Format: int64 */
                flaky: number;
                /** Format: int64 */
                stable_failed: number;
                /** Format: int64 */
                stable_passed: number;
            };
            gate_failures?: {
                evidence?: {
                    [key: string]: unknown;
                };
                example_id: string;
                explanation?: string;
                family: string;
                name: string;
                record_id: string;
                /** Format: int64 */
                repetition: number;
                /** @enum {string} */
                severity: "gate" | "budget";
            }[];
            metrics?: {
                /** Format: int64 */
                failed: number;
                /** @enum {string} */
                family: "answer" | "agent" | "ops" | "judge" | "knowledge" | "check";
                name: string;
                /** Format: double */
                pass_rate: number;
                /** Format: int64 */
                passed: number;
                /** @enum {string} */
                severity: "gate" | "soft" | "budget";
                /** Format: int64 */
                skipped: number;
            }[];
            /** Format: double */
            pass_rate: number;
            /** Format: int64 */
            passed: number;
            /** Format: int64 */
            records: number;
            /** Format: int64 */
            skipped: number;
            usage?: components["schemas"]["Usage"];
        };
        EvaluationTrace: {
            events: unknown[];
            tool_calls: {
                error?: string;
                id?: string;
                /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
                input?: unknown;
                metadata?: {
                    [key: string]: unknown;
                };
                name: string;
                /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
                output?: unknown;
                /** @enum {string} */
                status?: "ok" | "error" | "skipped" | "denied";
            }[];
        };
        FileAttachedPayload: {
            filename?: string;
            mediaType: string;
            /** @enum {string} */
            type: "FILE_ATTACHED";
            url?: string;
        } & {
            filename?: string;
            mediaType: string;
            /** @enum {string} */
            type: "FILE_ATTACHED";
            url?: string;
        };
        FilesChangedPayload: {
            changes: unknown;
            id: string | null;
            status: string | null;
            /** @enum {string} */
            type: "FILES_CHANGED";
        } & {
            changes: unknown;
            id: string | null;
            status: string | null;
            /** @enum {string} */
            type: "FILES_CHANGED";
        };
        /** @description Finalize the current execution generation; successful finalization requires an output, including explicit null when there is no value. */
        FinalizeRunRequest: {
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            output: unknown;
            /** @enum {string} */
            status: "completed";
        } | {
            error: components["schemas"]["RunFailure"];
            /** @enum {string} */
            status: "failed";
        };
        /** @description Recorded execution definition; historical IDs may be unavailable. */
        HistoricalRunTarget: {
            id: string | null;
            /** @enum {string} */
            type: "agent" | "task" | "workflow" | "eval";
        };
        InputRequest: {
            /**
             * Format: uuid
             * @description Conversation inherited from the run.
             */
            conversation_id?: string;
            /**
             * Format: date-time
             * @description When the request was created.
             */
            created_at: string;
            /** @description Additional instructions for the responder. */
            description?: string;
            /**
             * Format: date-time
             * @description When the request expires.
             */
            expires_at?: string;
            /** @description Fields the responder can fill in. */
            fields: components["schemas"]["InputRequestField"][];
            /**
             * Format: uuid
             * @description Unique input request ID.
             */
            input_request_id: string;
            /** @description Additional resource metadata. */
            metadata?: {
                [key: string]: unknown;
            };
            /**
             * Format: uuid
             * @description Project inherited from the run.
             */
            project_id: string;
            /**
             * @description Required responder role; the authenticated actor identifies who actually responded.
             * @enum {string}
             */
            requested_responder_type: "human" | "agent" | "system";
            /**
             * Format: date-time
             * @description When the request was submitted, cancelled or expired.
             */
            resolved_at?: string;
            /** @description Submitted response, or null before submission or after cancellation or expiry. */
            response: components["schemas"]["InputResponse"] | null;
            /**
             * Format: uuid
             * @description Run waiting for this input.
             */
            run_id: string;
            /**
             * @description Current resolution state.
             * @enum {string}
             */
            status: "open" | "submitted" | "cancelled" | "expired";
            /** @description Question or decision shown to the responder. */
            title: string;
            /** @description Tool invocation waiting for the response. */
            tool_call_id?: string;
        } & (unknown & unknown);
        InputRequestCreatedPayload: {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_CREATED";
        } & {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_CREATED";
        };
        InputRequestField: {
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "password";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "text" | "textarea" | "email" | "url";
        } | {
            /** Format: double */
            default?: number;
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "number";
        } | {
            default?: boolean;
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "checkbox" | "confirm";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            options: {
                description?: string;
                label: string;
                recommended?: boolean;
                value: string;
            }[];
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "select" | "radio";
        };
        InputRequestFieldInput: {
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "password";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "text" | "textarea" | "email" | "url";
        } | {
            /** Format: double */
            default?: number;
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "number";
        } | {
            default?: boolean;
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "checkbox" | "confirm";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            options: {
                description?: string;
                label: string;
                recommended?: boolean;
                value: string;
            }[];
            required?: boolean;
            /** @enum {string} */
            type: "select" | "radio";
        };
        InputRequestUpdatedPayload: {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_UPDATED";
        } & {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_UPDATED";
        };
        InputResponse: {
            /** @description Authenticated principal that submitted the response. */
            actor: components["schemas"]["Actor"];
            /**
             * Format: date-time
             * @description When the response was submitted.
             */
            created_at: string;
            /** @description Names of submitted secret fields omitted from values. */
            redacted_fields?: string[];
            /**
             * Format: uuid
             * @description Unique response ID.
             */
            response_id: string;
            /** @description Submitted values keyed by field name; password values are omitted from reads. */
            values: components["schemas"]["InputValues"];
        };
        InputValues: {
            [key: string]: string | number | boolean | null;
        };
        ListInputRequestsResponse: {
            data: components["schemas"]["InputRequest"][];
            page_info: components["schemas"]["PageInfo"];
        };
        ListRunEventsResponse: {
            data: components["schemas"]["RunEvent"][];
            page_info: components["schemas"]["PageInfo"];
        };
        ListRunEventTypesResponse: {
            data: {
                custom_names?: string[];
                description: string;
                /** @enum {string} */
                event_class: "fact" | "delta";
                fields: string[];
                group: string | null;
                legacy_types?: string[];
                name: string;
                /** @enum {string} */
                scope: "ag-ui" | "control-plane" | "extension";
                /** @enum {string} */
                status: "active" | "live_only" | "reserved" | "deprecated";
                type: string;
                /** @enum {string} */
                viewer_visibility: "full" | "sanitised" | "type_only";
            }[];
        };
        ListRunsResponse: {
            data: components["schemas"]["Run"][];
            page_info: components["schemas"]["PageInfo"];
        };
        MessagesSnapshotPayload: {
            messages: {
                [key: string]: unknown;
            }[];
            /** @enum {string} */
            type: "MESSAGES_SNAPSHOT";
        } & {
            messages: {
                content?: unknown;
                id?: string;
                parts?: {
                    type: string;
                }[];
                role?: string;
            }[];
            /** @enum {string} */
            type: "MESSAGES_SNAPSHOT";
        };
        ModelCallCompletedPayload: {
            /** Format: int64 */
            cacheCreationTokens: number;
            /** Format: int64 */
            cacheReadTokens: number;
            costCredits: string;
            /** Format: int64 */
            inputTokens: number;
            latencyMs: number | null;
            model: string;
            modelCallContextEventId: number | null;
            /** Format: int64 */
            outputTokens: number;
            provider: string;
            providerRequestId: string | null;
            /** Format: int64 */
            totalTokens: number;
            /** @enum {string} */
            type: "MODEL_CALL_COMPLETED";
            /** @enum {string} */
            usageCaptureStatus: "complete" | "missing";
        } & {
            /** Format: int64 */
            cacheCreationTokens: number;
            /** Format: int64 */
            cacheReadTokens: number;
            costCredits: string;
            /** Format: int64 */
            inputTokens: number;
            latencyMs: number | null;
            model: string;
            modelCallContextEventId: number | null;
            /** Format: int64 */
            outputTokens: number;
            provider: string;
            providerRequestId: string | null;
            /** Format: int64 */
            totalTokens: number;
            /** @enum {string} */
            type: "MODEL_CALL_COMPLETED";
            /** @enum {string} */
            usageCaptureStatus: "complete" | "missing";
        };
        /** @description Opaque cursor for the next page; null means there are no more results. */
        PageInfo: {
            next: string | null;
        };
        PaginationCursor: string;
        Problem: {
            code: string;
            detail?: string;
            errors?: {
                field: string;
                message: string;
            }[];
            instance?: string;
            /** Format: int64 */
            status: number;
            title: string;
            /** @description Problem type URI reference. */
            type: string;
        };
        ProjectReference: string;
        ReasoningContentPayload: {
            delta: string;
            messageId?: string;
            /** @enum {string} */
            type: "REASONING_CONTENT";
        } & {
            /** @enum {string} */
            type: "REASONING_CONTENT";
        };
        ReasoningEndPayload: {
            messageId?: string;
            /** @enum {string} */
            type: "REASONING_END";
        } & {
            /** @enum {string} */
            type: "REASONING_END";
        };
        ReasoningMessageContentPayload: {
            delta: string;
            messageId: string;
            /** @enum {string} */
            type: "REASONING_MESSAGE_CONTENT";
        } & {
            /** @enum {string} */
            type: "REASONING_MESSAGE_CONTENT";
        };
        ReasoningMessageEndPayload: {
            messageId: string;
            /** @enum {string} */
            type: "REASONING_MESSAGE_END";
        } & {
            /** @enum {string} */
            type: "REASONING_MESSAGE_END";
        };
        ReasoningMessageStartPayload: {
            messageId: string;
            /** @enum {string} */
            type: "REASONING_MESSAGE_START";
        } & {
            /** @enum {string} */
            type: "REASONING_MESSAGE_START";
        };
        ReasoningStartPayload: {
            messageId?: string;
            /** @enum {string} */
            type: "REASONING_START";
        } & {
            /** @enum {string} */
            type: "REASONING_START";
        };
        RespondToInputRequestRequest: {
            values: components["schemas"]["InputValues"];
        };
        ResumeRunRequest: {
            /** @enum {string} */
            type: "manual";
        } | {
            is_error?: boolean;
            /** @description A JSON value. */
            result: unknown;
            tool_call_id: string;
            /** @enum {string} */
            type: "tool_result";
        } | {
            integration: string;
            /** @enum {string} */
            type: "integration_connected";
        } | {
            approved: boolean;
            comment?: string;
            node_id: string;
            /** @enum {string} */
            type: "approval";
            wait_id: string;
        } | {
            name: string;
            /** @description A JSON value. */
            payload?: unknown;
            /** @enum {string} */
            type: "event";
            wait_id: string;
        };
        /** @description One execution resource returned by reads, creation, updates, and lifecycle actions. Omit irrelevant fields and empty groups. Errors appear only on failure; parent/root IDs only on child runs; timestamps appear when reached. Output is null until successful finalization. */
        Run: {
            /** @description Files produced by the run. */
            artifacts?: components["schemas"]["RunArtifact"][];
            /**
             * Format: uuid
             * @description Batch containing the run.
             */
            batch_id?: string;
            /** @description Definition-specific execution configuration. */
            config?: {
                [key: string]: unknown;
            };
            /** @description Pending control requests and the current wait. */
            control?: {
                cancellation?: components["schemas"]["RunCancellation"];
                pause?: components["schemas"]["RunPause"];
                waiting?: components["schemas"]["RunWait"];
            };
            /**
             * Format: uuid
             * @description Conversation containing the run.
             */
            conversation_id?: string;
            /**
             * Format: date-time
             * @description When the run was accepted.
             */
            created_at: string;
            /** @description Counts and usage across all descendant runs, excluding this run. */
            descendants?: {
                /**
                 * Format: int64
                 * @description Descendants that are pending, running or waiting.
                 */
                active: number;
                /** @description Whether any descendant has failed. */
                has_failures: boolean;
                /**
                 * Format: int64
                 * @description Total descendants at every depth.
                 */
                total: number;
                usage?: components["schemas"]["Usage"];
            };
            /** @description Failure details, present only when the run failed. */
            error?: components["schemas"]["RunFailure"];
            /** @description Resolved execution settings and diagnostics. */
            execution?: {
                /**
                 * Format: int64
                 * @description Current or last execution attempt, starting at 1; absent before execution.
                 */
                attempt?: number;
                /**
                 * Format: int64
                 * @description Elapsed time from first start to finish, including waits and retries; null when not finished.
                 */
                duration_ms?: number | null;
                exit_code?: number | null;
                logs?: string;
                /** Format: int64 */
                retry_limit?: number;
                /** @description Resolved logical runtime selection; main_branch identifies the selected main-branch deployment, not a worker process. */
                runtime?: components["schemas"]["RunRuntime"];
                /** @description Recorded execution start mode, when available. */
                start_mode?: string;
                /** Format: int64 */
                timeout_seconds?: number;
                /** Format: int64 */
                tool_error_count?: number;
            };
            /**
             * Format: date-time
             * @description When the run completed, failed or was cancelled.
             */
            finished_at?: string;
            /**
             * Format: uuid
             * @description Unique run UUID.
             */
            id: string;
            /** @description Business input supplied when the run was created. */
            input: unknown;
            /**
             * Format: uuid
             * @description Conversation message that supplied the input.
             */
            input_message_id?: string;
            /** @description Labels used to organize runs. */
            labels?: components["schemas"]["RunLabels"];
            /** @description Additional resource metadata. */
            metadata?: {
                [key: string]: unknown;
            };
            /** @description Final business output; null until successful finalization. */
            output: unknown;
            /**
             * Format: uuid
             * @description Conversation message containing the result.
             */
            output_message_id?: string;
            /**
             * Format: uuid
             * @description Immediate parent run ID, present on child runs.
             */
            parent_run_id?: string;
            /**
             * Format: uuid
             * @description Project containing the run.
             */
            project_id: string;
            /**
             * Format: uuid
             * @description Top-level ancestor run ID, present on child runs.
             */
            root_run_id?: string;
            /** @description Pinned schemas for business input and output; null means no declared schema. */
            schemas?: {
                input: {
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    sha256: string;
                } | null;
                output: {
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    sha256: string;
                } | null;
            };
            /**
             * Format: date-time
             * @description When the first execution attempt started, omitted before execution.
             */
            started_at?: string;
            /**
             * @description Current execution state.
             * @enum {string}
             */
            status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
            /** @description Execution definition; its ID may be null only on historical runs. */
            target: components["schemas"]["HistoricalRunTarget"];
            /** @description Orchestration task ID, distinct from the execution definition. */
            task_id?: string;
            /** @description Display title, omitted when unset. */
            title?: string;
            /** @description How execution was initiated. */
            trigger?: components["schemas"]["RunTrigger"];
            /**
             * Format: date-time
             * @description When the resource last changed, including usage updates.
             */
            updated_at: string;
            /** @description Usage when available; unknown measurements are null. */
            usage?: components["schemas"]["Usage"];
        } & (unknown & unknown & unknown & unknown & unknown & unknown & unknown);
        RunAnalytics: {
            models: {
                /**
                 * Format: double
                 * @description Number of uses.
                 */
                count: number;
                /** @description AI model identifier. */
                model: string;
                /** @description AI provider. */
                provider: string;
            }[];
            projects: {
                /**
                 * Format: double
                 * @description Number of matching records.
                 */
                count: number;
                /**
                 * Format: uuid
                 * @description Project ID, or null for unscoped usage.
                 */
                project_id: string | null;
                /** @description Project display name. */
                project_name: string;
                /** @description Project slug, or null when unavailable. */
                project_slug: string | null;
            }[];
            recent_runs: components["schemas"]["Run"][];
            series: {
                /** @description Bucket start timestamp. */
                bucket_start: string;
                /**
                 * Format: double
                 * @description Completed runs in the bucket.
                 */
                completed_runs: number;
                /**
                 * Format: double
                 * @description Failed runs in the bucket.
                 */
                failed_runs: number;
                /**
                 * Format: double
                 * @description Runs created in the bucket.
                 */
                runs: number;
            }[];
            statuses: {
                /**
                 * Format: double
                 * @description Number of matching records.
                 */
                count: number;
                /** @description Status or outcome label. */
                status: string;
            }[];
            summary: {
                /** @description Average completed run duration in milliseconds. */
                average_duration_ms: number | null;
                /**
                 * Format: double
                 * @description Completed runs in the timeframe.
                 */
                completed_runs: number;
                /**
                 * Format: double
                 * @description Failed runs in the timeframe.
                 */
                failed_runs: number;
                /** @description Most recent run creation timestamp. */
                last_run_at: string | null;
                /** @description 95th percentile completed run duration in milliseconds. */
                p95_duration_ms: number | null;
                /**
                 * Format: double
                 * @description Total agent runs in the timeframe.
                 */
                total_runs: number;
            };
            timeframe: {
                /**
                 * Format: double
                 * @description Number of buckets returned.
                 */
                bucket_count: number;
                /** @description Inclusive timeframe start timestamp. */
                from: string;
                /**
                 * @description Analytics aggregation granularity.
                 * @enum {string}
                 */
                granularity: "day";
                /** @description IANA timezone used for buckets. */
                timezone: string;
                /** @description Exclusive timeframe end timestamp. */
                to: string;
            };
            tools: {
                /**
                 * Format: double
                 * @description Number of uses.
                 */
                count: number;
                /** @description Tool name. */
                name: string;
            }[];
        };
        /** @description An immutable file reference authorized through the run’s project and conversation permissions. */
        RunArtifact: {
            artifact_id: string;
            /** Format: uri */
            href: string;
            media_type: string;
            sha256: string;
            /** Format: int64 */
            size_bytes: number;
            type: string;
        };
        RunCancellation: {
            /** Format: date-time */
            requested_at: string;
            /** Format: date-time */
            stopped_at: string | null;
        };
        RunErrorPayload: {
            code?: string;
            message?: string;
            metadata?: {
                [key: string]: unknown;
            };
            runId?: string;
            /** @enum {string} */
            type: "RUN_ERROR";
        } & {
            /** @enum {string} */
            type: "RUN_ERROR";
        };
        RunEvent: {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_ERROR";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunErrorPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_ARGS";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallArgsPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_CHUNK";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallChunkPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_RESULT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallResultPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STATE_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STATE_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "MESSAGES_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["MessagesSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STEP_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STEP_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "ACTIVITY_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivitySnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "ACTIVITY_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivityDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_AUTHORIZATION_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunAuthorizationSealedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_REQUEST_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRequestEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDefaultChatStartEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_SUBMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultSubmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultDeliveryFailedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_INTEGRATION_CONNECTION_REFUSED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunIntegrationConnectionRefusedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_OWNER_BOUND";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeOwnerBoundPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_INVOKE_RETRIED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeInvokeRetriedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTEXT_COMPACTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunContextCompactedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextRecordedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_DETACHED_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDetachedAcceptedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunInvokeAgentBillingModeRetainedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_BILLING_USAGE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunBillingUsageRetainedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_REPLAYED_UPLOADS_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunReplayedUploadsSealedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_CREATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestCreatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_UPDATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestUpdatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "CHILD_RUN_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ChildRunStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "MODEL_CALL_COMPLETED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ModelCallCompletedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_PARKED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunParkedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_LOG_CAPTURED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunLogCapturedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STREAM_HEARTBEAT_EMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StreamHeartbeatEmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "URL_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["UrlCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "DOCUMENT_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["DocumentCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "FILE_ATTACHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FileAttachedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "FILES_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FilesChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUNTIME_EVENT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RuntimeEventRecordedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchReceiptPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            event_type: string;
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            /** @description Payload of an unrecognized historical or future event. */
            payload: unknown;
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        };
        RunEventSnapshot: {
            /** Format: int64 */
            after_event_id: number;
            events: components["schemas"]["RunSnapshotEvent"][];
        };
        RunEventSummary: {
            /** @description Half-open time buckets `[start, end)` covering `first_event_at` through `last_event_at + 1 ms`. Boundaries use whole milliseconds; widths differ by at most 1 ms. Boundaries can be passed directly as the event-list `start` and `end` filters. The bucket count cannot exceed the span in milliseconds. Empty if no events match. */
            buckets: {
                /** Format: int64 */
                count: number;
                /** Format: date-time */
                end: string;
                /** Format: int64 */
                error_count: number;
                /** Format: date-time */
                start: string;
            }[];
            by_event_class: {
                /** Format: int64 */
                delta: number;
                /** Format: int64 */
                fact: number;
            };
            by_event_type: {
                /** Format: int64 */
                count: number;
                /** Format: int64 */
                error_count: number;
                /**
                 * @description The event class associated with this record.
                 * @enum {string}
                 */
                event_class: "fact" | "delta";
                event_type: string;
            }[];
            /** Format: int64 */
            error_count: number;
            /** Format: date-time */
            first_event_at: string | null;
            first_event_id: number | null;
            /** Format: date-time */
            last_event_at: string | null;
            last_event_id: number | null;
            /** Format: uuid */
            run_id: string;
            /** Format: int64 */
            total: number;
        };
        /** @description A short-lived event-append credential for the target child run; never grants finalization, heartbeat, or child creation. */
        RunEventToken: {
            /** Format: date-time */
            expires_at: string;
            permissions: "run.events.append"[];
            /** Format: uuid */
            run_id: string;
            token: string;
            /** @enum {string} */
            token_type: "Bearer";
        };
        /** @description Optional execution overrides; unsupported overrides return 400 before admission. Retry policy only repeats retryable failures. */
        RunExecutionOptions: {
            /** Format: int64 */
            retry_limit?: number;
            runtime?: components["schemas"]["RunRuntime"];
            /** Format: int64 */
            timeout_seconds?: number;
        };
        RunFailure: {
            code: string;
            details?: {
                [key: string]: unknown;
            };
            message: string;
        };
        RunFinishedPayload: {
            metadata?: {
                [key: string]: unknown;
            };
            runId?: string;
            /** @enum {string} */
            type: "RUN_FINISHED";
        } & {
            /** @enum {string} */
            type: "RUN_FINISHED";
        };
        RunHeartbeat: {
            /** Format: date-time */
            expires_at: string;
            /** Format: uuid */
            run_id: string;
        };
        RunLabels: {
            [key: string]: string;
        };
        RunLogCapturedPayload: {
            logs: string;
            /** @enum {string} */
            type: "RUN_LOG_CAPTURED";
        } & {
            logs: string;
            /** @enum {string} */
            type: "RUN_LOG_CAPTURED";
        };
        RunParkedPayload: {
            /** Format: int64 */
            lastEventId: number;
            reason: string;
            runId: string;
            /** @enum {string} */
            type: "RUN_PARKED";
        } & {
            /** Format: int64 */
            lastEventId: number;
            reason: string;
            runId: string;
            /** @enum {string} */
            type: "RUN_PARKED";
        };
        /** @description When a pause was requested; control.waiting confirms when execution is paused. */
        RunPause: {
            /** Format: date-time */
            requested_at: string;
        };
        /** @description Select an authorized deployment or registered runtime; omit to use the definition default. */
        RunRuntime: {
            /** @enum {string} */
            type: "main_branch";
        } | {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            type: "environment";
        } | {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            type: "preview_branch";
        } | {
            id: string;
            /** @enum {string} */
            type: "registered";
        };
        RunSnapshotEvent: {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_ERROR";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunErrorPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_ARGS";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallArgsPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_CHUNK";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallChunkPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_RESULT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallResultPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STATE_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STATE_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "MESSAGES_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["MessagesSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STEP_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STEP_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "ACTIVITY_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivitySnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "ACTIVITY_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivityDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_AUTHORIZATION_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunAuthorizationSealedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_REQUEST_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRequestEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDefaultChatStartEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_SUBMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultSubmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultDeliveryFailedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_INTEGRATION_CONNECTION_REFUSED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunIntegrationConnectionRefusedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_OWNER_BOUND";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeOwnerBoundPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_INVOKE_RETRIED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeInvokeRetriedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTEXT_COMPACTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunContextCompactedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextRecordedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_DETACHED_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDetachedAcceptedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunInvokeAgentBillingModeRetainedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_BILLING_USAGE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunBillingUsageRetainedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_REPLAYED_UPLOADS_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunReplayedUploadsSealedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_CREATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestCreatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_UPDATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestUpdatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "CHILD_RUN_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ChildRunStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "MODEL_CALL_COMPLETED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ModelCallCompletedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_PARKED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunParkedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_LOG_CAPTURED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunLogCapturedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STREAM_HEARTBEAT_EMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StreamHeartbeatEmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "URL_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["UrlCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "DOCUMENT_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["DocumentCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "FILE_ATTACHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FileAttachedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "FILES_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FilesChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUNTIME_EVENT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RuntimeEventRecordedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchReceiptPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            event_type: string;
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            /** @description Payload of an unrecognized historical or future event. */
            payload: unknown;
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        };
        RunStartedPayload: {
            runId?: string;
            /** @enum {string} */
            type: "RUN_STARTED";
        } & {
            /** @enum {string} */
            type: "RUN_STARTED";
        };
        RunStreamEvent: components["schemas"]["TextMessageStartPayload"] | components["schemas"]["TextMessageContentPayload"] | components["schemas"]["TextMessageEndPayload"] | components["schemas"]["ToolCallStartPayload"] | components["schemas"]["ToolCallArgsPayload"] | components["schemas"]["ToolCallChunkPayload"] | components["schemas"]["ToolCallEndPayload"] | components["schemas"]["ToolCallResultPayload"] | components["schemas"]["MessagesSnapshotPayload"] | components["schemas"]["StateSnapshotPayload"] | components["schemas"]["StateDeltaPayload"] | components["schemas"]["RunStartedPayload"] | components["schemas"]["RunFinishedPayload"] | components["schemas"]["RunErrorPayload"] | components["schemas"]["StepStartedPayload"] | components["schemas"]["StepFinishedPayload"] | components["schemas"]["ReasoningStartPayload"] | components["schemas"]["ReasoningMessageStartPayload"] | components["schemas"]["ReasoningMessageContentPayload"] | components["schemas"]["ReasoningMessageEndPayload"] | components["schemas"]["ReasoningContentPayload"] | components["schemas"]["ReasoningEndPayload"] | components["schemas"]["ActivitySnapshotPayload"] | components["schemas"]["ActivityDeltaPayload"] | components["schemas"]["ToolCallStatusChangedPayload"] | components["schemas"]["InputRequestCreatedPayload"] | components["schemas"]["InputRequestUpdatedPayload"] | components["schemas"]["ChildRunStatusChangedPayload"] | components["schemas"]["ModelCallCompletedPayload"] | components["schemas"]["RunParkedPayload"] | components["schemas"]["RunLogCapturedPayload"] | components["schemas"]["StreamHeartbeatEmittedPayload"] | components["schemas"]["UrlCitedPayload"] | components["schemas"]["DocumentCitedPayload"] | components["schemas"]["FileAttachedPayload"] | components["schemas"]["FilesChangedPayload"] | components["schemas"]["RuntimeEventRecordedPayload"] | components["schemas"]["AgentRunContextCompactedPayload"] | components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayload"] | components["schemas"]["AgentRunControlPlaneDispatchReceiptPayload"] | components["schemas"]["AgentRunToolExposureCheckpointedPayload"] | components["schemas"]["AgentRunToolExposureCheckpointPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointedPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointPayload"] | components["schemas"]["AgentRunModelCallContextRecordedPayload"] | components["schemas"]["AgentRunModelCallContextPayload"];
        /** @description Definition executed by this run. */
        RunTarget: {
            id: string;
            /** @enum {string} */
            type: "agent" | "task" | "workflow";
        };
        RuntimeEventRecordedPayload: {
            kind: string;
            runtime: string;
            /** @enum {string} */
            type: "RUNTIME_EVENT_RECORDED";
            value: unknown;
        } & {
            kind: string;
            runtime: string;
            /** @enum {string} */
            type: "RUNTIME_EVENT_RECORDED";
            value: unknown;
        };
        /** @description User, credential, automation or execution definition that directly started this run. */
        RunTrigger: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            type: "user";
        } | {
            id: string;
            /** @enum {string} */
            type: "api_key";
        } | {
            id: string;
            /** @enum {string} */
            type: "service_account";
        } | {
            id: string;
            /** @enum {string} */
            type: "system";
        } | {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            type: "schedule";
        } | {
            id: string;
            /** @enum {string} */
            type: "webhook";
        } | {
            id: string;
            tool_call_id?: string;
            /** @enum {string} */
            type: "agent";
        } | {
            id: string;
            /** @enum {string} */
            type: "task";
        } | {
            id: string;
            node_id?: string;
            /** @enum {string} */
            type: "workflow";
        };
        /** @description The current durable wait, with only the fields required to satisfy that wait. */
        RunWait: {
            /** @enum {string} */
            reason: "manual_pause";
            /** Format: date-time */
            resume_at?: string;
        } | {
            /** @enum {string} */
            reason: "tool_result";
            /** Format: date-time */
            resume_at?: string;
            tool_call_id: string;
        } | {
            integration: string;
            /** @enum {string} */
            reason: "integration_connected";
            /** Format: date-time */
            resume_at?: string;
        } | {
            node_ids: string[];
            /** @enum {string} */
            reason: "approval";
            /** Format: date-time */
            resume_at?: string;
            wait_id: string;
        } | {
            name: string;
            /** @enum {string} */
            reason: "event";
            /** Format: date-time */
            resume_at?: string;
            wait_id: string;
        } | {
            input_request_ids: string[];
            /** @enum {string} */
            reason: "input_request";
            /** Format: date-time */
            resume_at?: string;
        } | {
            dependencies: {
                correlation: {
                    id: string;
                    /** @enum {string} */
                    type: "tool_call";
                } | {
                    id: string;
                    /** @enum {string} */
                    type: "workflow_node";
                };
                /** Format: uuid */
                run_id: string;
            }[];
            /** @enum {string} */
            reason: "child_run";
            /** Format: date-time */
            resume_at?: string;
        };
        ScheduleRunRequest: {
            labels?: components["schemas"]["RunLabels"];
            /** Format: uuid */
            project_id: string;
            source: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                type: "schedule";
            };
            title?: string;
        };
        StateDeltaPayload: {
            delta?: unknown;
            /** @enum {string} */
            type: "STATE_DELTA";
        } & {
            delta: {
                [key: string]: unknown;
            } | {
                from?: string;
                /** @enum {string} */
                op: "add" | "remove" | "replace" | "move" | "copy" | "test";
                path: string;
                value?: unknown;
            }[];
            /** @enum {string} */
            type: "STATE_DELTA";
        };
        StateSnapshotPayload: {
            snapshot: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            type: "STATE_SNAPSHOT";
        } & {
            snapshot: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            type: "STATE_SNAPSHOT";
        };
        StepFinishedPayload: {
            runtime?: string;
            status?: string;
            stepId?: string;
            stepName?: string;
            /** @enum {string} */
            type: "STEP_FINISHED";
        } & {
            /** @enum {string} */
            type: "STEP_FINISHED";
        };
        StepStartedPayload: {
            runtime?: string;
            stepId?: string;
            stepName?: string;
            /** @enum {string} */
            type: "STEP_STARTED";
        } & {
            /** @enum {string} */
            type: "STEP_STARTED";
        };
        StreamHeartbeatEmittedPayload: {
            /** Format: int64 */
            lastEventId: number;
            runId: string;
            /** @enum {string} */
            type: "STREAM_HEARTBEAT_EMITTED";
        } & {
            /** Format: int64 */
            lastEventId: number;
            runId: string;
            /** @enum {string} */
            type: "STREAM_HEARTBEAT_EMITTED";
        };
        TextMessageContentPayload: {
            contentId?: string;
            delta: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_CONTENT";
        } & {
            contentId: string;
            delta: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_CONTENT";
        };
        TextMessageEndPayload: {
            contentId?: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_END";
        } & {
            contentId: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_END";
        };
        TextMessageStartPayload: {
            contentId: string;
            messageId: string;
            role?: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_START";
        } & {
            contentId: string;
            messageId: string;
            role?: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_START";
        };
        /** @description Input excludes cache reads/writes; output includes reasoning. Total is input + output + cache.read + cache.write. Null means unknown, never zero. */
        TokenUsage: {
            cache: {
                /** Format: int64 */
                read: number | null;
                /** Format: int64 */
                write: number | null;
            };
            /** Format: int64 */
            input: number | null;
            /** Format: int64 */
            output: number | null;
            /** Format: int64 */
            reasoning?: number | null;
            /** Format: int64 */
            total: number | null;
        };
        ToolCallArgsPayload: {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_ARGS";
        } & {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_ARGS";
        };
        ToolCallChunkPayload: {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_CHUNK";
        } & {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_CHUNK";
        };
        ToolCallEndPayload: {
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_END";
        } & {
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_END";
        };
        ToolCallResultPayload: {
            content?: unknown;
            isError: boolean | null;
            messageId?: string;
            parentMessageId?: string;
            /** @enum {string} */
            role?: "tool";
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_RESULT";
        } & {
            content?: unknown;
            input?: unknown;
            isError: boolean | null;
            messageId?: string;
            parentMessageId?: string;
            result?: unknown;
            /** @enum {string} */
            role?: "tool";
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_RESULT";
        };
        ToolCallStartPayload: {
            parentMessageId?: string;
            toolCallId: string;
            toolCallName: string;
            /** @enum {string} */
            type: "TOOL_CALL_START";
        } & {
            toolCallId: string;
            toolCallName: string;
            /** @enum {string} */
            type: "TOOL_CALL_START";
        };
        ToolCallStatusChangedPayload: {
            status: string;
            toolCallId: string;
            toolCallName: string | null;
            /** @enum {string} */
            type: "TOOL_CALL_STATUS_CHANGED";
        } & {
            status: string;
            toolCallId: string;
            toolCallName: string | null;
            /** @enum {string} */
            type: "TOOL_CALL_STATUS_CHANGED";
        };
        /** @description Update the run title or labels. */
        UpdateRunRequest: {
            labels?: components["schemas"]["RunLabels"] & unknown;
            /** @description Replace the display title; null clears it. */
            title?: string | null;
        };
        UrlCitedPayload: {
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "URL_CITED";
            url: string;
        } & {
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "URL_CITED";
            url: string;
        };
        /** @description Shared usage shape for a run, descendant aggregate, or evaluation; capture_status describes token capture coverage. Cost can remain unavailable independently. */
        Usage: {
            /** @enum {string} */
            capture_status: "complete" | "partial" | "missing";
            cost: components["schemas"]["Cost"];
            /** Format: int64 */
            model_calls?: number | null;
            tokens: components["schemas"]["TokenUsage"];
        };
        WebhookRunRequest: {
            /** @description A JSON value. */
            input: unknown;
            labels?: components["schemas"]["RunLabels"];
            /** Format: uuid */
            project_id: string;
            source: {
                id: string;
                /** @enum {string} */
                type: "webhook";
            };
            title?: string;
        };
    };
    responses: never;
    parameters: {
        /** @description Opaque cursor pointing at the next page. Omit it to read the first page. */
        PaginationCursor: components["schemas"]["PaginationCursor"];
        /** @description Project slug, UUID, or domain that identifies the project. */
        ProjectReference: components["schemas"]["ProjectReference"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getAccountRunAnalytics: {
        parameters: {
            query?: {
                label?: string[] | null;
                preset?: "7d" | "30d" | "90d";
                project_reference?: string;
                timezone?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Account run analytics statistics. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunAnalytics"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
            /** @description Server error. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listConversationChildRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                limit?: number;
                /** @description Filter by tool_call_id. */
                tool_call_id?: string;
            };
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listConversationInputRequests: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                limit?: number;
                run_id?: string;
                /** @description Lifecycle status for the target record. */
                status?: "open" | "submitted" | "cancelled" | "expired";
            };
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Input request page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListInputRequestsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listConversationRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                limit?: number;
                /** @description Filter by status. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                status?: string[];
            };
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getInputRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                input_request_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Input request */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    cancelInputRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                input_request_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled input request, including repeated cancellation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createInputResponse: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                input_request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RespondToInputRequestRequest"];
            };
        };
        responses: {
            /** @description InputRequest */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listEvalRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                limit?: number;
                sort_by?: "created_at" | "status";
                sort_order?: "asc" | "desc";
            };
            header?: never;
            path: {
                /** @example eval_example */
                eval_id: string;
                /**
                 * @description Project slug, UUID, or domain that identifies the project.
                 * @example example
                 */
                project_reference: components["schemas"]["ProjectReference"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listProjectRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                limit?: number;
                parent_run_id?: string;
                root_only?: "true" | "false";
                sort_by?: "created_at" | "status" | "duration";
                sort_order?: "asc" | "desc";
                /** @description Filter by status. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                status?: string[];
                /** @description Filter by execution definition ID. */
                target_id?: string[];
                /** @description Filter by execution definition type. */
                target_type?: ("agent" | "task" | "workflow" | "eval")[];
                /** @description Filter by the persisted orchestration task identity in task_id; this is distinct from the execution definition target. */
                task_id?: string;
                /** @description Filter by trigger_id. */
                trigger_id?: string;
                /** @description Filter by trigger_type. */
                trigger_type?: ("user" | "api_key" | "service_account" | "system" | "schedule" | "webhook" | "agent" | "task" | "workflow")[];
            };
            header?: never;
            path: {
                /** @example example */
                project_reference: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listProjectWebhookRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                limit?: number;
                sort_order?: "asc" | "desc";
            };
            header?: never;
            path: {
                /** @example example */
                project_reference: string;
                /** @example 00000000-0000-4000-8000-000000000001 */
                webhook_definition_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRuns: {
        parameters: {
            query?: {
                /** @description Restrict accessible runs to this conversation; filters intersect and never grant access. */
                conversation_id?: string;
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                limit?: number;
                parent_run_id?: string;
                /** @description Restrict accessible runs to this project; filters intersect and never grant access. */
                project_id?: string;
                root_only?: "true" | "false";
                sort_by?: "created_at" | "status" | "duration";
                sort_order?: "asc" | "desc";
                /** @description Filter by status. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                status?: string[];
                /** @description Filter by execution definition ID. */
                target_id?: string[];
                /** @description Filter by execution definition type. */
                target_type?: ("agent" | "task" | "workflow" | "eval")[];
                /** @description Filter by the persisted orchestration task identity in task_id; this is distinct from the execution definition target. */
                task_id?: string;
                /** @description Filter by trigger_id. */
                trigger_id?: string;
                /** @description Filter by trigger_type. */
                trigger_type?: ("user" | "api_key" | "service_account" | "system" | "schedule" | "webhook" | "agent" | "task" | "workflow")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRunRequest"];
            };
        };
        responses: {
            /** @description CreatedRun */
            202: {
                headers: {
                    /** @description Canonical run URL for status polling. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedRun"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run detail */
            200: {
                headers: {
                    /** @description Opaque version for conditional metadata updates. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    deleteRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run, its events, and owned input requests deleted; referenced artifact files are retained. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    updateRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description ETag from the latest run detail; prevents overwriting concurrent metadata changes.
                 * @example "run-version-1"
                 */
                "If-Match": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRunRequest"];
            };
        };
        responses: {
            /** @description Updated run */
            200: {
                headers: {
                    /** @description Opaque version for conditional metadata updates. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Run metadata changed since the supplied ETag */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 412;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description If-Match header required */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 428;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    cancelRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunChildRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                /** @description Maximum number of results to return. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRunEventToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Scoped event token created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEventToken"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunEvents: {
        parameters: {
            query?: {
                after_event_id?: number | null;
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                end?: string;
                /** @description The event class associated with this record. */
                event_class?: "fact" | "delta";
                /** @description Filter by event_type. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                event_type?: string[];
                include_descendants?: "true" | "false";
                is_error?: "true" | "false";
                limit?: number;
                search?: string;
                sort_order?: "asc" | "desc";
                span_id?: string;
                start?: string;
                turn_id?: string;
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run events */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunEventsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    appendRunEvents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AppendRunEventsRequest"];
            };
        };
        responses: {
            /** @description Events appended with updated durable cursor */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AppendRunEventsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getRunEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 1 */
                event_id: number;
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run event detail */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEvent"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getRunEventsSummary: {
        parameters: {
            query?: {
                buckets?: number;
                end?: string;
                /** @description The event class associated with this record. */
                event_class?: "fact" | "delta";
                /** @description Filter by event_type. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                event_type?: string[];
                include_descendants?: "true" | "false";
                is_error?: "true" | "false";
                search?: string;
                span_id?: string;
                start?: string;
                turn_id?: string;
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run event summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEventSummary"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
            /** @description Server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    finalizeRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FinalizeRunRequest"];
            };
        };
        responses: {
            /** @description Run */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRunHeartbeat: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRunHeartbeatRequestInput"];
            };
        };
        responses: {
            /** @description Execution lease renewal outcome */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunHeartbeat"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Run is cancelled, terminal, or no longer owned by this execution generation. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunInputRequests: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                limit?: number;
                /** @description Lifecycle status for the target record. */
                status?: "open" | "submitted" | "cancelled" | "expired";
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Input request page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListInputRequestsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRunInputRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateInputRequestRequestInput"];
            };
        };
        responses: {
            /** @description Input request created or idempotently replayed */
            201: {
                headers: {
                    /** @description Canonical input request URL. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    pauseRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    resumeRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResumeRunRequest"];
            };
        };
        responses: {
            /** @description Run */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getRunSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run stream snapshot */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEventSnapshot"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    streamRunEvents: {
        parameters: {
            query?: never;
            header?: {
                /** @example example */
                "Last-Event-ID"?: string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Agent event stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunEventTypes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run event type overview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunEventTypesResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
}
