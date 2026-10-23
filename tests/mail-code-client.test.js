import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailCodeLookup } from '../src/mail-code-client.js';

const receivedAt = '2026-10-22T12:57:16Z';
const fresh = (at = receivedAt) => ({ code: 'HFCP5', receivedAt: at, expiresAt: new Date(Date.parse(at) + 300_000).toISOString() });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('missing, stale, unreadable and authorization failures finish after one request and allow retry', async () => {
  for (const code of ['MAIL_CODE_MISSING', 'MAIL_CODE_STALE', 'MAIL_CODE_UNREADABLE', 'MAIL_AUTH_FAILED']) {
    let calls = 0;
    const client = createMailCodeLookup({ now: () => Date.parse(receivedAt), request: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error(code), { code });
      return fresh();
    } });
    await assert.rejects(client.lookup('account'), { code });
    assert.equal(calls, 1);
    assert.equal((await client.lookup('account')).code, 'HFCP5');
    assert.equal(calls, 2);
  }
});

test('each completed click rereads mail and accepts the same fresh message or a newer message', async () => {
  const requests = [];
  const nextReceived = '2026-10-22T12:57:21Z';
  const client = createMailCodeLookup({ now: () => Date.parse(nextReceived), request: async (url, options) => {
    requests.push({ url, options });
    return fresh(requests.length > 2 ? nextReceived : receivedAt);
  } });
  assert.equal((await client.lookup('account')).receivedAt, receivedAt);
  assert.equal((await client.lookup('account')).receivedAt, receivedAt);
  assert.equal((await client.lookup('account')).receivedAt, nextReceived);
  assert.equal(requests.length, 3);
  for (const { url, options } of requests) {
    assert.equal(url, '/api/accounts/account/mail-code');
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), {});
  }
});

test('deduplicates an active account while other accounts finish independently', async () => {
  const slow = deferred();
  const requests = [];
  const client = createMailCodeLookup({ now: () => Date.parse(receivedAt), request: async url => {
    requests.push(url);
    return url.includes('/slow/') ? slow.promise : fresh();
  } });
  const first = client.lookup('slow');
  assert.equal(client.lookup('slow'), first);
  assert.equal((await client.lookup('fast')).code, 'HFCP5');
  assert.equal((await client.lookup('fast')).code, 'HFCP5');
  assert.equal(requests.length, 3);
  slow.resolve(fresh());
  await first;
});

test('timeout aborts the request, releases the account and ignores a late result even if the provider ignores cancellation', async () => {
  const stalled = deferred();
  let calls = 0;
  let firstSignal;
  const client = createMailCodeLookup({ timeoutMs: 10, now: () => Date.parse(receivedAt), request: (_url, { signal }) => {
    calls += 1;
    if (calls === 1) { firstSignal = signal; return stalled.promise; }
    return Promise.resolve(fresh());
  } });
  await assert.rejects(client.lookup('account'), /本次邮箱查询超时，请点击重试/);
  assert.equal(firstSignal.aborted, true);
  assert.equal((await client.lookup('account')).code, 'HFCP5');
  stalled.resolve(fresh());
  await Promise.resolve();
  assert.equal((await client.lookup('account')).code, 'HFCP5');
  assert.equal(calls, 3);
});

test('closing a view cancels all active queries and allows a later query', async () => {
  const signals = [];
  let closed = false;
  const client = createMailCodeLookup({ now: () => Date.parse(receivedAt), request: (_url, { signal }) => {
    signals.push(signal);
    return closed ? Promise.resolve(fresh()) : new Promise(() => {});
  } });
  const pending = [client.lookup('one'), client.lookup('two')];
  const rejected = pending.map(promise => assert.rejects(promise, { name: 'AbortError' }));
  client.cancel();
  await Promise.all(rejected);
  assert.ok(signals.every(signal => signal.aborted));
  closed = true;
  assert.equal((await client.lookup('one')).code, 'HFCP5');
});

test('expired and legacy responses are rejected once and do not leave the account locked', async () => {
  const results = [fresh(), { code: 'RTW4X', receivedAt }, fresh()];
  let calls = 0;
  const client = createMailCodeLookup({ now: () => Date.parse(receivedAt) + (calls === 1 ? 300_000 : 0), request: async () => results[calls++] });
  await assert.rejects(client.lookup('account'), { code: 'MAIL_CODE_STALE' });
  await assert.rejects(client.lookup('account'), /请更新服务器/);
  assert.equal((await client.lookup('account')).code, 'HFCP5');
  assert.equal(calls, 3);
});

test('a synchronous request failure also releases the account for retry', async () => {
  let calls = 0;
  const client = createMailCodeLookup({ now: () => Date.parse(receivedAt), request: () => {
    calls += 1;
    if (calls === 1) throw new Error('Network failed');
    return Promise.resolve(fresh());
  } });
  await assert.rejects(client.lookup('account'), /Network failed/);
  assert.equal((await client.lookup('account')).code, 'HFCP5');
});
