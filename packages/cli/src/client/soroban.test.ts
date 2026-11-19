import { Keypair, nativeToScVal } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  LeaseNotFoundError,
  SorobanClient,
  parseLeaseId,
  parseLeaseState,
  encodeLeaseState,
  validateRpcUrl,
  SorobanError,
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

describe('validateRpcUrl', () => {
  it('accepts valid https URLs', () => {
    expect(() => validateRpcUrl('https://soroban-testnet.stellar.org')).not.toThrow();
    expect(() => validateRpcUrl('https://mainnet.sorobanrpc.com')).not.toThrow();
    expect(() =>
      validateRpcUrl('https://soroban-testnet.stellar.org:443/soroban/rpc'),
    ).not.toThrow();
  });

  it('accepts http URLs for localhost', () => {
    expect(() => validateRpcUrl('http://localhost:8000')).not.toThrow();
    expect(() => validateRpcUrl('http://localhost:8000/soroban/rpc')).not.toThrow();
    expect(() => validateRpcUrl('http://127.0.0.1:8000')).not.toThrow();
    expect(() => validateRpcUrl('http://[::1]:8000')).not.toThrow();
  });

  it('rejects invalid URLs', () => {
    expect(() => validateRpcUrl('not-a-url')).toThrow('must be a valid URL');
    expect(() => validateRpcUrl('localhost:8000')).toThrow('must be a valid URL');
    expect(() => validateRpcUrl('192.168.1.1:8000')).toThrow('must be a valid URL');
  });

  it('rejects wrong schemes', () => {
    expect(() => validateRpcUrl('ftp://example.com')).toThrow('scheme must be http: or https:');
    expect(() => validateRpcUrl('file:///path/to/file')).toThrow('scheme must be http: or https:');
    expect(() => validateRpcUrl('gopher://example.com')).toThrow('scheme must be http: or https:');
  });

  it('rejects http URLs that are not localhost', () => {
    expect(() => validateRpcUrl('http://example.com')).toThrow('localhost');
    expect(() => validateRpcUrl('http://192.168.1.1')).toThrow('localhost');
    expect(() => validateRpcUrl('http://staging.example.com:8000')).toThrow('localhost');
    expect(() => validateRpcUrl('http://example.com:8000/soroban/rpc')).toThrow('localhost');
  });

  it('catches typos like htps:// or htp://', () => {
    expect(() => validateRpcUrl('htps://example.com')).toThrow('scheme');
    expect(() => validateRpcUrl('htp://example.com')).toThrow('scheme');
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
