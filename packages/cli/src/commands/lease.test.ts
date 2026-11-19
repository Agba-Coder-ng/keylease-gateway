import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireCommand,
  envCommand,
  envEntriesFor,
  fileSessionStore,
  mergeEnv,
  parseConsumerSecret,
  selectLease,
  type LeaseSession,
} from './lease.js';
import { verifySessionToken } from '../token.js';
import type { CliIo } from '../index.js';

const NOW_MS = 1_700_000_000_000;
const NOW = NOW_MS / 1000;
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

function memoryStore(initial: Record<string, LeaseSession[]> = {}) {
  const sessions: Record<string, LeaseSession[]> = { ...initial };
  return {
    sessions,
    load: async () => sessions,
    save: async (session: LeaseSession) => {
      if (!sessions[session.service]) {
        sessions[session.service] = [];
      }
      const idx = sessions[session.service].findIndex((s) => s.leaseId === session.leaseId);
      if (idx >= 0) {
        sessions[session.service][idx] = session;
      } else {
        sessions[session.service].push(session);
      }
    },
    saveAll: async (next: Record<string, LeaseSession[]>) => {
      for (const service of Object.keys(sessions)) delete sessions[service];
      Object.assign(sessions, next);
    },
  };
}

describe('parseConsumerSecret', () => {
  it('accepts a valid stellar secret seed', () => {
    expect(parseConsumerSecret(consumer.secret()).publicKey()).toBe(consumer.publicKey());
  });

  it('rejects anything else', () => {
    expect(() => parseConsumerSecret('password')).toThrow(/Stellar secret seed/);
  });
});

describe('acquireCommand', () => {
  it('invokes create_lease and mints a verifiable session token', async () => {
    const store = memoryStore();
    const { io, out } = captureIo();
    const calls: Array<Record<string, unknown>> = [];

    const code = await acquireCommand(
      {
        service: 'weather-api',
        calls: 7,
        duration: 600,
        secret: consumer.secret(),
        json: false,
      },
      io,
      {
        now: () => NOW_MS,
        store,
        createClient: () => ({
          createLease: async (params) => {
            calls.push({
              service: params.service,
              calls: params.calls,
              duration: params.duration,
              consumer: params.consumer.publicKey(),
            });
            return { leaseId: 'lease-xyz', txHash: 'aaaa1111' };
          },
        }),
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      { service: 'weather-api', calls: 7, duration: 600, consumer: consumer.publicKey() },
    ]);

    const sessions = store.sessions['weather-api'];
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.leaseId).toBe('lease-xyz');
    expect(session.consumer).toBe(consumer.publicKey());
    expect(session.expiresAt).toBe(NOW + 600);

    const payload = verifySessionToken(session.token, { now: NOW + 1 });
    expect(payload.lease_id).toBe('lease-xyz');
    expect(payload.consumer).toBe(consumer.publicKey());
    expect(out.join('\n')).toContain('Bearer kls1.');
  });

  it('appends new leases to existing service leases', async () => {
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-old',
          consumer: consumer.publicKey(),
          token: 'kls1.old.token',
          callsLimit: 5,
          issuedAt: NOW - 100,
          expiresAt: NOW + 500,
          txHash: null,
          network: 'testnet',
        },
      ],
    });
    const { io } = captureIo();

    const code = await acquireCommand(
      {
        service: 'weather-api',
        calls: 10,
        duration: 600,
        secret: consumer.secret(),
        json: false,
      },
      io,
      {
        now: () => NOW_MS,
        store,
        createClient: () => ({
          createLease: async () => ({ leaseId: 'lease-new', txHash: null }),
        }),
      },
    );

    expect(code).toBe(0);
    const sessions = store.sessions['weather-api'];
    expect(sessions).toHaveLength(2);
    expect(sessions[0].leaseId).toBe('lease-old');
    expect(sessions[1].leaseId).toBe('lease-new');
  });

  it('replaces lease idempotently when same leaseId acquired again', async () => {
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-1',
          consumer: consumer.publicKey(),
          token: 'kls1.token1',
          callsLimit: 5,
          issuedAt: NOW - 100,
          expiresAt: NOW + 500,
          txHash: 'old-hash',
          network: 'testnet',
        },
      ],
    });
    const { io } = captureIo();

    const code = await acquireCommand(
      {
        service: 'weather-api',
        calls: 15,
        duration: 600,
        secret: consumer.secret(),
        json: false,
      },
      io,
      {
        now: () => NOW_MS,
        store,
        createClient: () => ({
          createLease: async () => ({ leaseId: 'lease-1', txHash: 'new-hash' }),
        }),
      },
    );

    expect(code).toBe(0);
    const sessions = store.sessions['weather-api'];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].leaseId).toBe('lease-1');
    expect(sessions[0].txHash).toBe('new-hash');
    expect(sessions[0].callsLimit).toBe(15);
  });

  it('supports JSON output', async () => {
    const { io, out } = captureIo();
    const code = await acquireCommand(
      { service: 'weather-api', calls: 1, duration: 60, secret: consumer.secret(), json: true },
      io,
      {
        now: () => NOW_MS,
        store: memoryStore(),
        createClient: () => ({
          createLease: async () => ({ leaseId: 'lease-json', txHash: 'beef' }),
        }),
      },
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as Record<string, unknown>;
    expect(parsed['lease_id']).toBe('lease-json');
    expect(String(parsed['session_token'])).toContain('kls1.');
  });

  it('rejects an invalid secret before touching the chain', async () => {
    const { io, err } = captureIo();
    await expect(
      acquireCommand(
        { service: 'weather-api', calls: 1, duration: 60, secret: 'nope', json: false },
        io,
        { createClient: () => ({ createLease: async () => ({ leaseId: 'x', txHash: 'y' }) }) },
      ),
    ).rejects.toThrow(/Stellar secret seed/);
    expect(err).toEqual([]);
  });
});

describe('selectLease', () => {
  const baseSession: LeaseSession = {
    service: 'weather-api',
    leaseId: 'lease-xyz',
    consumer: 'GCC...',
    token: 'kls1.abc.def',
    callsLimit: 12,
    issuedAt: 100,
    expiresAt: 200,
    txHash: null,
    network: 'testnet',
  };

  it('returns undefined when no leases exist', () => {
    expect(selectLease([], NOW, undefined)).toBeUndefined();
  });

  it('selects newest unexpired lease by default', () => {
    const sessions: LeaseSession[] = [
      { ...baseSession, leaseId: 'lease-1', issuedAt: NOW - 100, expiresAt: NOW + 100 },
      { ...baseSession, leaseId: 'lease-2', issuedAt: NOW - 50, expiresAt: NOW + 200 },
      { ...baseSession, leaseId: 'lease-3', issuedAt: NOW - 25, expiresAt: NOW + 300 },
    ];
    const selected = selectLease(sessions, NOW, undefined);
    expect(selected?.leaseId).toBe('lease-3');
  });

  it('ignores expired leases when selecting newest', () => {
    const sessions: LeaseSession[] = [
      { ...baseSession, leaseId: 'lease-1', issuedAt: NOW - 200, expiresAt: NOW - 100 }, // expired
      { ...baseSession, leaseId: 'lease-2', issuedAt: NOW - 50, expiresAt: NOW + 200 }, // valid
    ];
    const selected = selectLease(sessions, NOW, undefined);
    expect(selected?.leaseId).toBe('lease-2');
  });

  it('returns undefined when all leases are expired', () => {
    const sessions: LeaseSession[] = [
      { ...baseSession, leaseId: 'lease-1', expiresAt: NOW - 100 },
      { ...baseSession, leaseId: 'lease-2', expiresAt: NOW - 50 },
    ];
    expect(selectLease(sessions, NOW, undefined)).toBeUndefined();
  });

  it('selects explicit lease by ID', () => {
    const sessions: LeaseSession[] = [
      { ...baseSession, leaseId: 'lease-1', expiresAt: NOW + 100 },
      { ...baseSession, leaseId: 'lease-2', expiresAt: NOW + 100 },
    ];
    const selected = selectLease(sessions, NOW, 'lease-2');
    expect(selected?.leaseId).toBe('lease-2');
  });

  it('selects explicit lease even if expired', () => {
    const sessions: LeaseSession[] = [
      { ...baseSession, leaseId: 'lease-1', expiresAt: NOW + 100 },
      { ...baseSession, leaseId: 'lease-2', expiresAt: NOW - 100 }, // expired
    ];
    const selected = selectLease(sessions, NOW, 'lease-2');
    expect(selected?.leaseId).toBe('lease-2');
  });

  it('returns undefined if explicit lease ID not found', () => {
    const sessions: LeaseSession[] = [
      { ...baseSession, leaseId: 'lease-1', expiresAt: NOW + 100 },
    ];
    expect(selectLease(sessions, NOW, 'lease-nonexistent')).toBeUndefined();
  });
});

describe('envEntriesFor', () => {
  const session: LeaseSession = {
    service: 'weather-api',
    leaseId: 'lease-xyz',
    consumer: 'GCC...',
    token: 'kls1.abc.def',
    callsLimit: 12,
    issuedAt: 100,
    expiresAt: 200,
    txHash: null,
    network: 'testnet',
  };

  it('exposes the temporary keys under KEYLEASE_* names', () => {
    expect(envEntriesFor(session)).toEqual({
      KEYLEASE_SERVICE: 'weather-api',
      KEYLEASE_LEASE_ID: 'lease-xyz',
      KEYLEASE_CONSUMER: 'GCC...',
      KEYLEASE_SESSION_TOKEN: 'kls1.abc.def',
      KEYLEASE_CALLS_LIMIT: '12',
      KEYLEASE_ISSUED_AT: '100',
      KEYLEASE_EXPIRES_AT: '200',
    });
  });
});

describe('mergeEnv', () => {
  it('appends keys to an empty file', () => {
    expect(mergeEnv('', { A: '1', B: '2' })).toBe('A=1\nB=2\n');
  });

  it('replaces known keys in place and preserves everything else', () => {
    const existing = ['FOO=bar', 'A=old', '# comment', 'A=duplicate', ''].join('\n');
    const merged = mergeEnv(existing, { A: 'new', B: 'added' });
    expect(merged).toBe('FOO=bar\nA=new\n# comment\nB=added\n');
  });

  it('keeps unrelated lines untouched on repeated writes', () => {
    const once = mergeEnv('', { KEYLEASE_SERVICE: 'x' });
    const twice = mergeEnv(once, { KEYLEASE_SERVICE: 'x' });
    expect(twice).toBe(once);
  });
});

describe('envCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'keylease-env-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes session keys into the target .env', async () => {
    const target = join(dir, '.env');
    const { io, out } = captureIo();
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-xyz',
          consumer: consumer.publicKey(),
          token: 'kls1.abc.def',
          callsLimit: 3,
          issuedAt: NOW,
          expiresAt: NOW + 600,
          txHash: null,
          network: 'testnet',
        },
      ],
    });

    const code = await envCommand({ service: 'weather-api', file: target, json: false }, io, {
      store,
      now: () => NOW_MS,
    });

    expect(code).toBe(0);
    const written = await readFile(target, 'utf8');
    expect(written).toContain('KEYLEASE_LEASE_ID=lease-xyz');
    expect(written).toContain('KEYLEASE_SESSION_TOKEN=kls1.abc.def');
    expect(out.join('\n')).toContain(target);
  });

  it('selects newest unexpired lease when multiple exist', async () => {
    const target = join(dir, '.env');
    const { io } = captureIo();
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-old',
          consumer: consumer.publicKey(),
          token: 'kls1.old.token',
          callsLimit: 3,
          issuedAt: NOW - 100,
          expiresAt: NOW + 100,
          txHash: null,
          network: 'testnet',
        },
        {
          service: 'weather-api',
          leaseId: 'lease-new',
          consumer: consumer.publicKey(),
          token: 'kls1.new.token',
          callsLimit: 5,
          issuedAt: NOW - 50,
          expiresAt: NOW + 500,
          txHash: null,
          network: 'testnet',
        },
      ],
    });

    const code = await envCommand({ service: 'weather-api', file: target, json: false }, io, {
      store,
      now: () => NOW_MS,
    });

    expect(code).toBe(0);
    const written = await readFile(target, 'utf8');
    expect(written).toContain('KEYLEASE_LEASE_ID=lease-new');
    expect(written).toContain('KEYLEASE_SESSION_TOKEN=kls1.new.token');
  });

  it('selects explicit lease by ID when provided', async () => {
    const target = join(dir, '.env');
    const { io } = captureIo();
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-1',
          consumer: consumer.publicKey(),
          token: 'kls1.token1',
          callsLimit: 3,
          issuedAt: NOW - 100,
          expiresAt: NOW + 200,
          txHash: null,
          network: 'testnet',
        },
        {
          service: 'weather-api',
          leaseId: 'lease-2',
          consumer: consumer.publicKey(),
          token: 'kls1.token2',
          callsLimit: 5,
          issuedAt: NOW - 50,
          expiresAt: NOW + 500,
          txHash: null,
          network: 'testnet',
        },
      ],
    });

    const code = await envCommand(
      { service: 'weather-api', file: target, json: false, lease: 'lease-1' },
      io,
      { store, now: () => NOW_MS }
    );

    expect(code).toBe(0);
    const written = await readFile(target, 'utf8');
    expect(written).toContain('KEYLEASE_LEASE_ID=lease-1');
    expect(written).toContain('KEYLEASE_SESSION_TOKEN=kls1.token1');
  });

  it('fails when all leases are expired', async () => {
    const target = join(dir, '.env');
    const { io, err } = captureIo();
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-1',
          consumer: consumer.publicKey(),
          token: 'kls1.token1',
          callsLimit: 3,
          issuedAt: NOW - 200,
          expiresAt: NOW - 100,
          txHash: null,
          network: 'testnet',
        },
        {
          service: 'weather-api',
          leaseId: 'lease-2',
          consumer: consumer.publicKey(),
          token: 'kls1.token2',
          callsLimit: 5,
          issuedAt: NOW - 150,
          expiresAt: NOW - 50,
          txHash: null,
          network: 'testnet',
        },
      ],
    });

    const code = await envCommand({ service: 'weather-api', file: target, json: false }, io, {
      store,
      now: () => NOW_MS,
    });

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('no valid lease found');
    expect(err.join('\n')).toContain('all 2 leases expired');
  });

  it('preserves existing variables in the .env', async () => {
    const target = join(dir, '.env');
    const { io } = captureIo();
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-xyz',
          consumer: consumer.publicKey(),
          token: 'kls1.abc.def',
          callsLimit: 3,
          issuedAt: NOW,
          expiresAt: NOW + 600,
          txHash: null,
          network: 'testnet',
        },
      ],
    });

    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, 'EXISTING=value\n');

    expect(
      await envCommand({ service: 'weather-api', file: target, json: false }, io, { store, now: () => NOW_MS })
    ).toBe(0);
    const written = await readFile(target, 'utf8');
    expect(written).toContain('EXISTING=value');
    expect(written).toContain('KEYLEASE_SERVICE=weather-api');
  });

  it('fails when no lease exists for the service', async () => {
    const { io, err } = captureIo();
    const code = await envCommand(
      { service: 'unknown', file: join(dir, '.env'), json: false },
      io,
      { store: memoryStore(), now: () => NOW_MS }
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('no lease found');
  });

  it('fails when explicit lease ID not found', async () => {
    const { io, err } = captureIo();
    const store = memoryStore({
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-1',
          consumer: consumer.publicKey(),
          token: 'kls1.token1',
          callsLimit: 3,
          issuedAt: NOW,
          expiresAt: NOW + 600,
          txHash: null,
          network: 'testnet',
        },
      ],
    });
    const code = await envCommand(
      { service: 'weather-api', file: join(dir, '.env'), json: false, lease: 'lease-nonexistent' },
      io,
      { store, now: () => NOW_MS }
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('no valid lease found');
    expect(err.join('\n')).toContain('requested lease lease-nonexistent not found');
  });
});

describe('fileSessionStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'keylease-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips sessions through disk in v2 format', async () => {
    const store = fileSessionStore(dir);
    await store.save({
      service: 'weather-api',
      leaseId: 'lease-1',
      consumer: consumer.publicKey(),
      token: 'kls1.x.y',
      callsLimit: 1,
      issuedAt: NOW,
      expiresAt: NOW + 60,
      txHash: null,
      network: 'testnet',
    });

    const reloaded = await fileSessionStore(dir).load();
    expect(reloaded['weather-api']).toHaveLength(1);
    expect(reloaded['weather-api']?.[0]?.leaseId).toBe('lease-1');
  });

  it('migrates v1 format (single session) to v2 format (array)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.keylease'), { recursive: true });

    const v1Store = {
      'weather-api': {
        service: 'weather-api',
        leaseId: 'lease-v1',
        consumer: consumer.publicKey(),
        token: 'kls1.v1.token',
        callsLimit: 10,
        issuedAt: NOW - 50,
        expiresAt: NOW + 300,
        txHash: 'abc123',
        network: 'testnet',
      },
    };

    await writeFile(join(dir, '.keylease', 'sessions.json'), JSON.stringify(v1Store));

    const store = fileSessionStore(dir);
    const loaded = await store.load();

    expect(loaded['weather-api']).toHaveLength(1);
    expect(loaded['weather-api']?.[0]?.leaseId).toBe('lease-v1');
    expect(loaded['weather-api']?.[0]?.txHash).toBe('abc123');
  });

  it('preserves v2 format (array of sessions) on load', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.keylease'), { recursive: true });

    const v2Store = {
      'weather-api': [
        {
          service: 'weather-api',
          leaseId: 'lease-1',
          consumer: consumer.publicKey(),
          token: 'kls1.token1',
          callsLimit: 5,
          issuedAt: NOW - 100,
          expiresAt: NOW + 200,
          txHash: null,
          network: 'testnet',
        },
        {
          service: 'weather-api',
          leaseId: 'lease-2',
          consumer: consumer.publicKey(),
          token: 'kls1.token2',
          callsLimit: 10,
          issuedAt: NOW - 50,
          expiresAt: NOW + 300,
          txHash: 'tx123',
          network: 'testnet',
        },
      ],
    };

    await writeFile(join(dir, '.keylease', 'sessions.json'), JSON.stringify(v2Store));

    const store = fileSessionStore(dir);
    const loaded = await store.load();

    expect(loaded['weather-api']).toHaveLength(2);
    expect(loaded['weather-api']?.[0]?.leaseId).toBe('lease-1');
    expect(loaded['weather-api']?.[1]?.leaseId).toBe('lease-2');
  });

  it('handles mixed v1 and v2 services in same store', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.keylease'), { recursive: true });

    const mixed = {
      'service-v1': {
        service: 'service-v1',
        leaseId: 'lease-v1',
        consumer: consumer.publicKey(),
        token: 'kls1.v1.token',
        callsLimit: 5,
        issuedAt: NOW,
        expiresAt: NOW + 100,
        txHash: null,
        network: 'testnet',
      },
      'service-v2': [
        {
          service: 'service-v2',
          leaseId: 'lease-2a',
          consumer: consumer.publicKey(),
          token: 'kls1.2a.token',
          callsLimit: 3,
          issuedAt: NOW - 50,
          expiresAt: NOW + 150,
          txHash: null,
          network: 'testnet',
        },
        {
          service: 'service-v2',
          leaseId: 'lease-2b',
          consumer: consumer.publicKey(),
          token: 'kls1.2b.token',
          callsLimit: 7,
          issuedAt: NOW - 25,
          expiresAt: NOW + 200,
          txHash: null,
          network: 'testnet',
        },
      ],
    };

    await writeFile(join(dir, '.keylease', 'sessions.json'), JSON.stringify(mixed));

    const store = fileSessionStore(dir);
    const loaded = await store.load();

    expect(loaded['service-v1']).toHaveLength(1);
    expect(loaded['service-v1']?.[0]?.leaseId).toBe('lease-v1');
    expect(loaded['service-v2']).toHaveLength(2);
    expect(loaded['service-v2']?.[0]?.leaseId).toBe('lease-2a');
    expect(loaded['service-v2']?.[1]?.leaseId).toBe('lease-2b');
  });

  it('replaces lease idempotently when same leaseId saved again', async () => {
    const store = fileSessionStore(dir);
    const session1 = {
      service: 'weather-api',
      leaseId: 'lease-1',
      consumer: consumer.publicKey(),
      token: 'kls1.token1',
      callsLimit: 5,
      issuedAt: NOW - 50,
      expiresAt: NOW + 300,
      txHash: 'old-hash',
      network: 'testnet' as const,
    };

    await store.save(session1);
    let loaded = await store.load();
    expect(loaded['weather-api']).toHaveLength(1);
    expect(loaded['weather-api']?.[0]?.txHash).toBe('old-hash');

    const session2 = {
      ...session1,
      txHash: 'new-hash',
      callsLimit: 10,
    };

    await store.save(session2);
    loaded = await store.load();
    expect(loaded['weather-api']).toHaveLength(1);
    expect(loaded['weather-api']?.[0]?.txHash).toBe('new-hash');
    expect(loaded['weather-api']?.[0]?.callsLimit).toBe(10);
  });

  it('rejects a corrupt store with an actionable error', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(dir, '.keylease'), { recursive: true });
    await writeFile(join(dir, '.keylease', 'sessions.json'), 'not json');
    const store = fileSessionStore(dir);
    await expect(store.load()).rejects.toThrow(/Cannot read session store.*corrupt.*Back up or repair/);
  });

  it('reports a missing store with guidance to acquire a lease', async () => {
    await expect(fileSessionStore(dir).load()).rejects.toThrow(
      /Cannot read session store.*missing.*keylease acquire/,
    );
  });
});
