import { BASE_FEE, Keypair, nativeToScVal } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  LeaseNotFoundError,
  SorobanClient,
  parseLeaseId,
  parseLeaseState,
  encodeLeaseState,
  type Transaction,
  type LeaseState,
  type SorobanRpc,
} from './soroban.js';

const consumer = Keypair.random();
const provider = Keypair.random();

const LEASE: LeaseState = {
  leaseId: '7',
  service: 'weather-api',
  provider: provider.publicKey(),
  consumer: consumer.publicKey(),
  callsLimit: 12,
  callsUsed: 3,
  expiresAt: 1_800_000_000,
  active: true,
  settled: false,
  pricePaid: 12_000,
};

describe('parseLeaseId', () => {
  it('accepts decimal u64 ids', () => {
    expect(parseLeaseId('1')).toBe(1n);
    expect(parseLeaseId('18446744073709551615')).toBe(0xffff_ffff_ffff_ffffn);
  });

  it('rejects anything else', () => {
    expect(() => parseLeaseId('lease-1')).toThrow(/decimal u64/);
    expect(() => parseLeaseId('0')).toThrow(/out of the u64 range/);
    expect(() => parseLeaseId('18446744073709551616')).toThrow(/out of the u64 range/);
  });
});

describe('parseLeaseState', () => {
  it('round-trips the contract struct layout', () => {
    const parsed = parseLeaseState(encodeLeaseState(LEASE), LEASE.leaseId);
    expect(parsed).toEqual(LEASE);
  });

  it('rejects a value that is not a map', () => {
    expect(() => parseLeaseState(nativeToScVal(1, { type: 'u32' }), '7')).toThrow(/scvMap/);
  });
});

describe('getLeaseState', () => {
  function clientWithSimulation(response: unknown): SorobanClient {
    const server = {
      simulateTransaction: async () => response,
    } as unknown as SorobanRpc;
    return new SorobanClient({
      server,
      contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  }

  it('maps contract Error(Contract, #5) to LeaseNotFoundError', async () => {
    const client = clientWithSimulation({
      _parsed: true,
      id: '1',
      latestLedger: 1,
      error: 'HostError: Error(Contract, #5)',
      events: [],
    });

    await expect(client.getLeaseState('9')).rejects.toBeInstanceOf(LeaseNotFoundError);
  });

  it('surfaces other simulation failures as contract errors', async () => {
    const client = clientWithSimulation({
      _parsed: true,
      id: '1',
      latestLedger: 1,
      error: 'HostError: Error(Contract, #6)',
      events: [],
    });

    await expect(client.getLeaseState('9')).rejects.toThrow(/Error\(6\)/);
  });
});

describe('transaction envelope options', () => {
  it('uses the supplied fee and timeout and preserves defaults when omitted', async () => {
    const transactions: Transaction[] = [];
    const server = {
      simulateTransaction: async (transaction: Transaction) => {
        transactions.push(transaction);
        return {
          _parsed: true,
          id: '1',
          latestLedger: 1,
          events: [],
          result: { retval: nativeToScVal(1_000, { type: 'i128' }) },
        };
      },
    } as unknown as SorobanRpc;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    try {
      const custom = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        fee: 2_500,
        timeout: 90,
      });
      await custom.quote('weather-api', 1);
      expect(transactions[0]?.fee).toBe('2500');
      expect(transactions[0]?.timeBounds?.maxTime).toBe('1704067290');

      const defaults = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });
      await defaults.quote('weather-api', 1);
      expect(transactions[1]?.fee).toBe(String(BASE_FEE));
      expect(transactions[1]?.timeBounds?.maxTime).toBe('1704067260');
    } finally {
      vi.useRealTimers();
    }
  });
});
