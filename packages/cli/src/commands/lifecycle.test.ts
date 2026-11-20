import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { ContractCallError } from '../client/soroban.js';
import { revokeCommand, settleCommand } from './lifecycle.js';
import type { LeaseState } from '../client/soroban.js';
import type { CliIo } from '../index.js';

const consumer = Keypair.random();

function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line = '') => out.push(line), err: (line = '') => err.push(line) } };
}

function lease(overrides: Partial<LeaseState> = {}): LeaseState {
  return {
    leaseId: '42',
    service: 'weather-api',
    provider: 'GB6NFD3JZ2ZQY5Q7JQZ3QZ3QZ3QZ3QZ3QZ3QZ3QZ3QZ3QZ3QZ3QZ3QZ',
    consumer: consumer.publicKey(),
    callsLimit: 10,
    callsUsed: 4,
    expiresAt: 1_700_000_000,
    active: false,
    settled: true,
    pricePaid: 10_000,
    ...overrides,
  };
}

describe('settleCommand', () => {
  it('settles every requested lease and reports a summary table', async () => {
    const { io, out } = captureIo();
    const seen: Array<{ leaseId: string; signer: string }> = [];

    const code = await settleCommand(
      { lease: ['42', '43'], secret: consumer.secret(), json: false },
      io,
      {
        createClient: () => ({
          settle: async (leaseId: string, signer: Keypair) => {
            seen.push({ leaseId, signer: signer.publicKey() });
            return lease({ leaseId });
          },
        }),
      },
    );

    expect(code).toBe(0);
    expect(seen).toEqual([
      { leaseId: '42', signer: consumer.publicKey() },
      { leaseId: '43', signer: consumer.publicKey() },
    ]);
    const text = out.join('\n');
    expect(text).toContain('LEASE ID');
    expect(text).toContain('42        settled');
    expect(text).toContain('4000      6000');
    expect(text).toContain('43        settled');
  });

  it('supports --json', async () => {
    const { io, out } = captureIo();
    await settleCommand({ lease: ['42'], secret: consumer.secret(), json: true }, io, {
      createClient: () => ({ settle: async () => lease() }),
    });
    const parsed = JSON.parse(out.join('\n')) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ status: 'settled', leaseId: '42' });
  });

  it('continues past already-settled leases and reports other failures', async () => {
    const { io, out } = captureIo();
    const seen: string[] = [];

    const code = await settleCommand(
      { lease: ['old', 'ready', 'broken'], secret: consumer.secret(), json: true },
      io,
      {
        createClient: () => ({
          settle: async (leaseId) => {
            seen.push(leaseId);
            if (leaseId === 'old') throw new ContractCallError('settle', 9, 'AlreadySettled');
            if (leaseId === 'broken') throw new Error('RPC unavailable');
            return lease({ leaseId });
          },
        }),
      },
    );

    expect(code).toBe(1);
    expect(seen).toEqual(['old', 'ready', 'broken']);
    expect(JSON.parse(out.join('\n'))).toMatchObject([
      { leaseId: 'old', status: 'already_settled' },
      { leaseId: 'ready', status: 'settled' },
      { leaseId: 'broken', status: 'failed', error: 'RPC unavailable' },
    ]);
  });

  it('de-duplicates lease ids before submitting transactions', async () => {
    const { io, out } = captureIo();
    const seen: string[] = [];
    await settleCommand(
      { lease: ['1', '1,2', '2'], secret: consumer.secret(), json: true },
      io,
      {
        createClient: () => ({
          settle: async (leaseId) => {
            seen.push(leaseId);
            return lease({ leaseId });
          },
        }),
      },
    );

    expect(seen).toEqual(['1', '2']);
    expect(JSON.parse(out.join('\n'))).toHaveLength(2);
  });

  it('rejects an invalid secret before touching the chain', async () => {
    const { io } = captureIo();
    await expect(
      settleCommand({ lease: '42', secret: 'nope', json: false }, io, {
        createClient: () => ({ settle: async () => lease() }),
      }),
    ).rejects.toThrow(/Stellar secret seed/);
  });
});

describe('revokeCommand', () => {
  it('submits revoke and renders the refund', async () => {
    const { io, out } = captureIo();
    const code = await revokeCommand(
    { lease: '42', secret: consumer.secret(), json: false },
      io,
      { createClient: () => ({ revoke: async () => lease({ callsUsed: 1 }) }) },
    );

    expect(code).toBe(0);
    expect(out.join('\n')).toContain('42        revoked');
    expect(out.join('\n')).toContain('9000');
  });
});
