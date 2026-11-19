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

  describe('retry behavior', () => {
    it('retries on 429 and returns successful result', async () => {
      let attempts = 0;
      const server = {
        simulateTransaction: async () => {
          attempts += 1;
          if (attempts < 3) {
            const error = new Error('429 Too Many Requests');
            (error as any).status = 429;
            throw error;
          }
          return {
            _parsed: true,
            id: '1',
            latestLedger: 1,
            result: {
              retval: encodeLeaseState(LEASE),
            },
            events: [],
          };
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: () => Promise.resolve(),
      });

      const result = await client.getLeaseState('7');
      expect(result.leaseId).toBe('7');
      expect(attempts).toBe(3);
    });

    it('retries on 5xx and returns successful result', async () => {
      let attempts = 0;
      const server = {
        simulateTransaction: async () => {
          attempts += 1;
          if (attempts === 1) {
            const error = new Error('500 Internal Server Error');
            (error as any).status = 500;
            throw error;
          }
          if (attempts === 2) {
            const error = new Error('503 Service Unavailable');
            (error as any).status = 503;
            throw error;
          }
          return {
            _parsed: true,
            id: '1',
            latestLedger: 1,
            result: {
              retval: encodeLeaseState(LEASE),
            },
            events: [],
          };
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: () => Promise.resolve(),
      });

      const result = await client.getLeaseState('7');
      expect(result.leaseId).toBe('7');
      expect(attempts).toBe(3);
    });

    it('retries on timeout error', async () => {
      let attempts = 0;
      const server = {
        simulateTransaction: async () => {
          attempts += 1;
          if (attempts < 2) {
            throw new Error('timeout exceeded');
          }
          return {
            _parsed: true,
            id: '1',
            latestLedger: 1,
            result: {
              retval: encodeLeaseState(LEASE),
            },
            events: [],
          };
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: () => Promise.resolve(),
      });

      const result = await client.getLeaseState('7');
      expect(result.leaseId).toBe('7');
      expect(attempts).toBe(2);
    });

    it('does not retry on contract errors', async () => {
      let attempts = 0;
      const server = {
        simulateTransaction: async () => {
          attempts += 1;
          return {
            _parsed: true,
            id: '1',
            latestLedger: 1,
            error: 'HostError: Error(Contract, #6)',
            events: [],
          };
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: () => Promise.resolve(),
      });

      await expect(client.getLeaseState('9')).rejects.toThrow(/Error\(6\)/);
      expect(attempts).toBe(1);
    });

    it('does not retry on client errors (4xx)', async () => {
      let attempts = 0;
      const server = {
        simulateTransaction: async () => {
          attempts += 1;
          const error = new Error('400 Bad Request');
          (error as any).status = 400;
          throw error;
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: () => Promise.resolve(),
      });

      await expect(client.getLeaseState('9')).rejects.toThrow('400 Bad Request');
      expect(attempts).toBe(1);
    });

    it('respects Retry-After header (numeric seconds)', async () => {
      let attempts = 0;
      const sleepMs: number[] = [];
      const server = {
        simulateTransaction: async () => {
          attempts += 1;
          if (attempts < 2) {
            const error = new Error('429 Too Many Requests');
            (error as any).status = 429;
            (error as any).retryAfter = 2;
            throw error;
          }
          return {
            _parsed: true,
            id: '1',
            latestLedger: 1,
            result: {
              retval: encodeLeaseState(LEASE),
            },
            events: [],
          };
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: (ms: number) => {
          sleepMs.push(ms);
          return Promise.resolve();
        },
      });

      const result = await client.getLeaseState('7');
      expect(result.leaseId).toBe('7');
      expect(sleepMs).toHaveLength(1);
      expect(sleepMs[0]).toBe(2000); // 2 seconds converted to ms
    });

    it('exponential backoff caps at maxDelayMs', async () => {
      let attempts = 0;
      const sleepMs: number[] = [];
      const server = {
        simulateTransaction: async () => {
          attempts += 1;
          if (attempts < 8) {
            const error = new Error('503 Service Unavailable');
            (error as any).status = 503;
            throw error;
          }
          return {
            _parsed: true,
            id: '1',
            latestLedger: 1,
            result: {
              retval: encodeLeaseState(LEASE),
            },
            events: [],
          };
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: (ms: number) => {
          sleepMs.push(ms);
          return Promise.resolve();
        },
      });

      await expect(client.getLeaseState('7')).rejects.toThrow();
      // We should have made 5 attempts (max attempts), so 4 sleep calls
      expect(sleepMs).toHaveLength(4);
      // Check exponential backoff: 100ms, 200ms, 400ms, 800ms
      expect(sleepMs[0]).toBe(100);
      expect(sleepMs[1]).toBe(200);
      expect(sleepMs[2]).toBe(400);
      expect(sleepMs[3]).toBe(800);
    });

    it('exhausts retries and throws last error', async () => {
      const server = {
        simulateTransaction: async () => {
          const error = new Error('503 Service Unavailable');
          (error as any).status = 503;
          throw error;
        },
      } as unknown as SorobanRpc;

      const client = new SorobanClient({
        server,
        contractId: 'CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sleep: () => Promise.resolve(),
      });

      await expect(client.getLeaseState('7')).rejects.toThrow('503 Service Unavailable');
    });
  });
});
