import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  LeaseNotFoundError,
  SorobanClient,
  parseLeaseId,
  parseLeaseState,
  encodeLeaseState,
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
  it('accepts canonical decimal form', () => {
    expect(parseLeaseId('0')).toBe(0n);
    expect(parseLeaseId('1')).toBe(1n);
    expect(parseLeaseId('7')).toBe(7n);
    expect(parseLeaseId('42')).toBe(42n);
    expect(parseLeaseId('18446744073709551615')).toBe(0xffff_ffff_ffff_ffffn);
  });

  it('rejects leading zeros', () => {
    expect(() => parseLeaseId('00')).toThrow(/canonical decimal form/);
    expect(() => parseLeaseId('007')).toThrow(/canonical decimal form/);
    expect(() => parseLeaseId('01')).toThrow(/canonical decimal form/);
  });

  it('rejects out-of-range u64 values', () => {
    expect(() => parseLeaseId('18446744073709551616')).toThrow(/out of the u64 range/);
    expect(() => parseLeaseId('99999999999999999999')).toThrow(/out of the u64 range/);
  });

  it('rejects non-decimal formats', () => {
    expect(() => parseLeaseId('lease-1')).toThrow(/canonical decimal form/);
    expect(() => parseLeaseId('0x7')).toThrow(/canonical decimal form/);
    expect(() => parseLeaseId('1.5')).toThrow(/canonical decimal form/);
    expect(() => parseLeaseId('1e5')).toThrow(/canonical decimal form/);
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
