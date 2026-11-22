import { describe, expect, it, vi } from 'vitest';
import { dispatchThreadsPublish } from './threads-processor.js';

/** Dispatcher berjalan tiap detik; tanpa cek eksplisit, pg-boss singletonKey
 * menghasilkan job duplikat ribuan untuk satu baris antrean. */
describe('dispatchThreadsPublish (dedupe)', () => {
  it('tidak mengirim job bila baris itu sudah punya job aktif', async () => {
    const send = vi.fn(async () => 'job-1');
    const pool = { query: vi.fn(async () => ({ rowCount: 1 })) };
    await dispatchThreadsPublish({ pendingQueue: async () => ['q-1'] } as never, { send } as never, pool as never);
    expect(send).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('hanya mengirim untuk baris yang belum punya job aktif', async () => {
    const send = vi.fn(async () => 'job-2');
    const pool = {
      query: vi.fn(async (_text: string, values: unknown[]) => ({ rowCount: values[1] === 'q-1' ? 1 : 0 }))
    };
    await dispatchThreadsPublish({ pendingQueue: async () => ['q-1', 'q-2'] } as never, { send } as never, pool as never);
    expect(send).toHaveBeenCalledOnce();
    expect((send.mock.calls[0] as unknown[])[1]).toEqual({ queueId: 'q-2' });
  });
});
