import { describe, expect, it, vi } from 'vitest';
import { processDemoAction } from './processor.js';

describe('demo worker', () => {
  it('completes an action exactly once', async () => {
    const repo = {
      claim: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined)
    };
    await processDemoAction('11111111-1111-4111-8111-111111111111', repo);
    await processDemoAction('11111111-1111-4111-8111-111111111111', repo);
    expect(repo.complete).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ simulatedAgeSeconds: 20 }));
  });
});
