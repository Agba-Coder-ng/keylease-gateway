import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { revokeCommand, settleCommand, useCallCommand } from './lifecycle.js';
import { ContractCallError, type LeaseState } from '../client/soroban.js';
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
  it('submits settle with the consumer key and reports the payout split', async () => {
    const { io, out } = captureIo();
    const seen: Array<{ leaseId: string; signer: string }> = [];

    const code = await settleCommand(
      { lease: '42', secret: consumer.secret(), json: false },
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
    expect(seen).toEqual([{ leaseId: '42', signer: consumer.publicKey() }]);
    const text = out.join('\n');
    expect(text).toContain('Lease 42 settled');
    expect(text).toContain('paid out    : 4000');
    expect(text).toContain('refunded    : 6000');
  });

  it('supports --json', async () => {
    const { io, out } = captureIo();
    await settleCommand({ lease: '42', secret: consumer.secret(), json: true }, io, {
      createClient: () => ({ settle: async () => lease() }),
    });
    const parsed = JSON.parse(out.join('\n')) as Record<string, unknown>;
    expect(parsed['action']).toBe('settled');
    expect(parsed['leaseId']).toBe('42');
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

describe('useCallCommand', () => {
  it('commits calls with the gateway signer and reports the updated counters', async () => {
    const { io, out } = captureIo();
    const seen: Array<{ leaseId: string; count: number; signer: string }> = [];

    const code = await useCallCommand(
      { lease: '42', count: 3, secret: consumer.secret(), json: false },
      io,
      {
        createClient: () => ({
          useCalls: async (leaseId: string, count: number, gateway: Keypair) => {
            seen.push({ leaseId, count, signer: gateway.publicKey() });
            return lease({ leaseId, callsUsed: 7 });
          },
        }),
      },
    );

    expect(code).toBe(0);
    expect(seen).toEqual([{ leaseId: '42', count: 3, signer: consumer.publicKey() }]);
    expect(out.join('\n')).toContain('calls used  : 7/10');
  });

  it('supports --json with the updated calls_used and calls_limit', async () => {
    const { io, out } = captureIo();
    await useCallCommand(
      { lease: '42', count: 2, secret: consumer.secret(), json: true },
      io,
      { createClient: () => ({ useCalls: async () => lease({ callsUsed: 6 }) }) },
    );

    expect(JSON.parse(out.join('\n'))).toMatchObject({
      lease_id: '42',
      committed: 2,
      calls_used: 6,
      calls_limit: 10,
      remaining_calls: 4,
    });
  });

  it('explains an expired lease instead of surfacing the raw contract error', async () => {
    const { io } = captureIo();
    await expect(
      useCallCommand({ lease: '42', count: 1, secret: consumer.secret(), json: false }, io, {
        createClient: () => ({
          useCalls: async () => {
            throw new ContractCallError('use_call', 7, 'LeaseExpired');
          },
        }),
      }),
    ).rejects.toThrow(/lease 42 has expired/);
  });

  it('explains when the signer is not the registered gateway', async () => {
    const { io } = captureIo();
    await expect(
      useCallCommand({ lease: '42', count: 1, secret: consumer.secret(), json: false }, io, {
        createClient: () => ({
          useCalls: async () => {
            throw new ContractCallError('use_call', 14, 'Unauthorized');
          },
        }),
      }),
    ).rejects.toThrow(/not the registered gateway/);
  });

  it('explains an auth failure reported without a contract code', async () => {
    const { io } = captureIo();
    await expect(
      useCallCommand({ lease: '42', count: 1, secret: consumer.secret(), json: false }, io, {
        createClient: () => ({
          useCalls: async () => {
            throw new ContractCallError('use_call', null, 'invoke_host_function auth failed');
          },
        }),
      }),
    ).rejects.toThrow(/require_auth|not the registered gateway/);
  });

  it('rejects an invalid secret before touching the chain', async () => {
    const { io } = captureIo();
    await expect(
      useCallCommand({ lease: '42', count: 1, secret: 'nope', json: false }, io, {
        createClient: () => ({ useCalls: async () => lease() }),
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
    expect(out.join('\n')).toContain('Lease 42 revoked');
    expect(out.join('\n')).toContain('refunded    : 9000');
  });
});
