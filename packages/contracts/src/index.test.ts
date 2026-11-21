import { describe, expect, it } from 'vitest';
import { actionSchema, actionStatusSchema, DEMO_JOB_NAME } from './index.js';

describe('contracts', () => {
  it('accepts a traceable demo action and rejects non-demo data', () => {
    expect(actionSchema.parse({ id: crypto.randomUUID(), kind: 'SYNTHETIC_AGE_20S', status: 'QUEUED', demo: true })).toMatchObject({ demo: true });
    expect(() => actionSchema.parse({ id: crypto.randomUUID(), kind: 'REAL_META_ACTION', status: 'QUEUED', demo: false })).toThrow();
    expect(actionStatusSchema.options).toEqual(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
    expect(DEMO_JOB_NAME).toBe('demo.synthetic-age-20s');
  });
});
