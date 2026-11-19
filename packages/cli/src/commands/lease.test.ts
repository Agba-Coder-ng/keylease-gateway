import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
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
  quoteEnvValue,
  SessionStoreError,
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

/**
 * Minimal POSIX-shell reader for the `KEY=VALUE` lines `mergeEnv` writes:
 * bare words are read literally, double-quoted values honour the `\\`, `\"`
 * and `\$` escapes. Enough to prove the file survives `source`.
 */
function parseSourcedEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    const raw = line.slice(eq + 1);
    if (!raw.startsWith('"')) {
      env[key] = raw;
      continue;
    }
    let value = '';
    let closed = false;
    for (let i = 1; i < raw.length; i += 1) {
      const char = raw[i] as string;
      if (char === '\\' && i + 1 < raw.length) {
        const next = raw[i + 1] as string;
        if (next === '\\' || next === '"' || next === '$') {
          value += next;
          i += 1;
          continue;
        }
      }
      if (char === '"') {
        closed = true;
        break;
      }
      value += char;
    }
    if (!closed) throw new Error(`unterminated quoted value on line: ${line}`);
    env[key] = value;
  }
  return env;
}

function memoryStore(initial: Record<string, LeaseSession> = {}) {
  const sessions: Record<string, LeaseSession> = { ...initial };
  return {
    sessions,
    load: async () => sessions,
    save: async (session: LeaseSession) => {
      sessions[session.service] = session;
    },
    saveAll: async (next: Record<string, LeaseSession>) => {
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
        dryRun: false,
        json: false,
      },
      io,
      {
        now: () => NOW_MS,
        store,
        createClient: () => ({
          quote: async () => 0,
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

    const session = store.sessions['weather-api'] as LeaseSession;
    expect(session.leaseId).toBe('lease-xyz');
    expect(session.consumer).toBe(consumer.publicKey());
    expect(session.expiresAt).toBe(NOW + 600);

    const payload = verifySessionToken(session.token, { now: NOW + 1 });
    expect(payload.lease_id).toBe('lease-xyz');
    expect(payload.consumer).toBe(consumer.publicKey());
    expect(out.join('\n')).toContain('Bearer kls1.');
  });

  it('supports JSON output', async () => {
    const { io, out } = captureIo();
    const code = await acquireCommand(
      {
        service: 'weather-api',
        calls: 1,
        duration: 60,
        secret: consumer.secret(),
        dryRun: false,
        json: true,
      },
      io,
      {
        now: () => NOW_MS,
        store: memoryStore(),
        createClient: () => ({
          quote: async () => 0,
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
        {
          service: 'weather-api',
          calls: 1,
          duration: 60,
          secret: 'nope',
          dryRun: false,
          json: false,
        },
        io,
        {
          createClient: () => ({
            quote: async () => 0,
            createLease: async () => ({ leaseId: 'x', txHash: 'y' }),
          }),
        },
      ),
    ).rejects.toThrow(/Stellar secret seed/);
    expect(err).toEqual([]);
  });

  it('quotes the price on --dry-run without creating a lease or storing a session', async () => {
    const store = memoryStore();
    const { io, out } = captureIo();
    const quoted: Array<{ service: string; calls: number }> = [];

    const code = await acquireCommand(
      {
        service: 'weather-api',
        calls: 5,
        duration: 300,
        dryRun: true,
        json: false,
      },
      io,
      {
        now: () => NOW_MS,
        store,
        createClient: () => ({
          quote: async (service, calls) => {
            quoted.push({ service, calls });
            return 42;
          },
          createLease: async () => {
            throw new Error('createLease must not run on a dry run');
          },
        }),
      },
    );

    expect(code).toBe(0);
    expect(quoted).toEqual([{ service: 'weather-api', calls: 5 }]);
    expect(store.sessions).toEqual({});
    const text = out.join('\n');
    expect(text).toContain('Dry run');
    expect(text).toContain('calls      : 5');
    expect(text).toContain('duration   : 300s');
    expect(text).toContain('price      : 42');
    expect(text).toContain(new Date((NOW + 300) * 1000).toISOString());
  });

  it('supports JSON dry runs and derives the consumer from --secret', async () => {
    const { io, out } = captureIo();
    const code = await acquireCommand(
      {
        service: 'weather-api',
        calls: 2,
        duration: 60,
        secret: consumer.secret(),
        dryRun: true,
        json: true,
      },
      io,
      {
        now: () => NOW_MS,
        store: memoryStore(),
        createClient: () => ({
          quote: async () => 7,
          createLease: async () => {
            throw new Error('createLease must not run on a dry run');
          },
        }),
      },
    );

    expect(code).toBe(0);
    expect(JSON.parse(out.join('\n'))).toEqual({
      dry_run: true,
      service: 'weather-api',
      calls: 2,
      duration: 60,
      price: 7,
      expires_at: NOW + 60,
      consumer: consumer.publicKey(),
    });
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

describe('quoteEnvValue', () => {
  it('leaves plain values unquoted', () => {
    expect(quoteEnvValue('weather-api')).toBe('weather-api');
    expect(quoteEnvValue('kls1.payload.signature')).toBe('kls1.payload.signature');
    expect(quoteEnvValue('25')).toBe('25');
  });

  it('double-quotes values a shell would split, comment out or expand', () => {
    expect(quoteEnvValue('two words')).toBe('"two words"');
    expect(quoteEnvValue('svc#1')).toBe('"svc#1"');
    expect(quoteEnvValue('a$b')).toBe('"a\\$b"');
    expect(quoteEnvValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteEnvValue('back\\slash')).toBe('"back\\\\slash"');
    expect(quoteEnvValue('')).toBe('""');
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

  it('quotes values in place when replacing an existing key', () => {
    expect(mergeEnv('KEYLEASE_SERVICE=old\n', { KEYLEASE_SERVICE: 'new id' })).toBe(
      'KEYLEASE_SERVICE="new id"\n',
    );
  });

  it('round-trips every tricky value through a shell-compatible reader', () => {
    const entries = {
      KEYLEASE_SERVICE: 'weather api #1',
      KEYLEASE_LEASE_ID: 'lease-xyz',
      KEYLEASE_CONSUMER: consumer.publicKey(),
      KEYLEASE_SESSION_TOKEN: 'kls1.a$b.c"d.e\\f',
      KEYLEASE_CALLS_LIMIT: '25',
      KEYLEASE_ISSUED_AT: '1700000000',
      KEYLEASE_EXPIRES_AT: '1700000600',
    };

    const merged = mergeEnv('EXISTING=value\n', entries);
    expect(parseSourcedEnv(merged)).toEqual({ EXISTING: 'value', ...entries });
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
      'weather-api': {
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
    });

    const code = await envCommand({ service: 'weather-api', file: target, json: false }, io, {
      store,
    });

    expect(code).toBe(0);
    const written = await readFile(target, 'utf8');
    expect(written).toContain('KEYLEASE_LEASE_ID=lease-xyz');
    expect(written).toContain('KEYLEASE_SESSION_TOKEN=kls1.abc.def');
    expect(out.join('\n')).toContain(target);
  });

  it('quotes a service id that would break a sourced .env', async () => {
    const target = join(dir, '.env');
    const { io } = captureIo();
    const store = memoryStore({
      'weather api #1': {
        service: 'weather api #1',
        leaseId: 'lease-xyz',
        consumer: consumer.publicKey(),
        token: 'kls1.abc.def',
        callsLimit: 3,
        issuedAt: NOW,
        expiresAt: NOW + 600,
        txHash: null,
        network: 'testnet',
      },
    });

    expect(
      await envCommand({ service: 'weather api #1', file: target, json: false }, io, { store }),
    ).toBe(0);

    const written = await readFile(target, 'utf8');
    expect(written).toContain('KEYLEASE_SERVICE="weather api #1"');
    expect(parseSourcedEnv(written)['KEYLEASE_SERVICE']).toBe('weather api #1');
  });

  it('preserves existing variables in the .env', async () => {
    const target = join(dir, '.env');
    const { io } = captureIo();
    const store = memoryStore({
      'weather-api': {
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
    });

    await writeFile(target, 'EXISTING=value\n');

    expect(await envCommand({ service: 'weather-api', file: target, json: false }, io, { store })).toBe(0);
    const written = await readFile(target, 'utf8');
    expect(written).toContain('EXISTING=value');
    expect(written).toContain('KEYLEASE_SERVICE=weather-api');
  });

  it('fails when no lease exists for the service', async () => {
    const { io, err } = captureIo();
    const code = await envCommand(
      { service: 'unknown', file: join(dir, '.env'), json: false },
      io,
      { store: memoryStore() },
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('no lease found');
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

  it('round-trips sessions through disk', async () => {
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
    expect(reloaded['weather-api']?.leaseId).toBe('lease-1');
  });

  it('rejects a corrupt store with an actionable error', async () => {
    await mkdir(join(dir, '.keylease'), { recursive: true });
    await writeFile(join(dir, '.keylease', 'sessions.json'), 'not json');
    const store = fileSessionStore(dir);
    await expect(store.load()).rejects.toThrow(/Cannot read session store.*corrupt.*Back up or repair/);
  });

  const sessionFor = (service: string, leaseId: string) => ({
    service,
    leaseId,
    consumer: consumer.publicKey(),
    token: 'kls1.x.y',
    callsLimit: 1,
    issuedAt: NOW,
    expiresAt: NOW + 60,
    txHash: null,
    network: 'testnet',
  });

  it('keeps both sessions when two saves race', async () => {
    // Separate store instances model two `acquire` commands in one process.
    await Promise.all([
      fileSessionStore(dir).save(sessionFor('weather-api', 'lease-1')),
      fileSessionStore(dir).save(sessionFor('maps-api', 'lease-2')),
      fileSessionStore(dir).save(sessionFor('search-api', 'lease-3')),
    ]);

    const reloaded = await fileSessionStore(dir).load();
    expect(Object.keys(reloaded).sort()).toEqual(['maps-api', 'search-api', 'weather-api']);
    // No lock or temp files are left behind.
    expect(await readdir(join(dir, '.keylease'))).toEqual(['sessions.json']);
  });

  it('waits for a lock held by another process', async () => {
    const lockPath = join(dir, '.keylease', 'sessions.json.lock');
    await mkdir(join(dir, '.keylease'), { recursive: true });
    await writeFile(lockPath, '12345\n');

    const saving = fileSessionStore(dir, { lockTimeoutMs: 2_000 }).save(
      sessionFor('weather-api', 'lease-1'),
    );
    setTimeout(() => void rm(lockPath, { force: true }), 100);
    await saving;

    const reloaded = await fileSessionStore(dir).load();
    expect(reloaded['weather-api']?.leaseId).toBe('lease-1');
  });

  it('surfaces a clear error when the lock stays held', async () => {
    await mkdir(join(dir, '.keylease'), { recursive: true });
    await writeFile(join(dir, '.keylease', 'sessions.json.lock'), '12345\n');

    const store = fileSessionStore(dir, { lockTimeoutMs: 50 });
    const failure = store.save(sessionFor('weather-api', 'lease-1'));
    await expect(failure).rejects.toBeInstanceOf(SessionStoreError);
    await expect(failure).rejects.toMatchObject({ code: 'locked' });
    await expect(failure).rejects.toThrow(/locked.*sessions\.json\.lock/);
  });

  it('removes a stale lock once and retries', async () => {
    const lockPath = join(dir, '.keylease', 'sessions.json.lock');
    await mkdir(join(dir, '.keylease'), { recursive: true });
    await writeFile(lockPath, '12345\n');
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    await fileSessionStore(dir, { lockTimeoutMs: 50, staleLockMs: 10_000 }).save(
      sessionFor('weather-api', 'lease-1'),
    );
    const reloaded = await fileSessionStore(dir).load();
    expect(reloaded['weather-api']?.leaseId).toBe('lease-1');
  });

  it('serializes saveAll with concurrent saves', async () => {
    const store = fileSessionStore(dir);
    await store.save(sessionFor('weather-api', 'lease-1'));
    await Promise.all([
      store.saveAll({ 'weather-api': sessionFor('weather-api', 'lease-1') }),
      store.save(sessionFor('maps-api', 'lease-2')),
    ]);
    const reloaded = await fileSessionStore(dir).load();
    expect(Object.keys(reloaded).sort()).toEqual(['maps-api', 'weather-api']);
  });

  it('reports a missing store with guidance to acquire a lease', async () => {
    await expect(fileSessionStore(dir).load()).rejects.toThrow(
      /Cannot read session store.*missing.*keylease acquire/,
    );
  });
});
