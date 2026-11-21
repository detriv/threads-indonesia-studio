import { z } from 'zod';

export const DEMO_JOB_NAME = 'demo.synthetic-age-20s' as const;
export const actionStatusSchema = z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const actionSchema = z.object({
  id: z.uuid(),
  kind: z.literal('SYNTHETIC_AGE_20S'),
  status: actionStatusSchema,
  demo: z.literal(true),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  result: z.object({ message: z.string(), simulatedAgeSeconds: z.number().int().nonnegative() }).nullable().optional(),
  error: z.string().nullable().optional()
});
export type DemoAction = z.infer<typeof actionSchema>;

export const createActionResponseSchema = z.object({ actionId: z.uuid(), status: z.literal('QUEUED'), demo: z.literal(true) });
export type CreateActionResponse = z.infer<typeof createActionResponseSchema>;

export const actionListSchema = z.array(actionSchema);
