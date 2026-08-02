/**
 * Per-event payload budget the conversation run append endpoint accepts.
 *
 * Owned by a leaf module so every producer of durable run events — the generic
 * normalizer and the model-call context envelope alike — sizes against one
 * number instead of a duplicated literal.
 */
export const MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES = 240 * 1024;
