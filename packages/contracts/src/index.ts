import { z } from 'zod';

export const DEMO_JOB_NAME = 'demo.synthetic-age-20s' as const;
export const editorialSampleSchema = z.object({
  pillar: z.literal('KEBIASAAN_DIGITAL'),
  format: z.literal('OBSERVASI_PENDEK'),
  text: z.string().min(1)
});
export type EditorialSample = z.infer<typeof editorialSampleSchema>;
export const DEMO_EDITORIAL_SAMPLE: EditorialSample = {
  pillar: 'KEBIASAAN_DIGITAL',
  format: 'OBSERVASI_PENDEK',
  text: 'Niat buka HP buat cek jam. Lima menit kemudian udah baca debat cara nyimpen telur. Jamnya masih belum tahu.'
};
export const demoJobDataSchema = z.object({ actionId: z.uuid(), sample: editorialSampleSchema });
export type DemoJobData = z.infer<typeof demoJobDataSchema>;
export const demoResultSchema = z.object({
  message: z.string(),
  editorialSample: editorialSampleSchema.optional(),
  simulatedAgeSeconds: z.number().int().nonnegative().optional()
});
export type DemoResult = z.infer<typeof demoResultSchema>;
export const actionStatusSchema = z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const actionSchema = z.object({
  id: z.uuid(),
  kind: z.literal('SYNTHETIC_AGE_20S'),
  status: actionStatusSchema,
  demo: z.literal(true),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  result: demoResultSchema.nullable().optional(),
  error: z.string().nullable().optional()
});
export type DemoAction = z.infer<typeof actionSchema>;

export const createActionResponseSchema = z.object({ actionId: z.uuid(), status: z.literal('QUEUED'), demo: z.literal(true) });
export type CreateActionResponse = z.infer<typeof createActionResponseSchema>;

export const actionListSchema = z.array(actionSchema);
