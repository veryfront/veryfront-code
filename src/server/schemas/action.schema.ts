import { z } from "zod";

/** Action payload from client for RSC server actions */
export const ActionPayloadSchema = z.object({
  id: z.string().min(1),
  args: z.array(z.unknown()).max(50).optional().default([]),
});

export type ActionPayload = z.infer<typeof ActionPayloadSchema>;
