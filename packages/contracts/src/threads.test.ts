import { describe, expect, it } from 'vitest';
import {
  THREADS_JOB_NAME, THREADS_MAX_TEXT, THREADS_PUBLISH_WAIT_MS, THREADS_SCOPES,
  executionStatusSchema, publishStatusSchema, threadsConnectionStatusSchema
} from './index.js';

describe('kontrak Phase 3: Meta Threads', () => {
  it('mendefinisikan batas dan konstanta resmi Meta', () => {
    expect(THREADS_MAX_TEXT).toBe(500);
    expect(THREADS_PUBLISH_WAIT_MS).toBe(30_000);
    expect(THREADS_JOB_NAME).toBe('threads.publish-text');
    expect(THREADS_SCOPES).toEqual(['threads_basic', 'threads_content_publish']);
  });

  it('status koneksi mencakup kegagalan token/scope/kuota yang jujur', () => {
    expect(threadsConnectionStatusSchema.options).toEqual([
      'DISCONNECTED', 'CONNECTED', 'TOKEN_EXPIRED', 'AUTH_ERROR', 'SCOPE_MISSING', 'RATE_LIMITED', 'NOT_CONFIGURED'
    ]);
  });

  it('status antrean publish memisahkan ambigu dari gagal', () => {
    expect(publishStatusSchema.options).toEqual([
      'QUEUED', 'CONTAINER_CREATED', 'PUBLISHED', 'NEEDS_REVIEW', 'FAILED', 'DUPLICATE', 'REQUIRES_LIVE'
    ]);
  });

  it('status eksekusi gabungan: simulasi Phase 1 + hasil live Phase 3', () => {
    expect(executionStatusSchema.options).toEqual([
      'SIMULATED_OK', 'PUBLISHED', 'SKIPPED_STALE', 'SKIPPED_CANCELLED', 'SKIPPED_PAUSED', 'SKIPPED_LIMIT',
      'CANCELLED', 'FAILED', 'NEEDS_REVIEW', 'DUPLICATE', 'REQUIRES_LIVE'
    ]);
  });
});
