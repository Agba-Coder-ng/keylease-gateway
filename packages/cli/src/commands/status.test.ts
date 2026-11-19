import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { mintSessionToken } from '../token.js';
import type { LeaseState } from '../client/soroban.js';
import type { CliIo } from '../index.js';
import { statusCommand, type LeaseStateProvider, type StatusArgs } from './status.js';

const NOW = 1_700_000_000;
const consumer = Keypair.random();

function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line = '') => out.push(line),
      err: (line = '') => err.push(line),
    },
  };
}

function makeLease(overrides: Partial<LeaseState> = {}): LeaseState {
  return {
    leaseId: '42',
    service: 'weather-api',
    provider: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    consumer: consumer.publicKey(),
    callsLimit: 10,
    callsUsed: 4,
    expiresAt: NOW + 600,
    active: true,
    settled: false,
    pricePaid: 10_000,
    ...overrides,
  };
}

function token(): string {
  return mintSessionToken({
    leaseId: '42',
    consumerSecret: consumer.secret(),
    issuedAt: NOW - 10,
    expiresAt: NOW + 300,
  });
}

function args(value: string, json = false): StatusArgs {
  return { token: value, checkChain: true, json };
}

describe('statusCommand --check-chain', () => {
  it('passes token and on-chain checks for a valid lease', async () => {
    const bearer = token();
    const { io, out } = captureIo();
    const provider: LeaseStateProvider = {
      getLeaseState: vi.fn(async () => makeLease()),
    };

    expect(
      await statusCommand(args(bearer, true), io, {
        leaseStateProvider: provider,
        now: () => NOW * 1000,
      }),
    ).toBe(0);

    const result = JSON.parse(out.join('\n')) as {
      token: { lease_id: string };
      checks: Record<string, { passed: boolean }>;
      lease: LeaseState;
    };
    expect(result.token.lease_id).toBe('42');
    expect(result.lease.service).toBe('weather-api');
    expect(Object.values(result.checks).every((check) => check.passed)).toBe(true);
    expect(provider.getLeaseState).toHaveBeenCalledWith('42');
    expect(out.join('\n')).not.toContain(bearer);
  });

  it('fails the lease-active check for a revoked lease', async () => {
    const { io, out } = captureIo();
    const provider: LeaseStateProvider = {
      getLeaseState: async () => makeLease({ active: false, settled: true }),
    };

    expect(
      await statusCommand(args(token()), io, {
        leaseStateProvider: provider,
        now: () => NOW * 1000,
      }),
    ).toBe(1);
    expect(out.join('\n')).toContain('lease active   : FAIL');
    expect(out.join('\n')).toContain('consumer match : PASS');
    expect(out.join('\n')).toContain('quota          : PASS');
  });

  it('keeps token checks visible and reports chain checks failed on RPC errors', async () => {
    const bearer = token();
    const { io, out } = captureIo();
    const provider: LeaseStateProvider = {
      getLeaseState: async () => {
        throw new Error('RPC unavailable');
      },
    };

    expect(
      await statusCommand(args(bearer), io, {
        leaseStateProvider: provider,
        now: () => NOW * 1000,
      }),
    ).toBe(1);
    expect(out.join('\n')).toContain('signature      : PASS');
    expect(out.join('\n')).toContain('expiry         : PASS');
    expect(out.join('\n')).toContain('lease active   : FAIL (chain lookup failed: RPC unavailable)');
    expect(out.join('\n')).not.toContain(bearer);
  });

  it('never echoes a deliberately malformed token in stderr', async () => {
    const malformed = 'kls1.invalid.token.with.too.many.parts';
    const { io, err } = captureIo();

    expect(
      await statusCommand(args(malformed), io, {
        now: () => NOW * 1000,
      }),
    ).toBe(1);

    const stderr = err.join('\n');
    expect(stderr).not.toContain('invalid');
    expect(stderr).not.toContain('kls1.invalid');
    expect(stderr).toContain('kls1.<redacted>');
  });

  it('redacts tokens in verification error messages', async () => {
    const malformed = 'kls1.notbase64url!!!.sig';
    const { io, err } = captureIo();

    await statusCommand(args(malformed, false), io, {
      now: () => NOW * 1000,
    });

    const stderr = err.join('\n');
    expect(stderr).not.toContain('kls1.notbase64url');
    expect(stderr).toContain('kls1.<redacted>');
  });
});
