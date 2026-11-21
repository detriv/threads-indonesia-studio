import type { DemoResult } from '@threads-id/db';

type WorkerRepo = {
  claim(id: string): Promise<boolean>;
  complete(id: string, result: DemoResult): Promise<void>;
  fail(id: string, error: string): Promise<void>;
};

export async function processDemoAction(actionId: string, repo: WorkerRepo): Promise<void> {
  if (!(await repo.claim(actionId))) return;
  try {
    await repo.complete(actionId, {
      message: 'Simulasi aksi sintetis usia 20 detik berhasil diproses.',
      simulatedAgeSeconds: 20
    });
  } catch (error) {
    await repo.fail(actionId, error instanceof Error ? error.message : 'Kesalahan worker tidak dikenal');
    throw error;
  }
}
