import type { DemoJobData, DemoResult } from '@threads-id/contracts';

type WorkerRepo = {
  claim(id: string): Promise<boolean>;
  complete(id: string, result: DemoResult): Promise<void>;
  fail(id: string, error: string): Promise<void>;
};

export async function processDemoAction(job: DemoJobData, repo: WorkerRepo): Promise<void> {
  if (!(await repo.claim(job.actionId))) return;
  try {
    await repo.complete(job.actionId, {
      message: 'Simulasi konten observasi kebiasaan digital berhasil diproses.',
      editorialSample: job.sample
    });
  } catch (error) {
    await repo.fail(job.actionId, error instanceof Error ? error.message : 'Kesalahan worker tidak dikenal');
    throw error;
  }
}
