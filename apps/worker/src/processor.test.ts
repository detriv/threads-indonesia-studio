import { describe, expect, it, vi } from 'vitest';
import { processDemoAction } from './processor.js';

describe('demo worker', () => {
  it('completes an action exactly once', async () => {
    const repo = {
      claim: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined)
    };
    const job = {
      actionId: '11111111-1111-4111-8111-111111111111',
      sample: {
        pillar: 'KEBIASAAN_DIGITAL' as const,
        format: 'OBSERVASI_PENDEK' as const,
        text: 'Niat buka HP buat cek jam. Lima menit kemudian malah lupa jamnya.'
      }
    };
    await processDemoAction(job, repo);
    await processDemoAction(job, repo);
    expect(repo.complete).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith(
      job.actionId,
      expect.objectContaining({ editorialSample: job.sample })
    );
  });
});
