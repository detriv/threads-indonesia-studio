import { describe, expect, it } from 'vitest';
import { actionSchema, actionStatusSchema, DEMO_EDITORIAL_SAMPLE, DEMO_JOB_NAME, demoJobDataSchema } from './index.js';

describe('contracts', () => {
  it('accepts a traceable demo action and rejects non-demo data', () => {
    expect(actionSchema.parse({ id: crypto.randomUUID(), kind: 'SYNTHETIC_AGE_20S', status: 'QUEUED', demo: true })).toMatchObject({ demo: true });
    expect(() => actionSchema.parse({ id: crypto.randomUUID(), kind: 'REAL_META_ACTION', status: 'QUEUED', demo: false })).toThrow();
    expect(actionStatusSchema.options).toEqual(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
    expect(DEMO_JOB_NAME).toBe('demo.synthetic-age-20s');
    expect(DEMO_EDITORIAL_SAMPLE).toMatchObject({
      pillar: 'KEBIASAAN_DIGITAL',
      format: 'OBSERVASI_PENDEK'
    });
    expect(DEMO_EDITORIAL_SAMPLE.text).toContain('cek jam');
    expect(demoJobDataSchema.parse({ actionId: crypto.randomUUID(), sample: DEMO_EDITORIAL_SAMPLE })).toMatchObject({
      sample: DEMO_EDITORIAL_SAMPLE
    });
  });
});
