/**
 * Server Action Schemas
 *
 * Zod schemas for RSC server action validation.
 */

import { z } from "zod";

/**
 * Schema for action payload from client
 */
export const ActionPayloadSchema = z.object({
  id: z.string().min(1),
  args: z.array(z.unknown()).max(50).optional().default([]),
});

export type ActionPayload = z.infer<typeof ActionPayloadSchema>;
