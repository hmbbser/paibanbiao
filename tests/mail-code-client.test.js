import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailCodeLookup } from '../src/mail-code-client.js';

const initialTime = Date.parse('2026-10-22T12:55:41Z');
const oldReceived = '2026-10-22T10:49:37Z';
const newReceived = '2026-10-22T12:57:16Z';
const fresh = (receivedAt = newReceived) => ({ code: 'HFCP5', receivedAt, expiresAt: new Date(Date.parse(receivedAt) + 300_000).toISOString() });

test('reproduces 95-second delivery delay: old code is never returned and newly delivered mail wins', async () => {
  let time = initialTime;
  const requests = [];
  const client = createMailCodeLookup({ now: () => time, sleep: async ms => { time += ms; }, request: async (url, options) => {
    requests.push({ url, options });
    if (time < Date.parse(newReceived)) throw Object.assign(new Error('stale'), { code: 'MAIL_CODE_STALE', receivedAt: oldReceived });
    return fresh();
  } });
  assert.equal((await client.lookup('account')).code, 'HFCP5');
  assert.equal(time - initialTime, 95_000);
  assert.equal(requests.length, 20);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(JSON.parse(requests[1].options.body).afterReceivedAt, oldReceived);
});

test('repeated clicks request a newer mail, even when it carries the same code', async () => {
  let time = Date.parse(newReceived);
  let calls = 0;
  const nextReceived = '2026-10-22T12:57:21Z';
  const client = createMailCodeLookup({ now: () => time, sleep: async ms => { time += ms; }, request: async (_url, options) => {
    calls += 1;
    if (calls === 1) return fresh();
    assert.equal(JSON.parse(options.body).afterReceivedAt, newReceived);
    if (time < Date.parse(nextReceived)) throw Object.assign(new Error('not new'), { code: 'MAIL_CODE_NOT_NEW', receivedAt: newReceived });
    return fresh(nextReceived);
  } });
  await client.lookup('account');
  const result = await client.lookup('account');
  assert.equal(result.receivedAt, nextReceived);
  assert.equal(result.code, 'HFCP5');
});

test('times out missing mail and fails unreadable or authorization errors immediately', async () => {
  let time = initialTime;
  const client = createMailCodeLookup({ now: () => time, sleep: async ms => { time += ms; }, request: async () => { throw Object.assign(new Error('missing'), { code: 'MAIL_CODE_MISSING' }); } });
  await assert.rejects(client.lookup('account'), /等待 2 分钟/);
  assert.equal(time - initialTime, 120_000);
  for (const code of ['MAIL_CODE_UNREADABLE', 'MAIL_AUTH_FAILED']) {
    const failing = createMailCodeLookup({ request: async () => { throw Object.assign(new Error(code), { code }); }, sleep: () => { assert.fail('Must not retry'); } });
    await assert.rejects(failing.lookup('account'), { code });
  }
});

test('deduplicates concurrent clicks and aborts polling when a view closes', async () => {
  let resolveRequest;
  let calls = 0;
  const client = createMailCodeLookup({ now: () => Date.parse(newReceived), request: () => { calls += 1; return new Promise(resolve => { resolveRequest = resolve; }); } });
  const first = client.lookup('account');
  const second = client.lookup('account');
  assert.equal(first, second);
  resolveRequest(fresh());
  await first;
  assert.equal(calls, 1);
  const cancel = createMailCodeLookup({ request: async () => { throw Object.assign(new Error('missing'), { code: 'MAIL_CODE_MISSING' }); } });
  const pending = cancel.lookup('account');
  await Promise.resolve();
  cancel.cancel();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('rejects a legacy response without freshness metadata', async () => {
  const client = createMailCodeLookup({ request: async () => ({ code: 'RTW4X', receivedAt: oldReceived }) });
  await assert.rejects(client.lookup('account'), /请更新服务器/);
});

test('enforces the waiting deadline even when a mailbox request stalls', async () => {
  const client = createMailCodeLookup({ waitMs: 10, request: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  await assert.rejects(client.lookup('account'), /仍未收到新验证码/);
});
