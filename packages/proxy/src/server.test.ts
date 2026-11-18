import { Keypair } from '@stellar/stellar-sdk';
import { mintSessionToken } from '@keylease/cli/token';
import type { LeaseState } from '@keylease/cli/soroban';
import { describe, expect, it, vi } from 'vitest';
import {
  buildProxyServer,
  buildUpstreamHeaders,
  resolveUpstreamUrl,
} from './server.js';
import { LeaseVerifier, type LeaseStateProvider } from './verifier.js';
import { resolveConfig, ProxyConfigError } from './index.js';

const consumer = Keypair.random();
const NOW = Math.floor(Date.now() / 1000);

function leaseState(overrides: Partial<LeaseState> = {}): LeaseState {
  return {
    leaseId: 'lease-1',
    service: 'weather-api',
    provider: 'GCCJ6YI4KDNQJWVXQY2QZ6XKQ2J6QJ6YI4KDNQJWVXQY2QZ6XKQ2J6Q',
    consumer: consumer.publicKey(),
    callsLimit: 10,
    callsUsed: 0,
    expiresAt: NOW + 3_600,
    active: true,
    settled: false,
    pricePaid: 10_000,
    ...overrides,
  };
}

function mintToken(leaseId = 'lease-1', signer = consumer): string {
  return mintSessionToken({
    leaseId,
    consumerSecret: signer.secret(),
    issuedAt: NOW,
    expiresAt: NOW + 3_600,
  });
}

function makeVerifier(provider: LeaseStateProvider): LeaseVerifier {
  return new LeaseVerifier({ provider, cacheTtlMs: 30_000 });
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): { impl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { impl, calls };
}

function okJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('resolveUpstreamUrl', () => {
  it('joins the request path and query onto the upstream origin', () => {
    expect(resolveUpstreamUrl('https://api.example.com', '/v1/weather?city=paris')).toBe(
      'https://api.example.com/v1/weather?city=paris',
    );
  });

  it('preserves an upstream base path prefix', () => {
    expect(resolveUpstreamUrl('https://api.example.com/gateway/', '/v1/weather')).toBe(
      'https://api.example.com/gateway/v1/weather',
    );
  });

  it('handles a bare "/" request', () => {
    expect(resolveUpstreamUrl('https://api.example.com', '/')).toBe(
      'https://api.example.com/',
    );
  });
});

describe('buildUpstreamHeaders', () => {
  it('drops hop-by-hop headers and the lease token by default', () => {
    const out = buildUpstreamHeaders({
      host: 'proxy.local',
      connection: 'keep-alive',
      'content-length': '12',
      authorization: 'Bearer kls1.a.b',
      'content-type': 'application/json',
      cookie: 'session=1',
    });

    expect(out).toEqual({ 'content-type': 'application/json', cookie: 'session=1' });
  });

  it('keeps the lease token when explicitly forwarded', () => {
    const out = buildUpstreamHeaders(
      { authorization: 'Bearer kls1.a.b' },
      { forwardAuthorization: true },
    );
    expect(out['authorization']).toBe('Bearer kls1.a.b');
  });

  it('preserves multi-value headers by folding them onto one field line', () => {
    const out = buildUpstreamHeaders({ 'x-multi': ['a', 'b'], cookie: ['a=1', 'b=2'] });
    expect(out['x-multi']).toBe('a, b');
    expect(out['cookie']).toBe('a=1; b=2');
  });
});

describe('proxy routing', () => {
  it('rejects requests without an Authorization header', async () => {
    const { impl, calls } = stubFetch(() => okJson({ upstream: true }));
    const provider: LeaseStateProvider = { getLeaseState: vi.fn(async () => leaseState()) };
    const app = buildProxyServer({ upstream: 'https://api.example.com', verifier: makeVerifier(provider), fetchImpl: impl });

    const res = await app.inject({ method: 'GET', url: '/v1/weather' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'missing_token' });
    expect(calls).toHaveLength(0);
    expect(provider.getLeaseState).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an invalid token without touching the chain', async () => {
    const { impl, calls } = stubFetch(() => okJson({ upstream: true }));
    const provider: LeaseStateProvider = { getLeaseState: vi.fn(async () => leaseState()) };
    const app = buildProxyServer({ upstream: 'https://api.example.com', verifier: makeVerifier(provider), fetchImpl: impl });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/weather',
      headers: { authorization: 'Bearer garbage' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid_token' });
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it('forwards an allowed request and returns the upstream response', async () => {
    const { impl, calls } = stubFetch(() => okJson({ temperature: 21 }));
    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({ getLeaseState: async () => leaseState() }),
      fetchImpl: impl,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/weather?city=paris',
      headers: {
        authorization: `Bearer ${mintToken()}`,
        'x-trace-id': 'abc',
        host: 'proxy.local',
        connection: 'keep-alive',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ temperature: 21 });
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['x-keylease-lease-id']).toBe('lease-1');
    expect(res.headers['x-keylease-calls-remaining']).toBe('9');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/weather?city=paris');
    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(init.method).toBe('GET');
    expect(init.headers['x-trace-id']).toBe('abc');
    expect(init.headers['x-keylease-lease-id']).toBe('lease-1');
    expect(init.headers['host']).toBeUndefined();
    expect(init.headers['connection']).toBeUndefined();
    expect(init.headers['authorization']).toBeUndefined();
    expect(init.headers['x-forwarded-for']).toContain('127.0.0.1');
    expect(init.body).toBeUndefined();

    await app.close();
  });

  it('strips the lease token but forwards method, body and content type', async () => {
    const { impl, calls } = stubFetch(() =>
      okJson({ created: true }, { status: 201 }),
    );
    const app = buildProxyServer({
      upstream: 'https://api.example.com/base',
      verifier: makeVerifier({ getLeaseState: async () => leaseState() }),
      fetchImpl: impl,
    });

    const payload = JSON.stringify({ query: 'rain' });
    const res = await app.inject({
      method: 'POST',
      url: '/search',
      headers: {
        authorization: `Bearer ${mintToken()}`,
        'content-type': 'application/json',
      },
      payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ created: true });

    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(calls[0]?.url).toBe('https://api.example.com/base/search');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['authorization']).toBeUndefined();
    expect(String(init.body)).toBe(payload);

    await app.close();
  });

  it('keeps the lease token when forwardAuthorization is enabled', async () => {
    const token = mintToken();
    const { impl, calls } = stubFetch(() => okJson({ ok: true }));
    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({ getLeaseState: async () => leaseState() }),
      fetchImpl: impl,
      forwardAuthorization: true,
    });

    await app.inject({ method: 'GET', url: '/', headers: { authorization: `Bearer ${token}` } });

    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> };
    expect(init.headers['authorization']).toBe(`Bearer ${token}`);
    await app.close();
  });

  it('refuses requests once the lease quota is exhausted', async () => {
    const { impl, calls } = stubFetch(() => okJson({ ok: true }));
    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({ getLeaseState: async () => leaseState({ callsLimit: 1 }) }),
      fetchImpl: impl,
    });

    const headers = { authorization: `Bearer ${mintToken()}` };
    const first = await app.inject({ method: 'GET', url: '/v1/data', headers });
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-keylease-calls-remaining']).toBe('0');

    const second = await app.inject({ method: 'GET', url: '/v1/data', headers });
    expect(second.statusCode).toBe(403);
    expect(second.json()).toMatchObject({ error: 'quota_exhausted' });
    expect(calls).toHaveLength(1);

    await app.close();
  });

  it('answers 403 when the lease does not exist on chain', async () => {
    const { impl, calls } = stubFetch(() => okJson({ ok: true }));
    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({
        getLeaseState: async (leaseId: string) => {
          throw Object.assign(new Error(`lease ${leaseId} was not found on chain`), {
            name: 'LeaseNotFoundError',
          });
        },
      }),
      fetchImpl: impl,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/data',
      headers: { authorization: `Bearer ${mintToken()}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'lease_not_found' });
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it('answers 503 when Soroban RPC is unavailable', async () => {
    const { impl } = stubFetch(() => okJson({ ok: true }));
    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({
        getLeaseState: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
      fetchImpl: impl,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/data',
      headers: { authorization: `Bearer ${mintToken()}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'verification_unavailable' });
    await app.close();
  });

  it('maps upstream failures to 502 and timeouts to 504', async () => {
    const provider: LeaseStateProvider = { getLeaseState: async () => leaseState() };

    const failing = stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const down = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier(provider),
      fetchImpl: failing.impl,
    });
    const downRes = await down.inject({
      method: 'GET',
      url: '/v1/data',
      headers: { authorization: `Bearer ${mintToken()}` },
    });
    expect(downRes.statusCode).toBe(502);
    expect(downRes.json()).toMatchObject({ error: 'bad_gateway' });
    await down.close();

    const timingOut = stubFetch(() => {
      throw Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
    });
    const slow = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier(provider),
      fetchImpl: timingOut.impl,
    });
    const slowRes = await slow.inject({
      method: 'GET',
      url: '/v1/data',
      headers: { authorization: `Bearer ${mintToken()}` },
    });
    expect(slowRes.statusCode).toBe(504);
    expect(slowRes.json()).toMatchObject({ error: 'gateway_timeout' });
    await slow.close();
  });

  it('forwards multi-value Set-Cookie headers', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    const { impl } = stubFetch(async () => new Response('ok', { status: 200, headers }));

    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({ getLeaseState: async () => leaseState() }),
      fetchImpl: impl,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/data',
      headers: { authorization: `Bearer ${mintToken()}` },
    });

    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
    expect(cookies.join(' ')).toContain('a=1');
    expect(cookies.join(' ')).toContain('b=2');
    await app.close();
  });

  it('preserves non-JSON upstream bodies and content types', async () => {
    const csv = 'city,temp\nparis,21\n';
    const { impl } = stubFetch(
      async () =>
        new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } }),
    );
    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({ getLeaseState: async () => leaseState() }),
      fetchImpl: impl,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/export',
      headers: { authorization: `Bearer ${mintToken()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv');
    expect(res.body).toBe(csv);
    await app.close();
  });

  it('answers HEAD without a body', async () => {
    const { impl } = stubFetch(
      async () => new Response('ignored', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const app = buildProxyServer({
      upstream: 'https://api.example.com',
      verifier: makeVerifier({ getLeaseState: async () => leaseState() }),
      fetchImpl: impl,
    });

    const res = await app.inject({
      method: 'HEAD',
      url: '/v1/data',
      headers: { authorization: `Bearer ${mintToken()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    await app.close();
  });

  describe('request body limits', () => {
    it('rejects a body one byte over the limit with 413 payload_too_large before verification', async () => {
      const maxBodyBytes = 100;
      const { impl } = stubFetch(async () => okJson({ ok: true }));
      const verifier = makeVerifier({ getLeaseState: async () => leaseState() });
      const verifySpy = vi.spyOn(verifier, 'verifyAuthorization');
      const app = buildProxyServer({
        upstream: 'https://api.example.com',
        verifier,
        fetchImpl: impl,
        maxBodyBytes,
      });

      const overLimitBody = Buffer.alloc(maxBodyBytes + 1, 'a');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/upload',
        headers: {
          authorization: `Bearer ${mintToken()}`,
          'content-type': 'application/octet-stream',
        },
        payload: overLimitBody,
      });

      expect(res.statusCode).toBe(413);
      const json = res.json();
      expect(json.error).toBe('payload_too_large');
      expect(json.message).toBeDefined();
      expect(verifySpy).not.toHaveBeenCalled();
      await app.close();
    });

    it('forwards a body at the limit', async () => {
      const maxBodyBytes = 100;
      let forwardedBody: Buffer | undefined;
      const { impl } = stubFetch(async (_url, init) => {
        forwardedBody = init?.body as Buffer;
        return okJson({ ok: true });
      });
      const verifier = makeVerifier({ getLeaseState: async () => leaseState() });
      const verifySpy = vi.spyOn(verifier, 'verifyAuthorization');
      const app = buildProxyServer({
        upstream: 'https://api.example.com',
        verifier,
        fetchImpl: impl,
        maxBodyBytes,
      });

      const atLimitBody = Buffer.alloc(maxBodyBytes, 'b');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/upload',
        headers: {
          authorization: `Bearer ${mintToken()}`,
          'content-type': 'application/octet-stream',
        },
        payload: atLimitBody,
      });

      expect(res.statusCode).toBe(200);
      expect(verifySpy).toHaveBeenCalled();
      expect(forwardedBody).toEqual(atLimitBody);
      await app.close();
    });
  });
});

describe('resolveConfig KEYLEASE_MAX_BODY_BYTES', () => {
  const baseEnv = { KEYLEASE_UPSTREAM_URL: 'https://api.example.com' };

  it('defaults to 32 MiB', () => {
    const config = resolveConfig(baseEnv);
    expect(config.maxBodyBytes).toBe(32 * 1024 * 1024);
  });

  it('parses valid positive integer', () => {
    const config = resolveConfig({ ...baseEnv, KEYLEASE_MAX_BODY_BYTES: '1048576' });
    expect(config.maxBodyBytes).toBe(1048576);
  });

  it('rejects invalid or non-positive values', () => {
    expect(() => resolveConfig({ ...baseEnv, KEYLEASE_MAX_BODY_BYTES: '0' })).toThrow(
      ProxyConfigError,
    );
    expect(() => resolveConfig({ ...baseEnv, KEYLEASE_MAX_BODY_BYTES: '-10' })).toThrow(
      ProxyConfigError,
    );
    expect(() => resolveConfig({ ...baseEnv, KEYLEASE_MAX_BODY_BYTES: 'abc' })).toThrow(
      ProxyConfigError,
    );
    expect(() => resolveConfig({ ...baseEnv, KEYLEASE_MAX_BODY_BYTES: '12.34' })).toThrow(
      ProxyConfigError,
    );
  });

  it('rejects values exceeding sane upper bound of 1 GiB', () => {
    expect(() =>
      resolveConfig({ ...baseEnv, KEYLEASE_MAX_BODY_BYTES: String(1024 * 1024 * 1024 + 1) }),
    ).toThrow(ProxyConfigError);
  });
});
