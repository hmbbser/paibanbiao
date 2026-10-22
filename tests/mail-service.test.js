import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import session from 'express-session';
import { createMailService, createReadStateStore, fetchGraphFolder, fetchImapFolder, MAIL_FOLDERS, normalizeImapMessage, recipientMatches, requestMicrosoftToken, resolveImapFolder, scanMessages, withinLookupWindow } from '../server/mail-service.js';
import { registerMailCodeRoute, registerMailRoutes } from '../server/mail-routes.js';

const requestAt = '2026-10-20T10:00:00Z';
const mailbox = { id: 'mailbox-1', email: 'box@example.com', client_id: 'test-client', refresh_token: 'test-refresh' };
const message = (id, receivedAt, code = 'A1B2C', overrides = {}) => ({ id, mailbox: 'Inbox', receivedAt, subject: 'Steam Guard', sender: 'noreply@steampowered.com', to: ['alias@example.com'], text: `Your Steam Guard code is: ${code}`, html: '', ...overrides });
const response = (value, next) => ({ ok: true, json: async () => ({ value, ...(next ? { '@odata.nextLink': next } : {}) }) });
const graphMessage = (id, overrides = {}) => ({ id, receivedDateTime: '2026-10-20T09:59:00Z', subject: 'Steam', body: { contentType: 'text', content: 'complete body' }, toRecipients: [{ emailAddress: { address: 'alias@example.com' } }], ...overrides });

test('newest matching code and recovery link are chosen across both folders', async () => {
  const service = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => ({ hasMore: false, messages: folder.label === 'Inbox'
    ? [message('old', '2026-10-20T09:55:00Z')]
    : [message('new', '2026-10-20T09:59:00Z', 'X9Y8Z', { mailbox: 'Junk' })] }) });
  assert.equal((await service.find(mailbox, 'alias@example.com', { requestAt })).code, 'X9Y8Z');
  assert.equal((await service.find(mailbox, 'alias@example.com', { requestAt })).mailbox, 'Junk');
  const recovery = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => ({ hasMore: false, messages: [message(folder.label, folder.label === 'Inbox' ? '2026-10-20T09:55:00Z' : '2026-10-20T09:59:00Z', '', {
    mailbox: folder.label, subject: 'Steam account recovery', text: `https://help.steampowered.com/zh-cn/wizard/VerifyCode?c=${folder.label}`
  })] }) });
  assert.match((await recovery.find(mailbox, 'alias@example.com', { requestAt }, 'link')).link, /c=Junk/);
});

test('lookup filters exact recipients, expired messages and future timestamps', () => {
  const records = [
    message('future', '2026-10-20T10:03:00Z', 'F9F9F'),
    message('other', '2026-10-20T09:59:59Z', 'E8E8E', { to: ['not-alias@example.com'] }),
    message('expired', '2026-10-20T09:49:59Z', 'D7D7D'),
    message('valid', '2026-10-20T09:52:00Z', 'V1V1V', { to: [], headers: ['Delivered-To: ALIAS@example.com'] })
  ];
  assert.equal(scanMessages(records, 'alias@example.com', { requestAt, windowMinutes: 10 }).code, 'V1V1V');
  assert.equal(withinLookupWindow('bad date', requestAt, 10), false);
  assert.equal(withinLookupWindow('2026-10-20T09:50:00Z', requestAt, 10), true);
  assert.equal(recipientMatches(records[1], 'alias@example.com'), false);
});

test('invalid lookup windows are rejected before contacting either provider', async () => {
  let calls = 0;
  const service = createMailService({ token: async () => { calls += 1; return 'token'; } });
  for (const windowMinutes of [0, -1, 'invalid', Infinity, Number.MAX_VALUE]) {
    await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt, windowMinutes }), { code: 'INVALID_LOOKUP_WINDOW', status: 400 });
  }
  await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt: '' }), { code: 'INVALID_LOOKUP_WINDOW' });
  assert.equal(calls, 0);
});

test('latest code lookup filters future mail and recipients and compares fresh mail in both folders', async () => {
  const optionsSeen = [];
  const service = createMailService({ token: async () => 'token', graphFolder: async (_token, folder, options) => {
    optionsSeen.push(options);
    return { hasMore: false, messages: folder.label === 'Inbox' ? [
      message('future', '2026-10-20T10:00:01Z', 'F9F9F'),
      message('other', '2026-10-20T09:59:00Z', 'E8E8E', { to: ['other@example.com'] }),
      message('inbox', '2026-10-20T09:57:00Z', 'A1A1A')
    ] : [message('junk', '2026-10-20T09:58:00Z', 'Z9Z9Z', { mailbox: 'Junk' })] };
  } });
  const result = await service.find(mailbox, 'alias@example.com', { requestAt, latest: true });
  assert.equal(result.code, 'Z9Z9Z');
  assert.equal(result.receivedAt, '2026-10-20T09:58:00Z');
  assert.equal(result.expiresAt, '2026-10-20T10:03:00.000Z');
  assert.equal(result.mailbox, 'Junk');
  assert.ok(optionsSeen.every(options => !options.since && options.expectedEmail === 'alias@example.com'));
  await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt: '', latest: true }), { code: 'INVALID_LOOKUP_WINDOW' });
});

test('latest lookup retains incomplete-folder errors and IMAP fallback for the newest code', async () => {
  const service = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => {
    if (folder.label === 'Junk') throw new Error('Graph unavailable');
    return { hasMore: false, messages: [message('old', '2026-10-18T09:00:00Z')] };
  }, imapFolder: async (_box, _token, folder, options) => {
    assert.equal(options.latest, true);
    return { hasMore: false, messages: [message('new', '2026-10-20T09:59:00Z', 'Z9Z9Z', { mailbox: folder.label })] };
  } });
  assert.equal((await service.find(mailbox, 'alias@example.com', { requestAt, latest: true })).code, 'Z9Z9Z');
  const incomplete = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => ({
    hasMore: folder.label === 'Junk', messages: [message(folder.label, '2026-10-19T09:00:00Z')]
  }) });
  await assert.rejects(incomplete.find(mailbox, 'alias@example.com', { requestAt, latest: true }), { code: 'MAIL_INCOMPLETE' });
});

test('latest code rejects historical mail, repeat mail and unreadable latest login mail', async () => {
  let records = [message('old', '2026-10-20T08:49:37Z', 'RTW4X')];
  const service = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => ({
    hasMore: false, messages: folder.label === 'Inbox' ? records : []
  }) });
  await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt, latest: true }), { code: 'MAIL_CODE_STALE', status: 409, receivedAt: records[0].receivedAt });
  records = [message('fresh', '2026-10-20T09:59:00Z')];
  await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt, latest: true, afterReceivedAt: records[0].receivedAt }), { code: 'MAIL_CODE_NOT_NEW' });
  assert.ok(await service.find(mailbox, 'alias@example.com', { requestAt, latest: true, afterReceivedAt: '2026-10-20T09:58:59Z' }));
  await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt, latest: true, afterReceivedAt: 'invalid' }), { code: 'INVALID_LOOKUP_WINDOW' });
  records.unshift(message('unreadable', '2026-10-20T09:59:30Z', '', { subject: '您的 Steam 帐户：来自新网页或移动设备的访问', text: 'Body temporarily missing' }));
  await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt, latest: true }), { code: 'MAIL_CODE_UNREADABLE', status: 422 });
});

test('unreadable older login in one folder cannot override a newer code in the other folder', async () => {
  const service = createMailService({ token: async () => 'token', graphFolder: (token, folder, options) => fetchGraphFolder(token, folder, options, async () => response([
    graphMessage(folder.label, { receivedDateTime: folder.label === 'Inbox' ? '2026-10-20T09:59:00Z' : '2026-10-20T09:58:00Z', subject: 'Steam Guard',
      body: { contentType: 'text', content: folder.label === 'Inbox' ? 'Steam Guard code: HFCP5' : 'Steam Guard code: [missing]' } })
  ])) });
  assert.equal((await service.find(mailbox, 'alias@example.com', { requestAt, latest: true })).code, 'HFCP5');
});

test('Graph stops at an unreadable newest login instead of paging back to an old code', async () => {
  const options = { latest: true, requestAt, expectedEmail: 'alias@example.com', kind: 'code' };
  let calls = 0;
  const result = await fetchGraphFolder('token', MAIL_FOLDERS[0], options, async () => {
    calls += 1;
    assert.equal(calls, 1);
    return response([graphMessage('broken', { subject: 'Steam Guard', body: { contentType: 'text', content: 'Your Steam Guard code: [missing]' } })], 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=older');
  });
  assert.equal(result.hasMore, false);
  assert.throws(() => scanMessages(result.messages, 'alias@example.com', options), { code: 'MAIL_CODE_UNREADABLE' });
});

test('Graph latest code lookup passes 100 unrelated messages and stops after the first matching page', async () => {
  const urls = [];
  const options = { latest: true, requestAt, expectedEmail: 'alias@example.com', kind: 'code' };
  const result = await fetchGraphFolder('token', MAIL_FOLDERS[0], options, async url => {
    urls.push(url);
    assert.ok(urls.length <= 2, 'Older pages should not be requested after a match');
    return urls.length === 1
      ? response(Array.from({ length: 100 }, (_, index) => graphMessage(`noise-${index}`)), 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=next')
      : response([graphMessage('code', { receivedDateTime: '2026-10-19T02:37:39Z', body: { contentType: 'text', content: 'Steam Guard code: 42KW7' } })], 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=older');
  });
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]).searchParams.get('$filter'), `receivedDateTime le ${requestAt}`);
  assert.equal(result.hasMore, false);
  assert.equal(scanMessages(result.messages, 'alias@example.com', options).code, '42KW7');
});

test('Graph latest lookup exhausts pages when no code exists and rejects repeated pagination', async () => {
  let calls = 0;
  const options = { latest: true, requestAt, expectedEmail: 'alias@example.com', kind: 'code' };
  const result = await fetchGraphFolder('token', MAIL_FOLDERS[0], options, async () => {
    calls += 1;
    return response([graphMessage(String(calls))], calls === 1 ? 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=next' : undefined);
  });
  assert.equal(calls, 2);
  assert.equal(scanMessages(result.messages, 'alias@example.com', options), null);
  await assert.rejects(fetchGraphFolder('token', MAIL_FOLDERS[0], options, async () => response([], 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=loop')), /无法确认最新验证码/);
});

test('partial folder failure produces browsing warnings and prevents automatic latest lookup', async () => {
  const service = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => {
    if (folder.label === 'Junk') throw new Error('private upstream details');
    return { hasMore: false, messages: [message('old', '2026-10-20T09:55:00Z')] };
  }, imapFolder: async () => { throw new Error('private token'); } });
  const result = await service.list(mailbox, 'alias@example.com');
  assert.equal(result.messages.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /垃圾邮件箱/);
  assert.doesNotMatch(JSON.stringify(result), /private/);
  await assert.rejects(service.find(mailbox, 'alias@example.com', { requestAt }), { code: 'MAIL_INCOMPLETE' });
});

test('only failed Graph folder is retried through IMAP and participates in latest sorting', async () => {
  const fallbacks = [];
  const service = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => {
    if (folder.label === 'Junk') throw new Error('Graph folder unavailable');
    return { hasMore: false, messages: [message('old', '2026-10-20T09:55:00Z')] };
  }, imapFolder: async (_mailbox, _token, folder) => {
    fallbacks.push(folder.label);
    return { hasMore: false, messages: [message('new', '2026-10-20T09:59:00Z', 'Z9Z9Z', { mailbox: folder.label })] };
  } });
  assert.equal((await service.find(mailbox, 'alias@example.com', { requestAt })).code, 'Z9Z9Z');
  assert.deepEqual(fallbacks, ['Junk']);
});

test('Graph follows lookup pagination and retains complete text and HTML bodies', async () => {
  const urls = [];
  const fullText = 'x'.repeat(800) + '\nSteam Guard code: A1B2C';
  const result = await fetchGraphFolder('token', MAIL_FOLDERS[0], { since: '2026-10-20T09:50:00Z' }, async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Prefer, 'IdType="ImmutableId"');
    return urls.length === 1
      ? response([graphMessage('first', { body: { contentType: 'text', content: fullText } })], 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=next')
      : response([graphMessage('second', { body: { contentType: 'html', content: '<div>complete HTML</div>' } })]);
  });
  assert.equal(urls.length, 2);
  assert.match(decodeURIComponent(urls[0]), /receivedDateTime\+ge\+2026/);
  assert.equal(result.messages.find((item) => item.id === 'graph:first').text, fullText);
  assert.equal(result.messages.find((item) => item.id === 'graph:second').html, '<div>complete HTML</div>');
  assert.equal(result.hasMore, false);
});

test('Graph browsing returns explicit latest-100 boundary and rejects unsafe pagination', async () => {
  const result = await fetchGraphFolder('token', MAIL_FOLDERS[0], {}, async () => response(Array.from({ length: 100 }, (_, index) => graphMessage(String(index))), 'https://graph.microsoft.com/v1.0/me/messages?$skip=100'));
  assert.equal(result.messages.length, 100);
  assert.equal(result.hasMore, true);
  await assert.rejects(fetchGraphFolder('token', MAIL_FOLDERS[0], { since: '2026-10-20T09:50:00Z' }, async () => response([], 'https://evil.example/steal')), /分页地址无效/);
});

test('Graph rejects untrustworthy receipt timestamps and incomplete responses', async () => {
  await assert.rejects(fetchGraphFolder('token', MAIL_FOLDERS[0], {}, async () => response([graphMessage('id', { receivedDateTime: '' })])), /接收时间/);
  await assert.rejects(fetchGraphFolder('token', MAIL_FOLDERS[0], {}, async () => ({ ok: true, json: async () => ({}) })), /邮件列表无效/);
});

test('token rotation is persisted and upstream secrets are never returned in errors', async () => {
  const changes = [];
  const current = { ...mailbox };
  assert.equal(await requestMicrosoftToken(current, true, { fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: 'access', refresh_token: 'rotated', scope: 'Mail.Read' }) }), saveToken: (...args) => changes.push(args) }), 'access');
  assert.deepEqual(changes, [[mailbox.id, 'rotated']]);
  assert.equal(current.refresh_token, 'rotated');
  await assert.rejects(requestMicrosoftToken(current, true, { fetchImpl: async () => ({ ok: false, json: async () => ({ error_description: 'private token' }) }) }), (error) => error.code === 'MAIL_AUTH_FAILED' && !error.message.includes('private'));
});

test('IMAP fallback requests the Outlook resource after a rotated Graph token lacks Mail.Read', async () => {
  const current = { ...mailbox };
  const scopes = [];
  const fetchImpl = async (_url, options) => {
    const params = new URLSearchParams(options.body);
    scopes.push(params.get('scope'));
    if (scopes.length === 1) return { ok: true, json: async () => ({ access_token: 'graph-token', refresh_token: 'rotated', scope: 'Mail.ReadBasic' }) };
    assert.equal(params.get('refresh_token'), 'rotated');
    return { ok: true, json: async () => ({ access_token: 'outlook-token', scope: 'https://outlook.office.com/IMAP.AccessAsUser.All' }) };
  };
  const folders = [];
  const service = createMailService({ fetchImpl, graphFolder: async () => { assert.fail('Insufficient Graph token must not be used'); },
    imapFolder: async (_box, accessToken, folder) => {
      assert.equal(accessToken, 'outlook-token');
      folders.push(folder.label);
      return { messages: [message(folder.label, '2026-10-20T09:59:00Z')], hasMore: false };
    } });
  assert.equal((await service.find(current, 'alias@example.com', { requestAt })).code, 'A1B2C');
  assert.deepEqual(scopes, ['https://graph.microsoft.com/.default', 'https://outlook.office.com/IMAP.AccessAsUser.All']);
  assert.deepEqual(folders, ['Inbox', 'Junk']);
});

test('localized IMAP special-use junk folder and internal receipt timestamp are used', () => {
  assert.equal(resolveImapFolder({ Inbox: { attribs: [] }, Ordner: { children: { Unerwuenscht: { attribs: ['\\Junk'], delimiter: '/' } }, delimiter: '/' } }, 'Junk'), 'Ordner/Unerwuenscht');
  assert.equal(resolveImapFolder({ Inbox: { attribs: [] } }, 'Junk'), '');
  const item = normalizeImapMessage({ date: new Date('2035-01-01'), text: 'full body' }, { uid: 22, date: new Date('2026-10-20T09:59:00Z') }, { label: 'Junk', path: 'Junk Email' }, 78);
  assert.equal(item.receivedAt, '2026-10-20T09:59:00.000Z');
  assert.equal(item.id, 'imap:Junk%20Email:78:22');
  assert.throws(() => normalizeImapMessage({}, { uid: 22, date: 'invalid' }, { label: 'Junk', path: 'Junk' }, 78), /内部接收时间/);
});

test('an abrupt IMAP socket close fails immediately instead of leaving an incomplete request pending', async () => {
  let destroyed = false;
  class ClosedImap extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('ready')); }
    getBoxes() { queueMicrotask(() => this.emit('close', true)); }
    destroy() { destroyed = true; }
  }
  await assert.rejects(fetchImapFolder(mailbox, 'token', MAIL_FOLDERS[0], {}, { Imap: ClosedImap, simpleParser: async () => ({}) }), /连接提前关闭/);
  assert.equal(destroyed, true);
});

test('IMAP latest-100 selection uses INTERNALDATE, not UID or sender Date', async () => {
  const configs = [];
  const bodyIds = [];
  class FakeImap extends EventEmitter {
    constructor(config) { super(); configs.push(config); }
    connect() { queueMicrotask(() => this.emit('ready')); }
    getBoxes(callback) { callback(null, { Inbox: { attribs: ['\\Inbox'] } }); }
    openBox(_name, readOnly, callback) { assert.equal(readOnly, true); callback(null, { uidvalidity: 99 }); }
    search(_criteria, callback) { callback(null, Array.from({ length: 101 }, (_, index) => index + 1)); }
    fetch(ids, options) {
      const fetcher = new EventEmitter();
      const withBody = options.bodies === '';
      if (withBody) bodyIds.push(...ids);
      assert.equal(options.markSeen, false);
      queueMicrotask(() => {
        for (const uid of ids) {
          const item = new EventEmitter();
          fetcher.emit('message', item);
          // Lowest UID is most recently received; a UID-only slice would miss it.
          item.emit('attributes', { uid, date: new Date(Date.parse(requestAt) - uid * 1000) });
          if (withBody) item.emit('body', Readable.from('body'));
          item.emit('end');
        }
        fetcher.emit('end');
      });
      return fetcher;
    }
    end() { queueMicrotask(() => this.emit('end')); }
    destroy() {}
  }
  const result = await fetchImapFolder(mailbox, 'token', MAIL_FOLDERS[0], {}, { Imap: FakeImap, simpleParser: async () => ({ text: 'full body', date: new Date('2040-01-01') }) });
  assert.equal(result.messages.length, 100);
  assert.equal(result.hasMore, true);
  assert.equal(result.messages[0].id, 'imap:Inbox:99:1');
  assert.equal(bodyIds.includes(1), true);
  assert.equal(bodyIds.includes(101), false);
  assert.equal(configs[0].tls, true);
  assert.notEqual(configs[0].tlsOptions?.rejectUnauthorized, false);
});

test('IMAP latest lookup scans older body batches by receipt time and stops after a matching code', async () => {
  const bodyIds = [];
  class LatestImap extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('ready')); }
    getBoxes(callback) { callback(null, { Inbox: { attribs: ['\\Inbox'] } }); }
    openBox(_name, readOnly, callback) { assert.equal(readOnly, true); callback(null, { uidvalidity: 99 }); }
    search(criteria, callback) { assert.deepEqual(criteria, ['ALL']); callback(null, Array.from({ length: 250 }, (_, i) => 250 - i)); }
    fetch(ids, options) {
      const fetcher = new EventEmitter();
      const withBody = options.bodies === '';
      if (withBody) bodyIds.push(...ids);
      assert.equal(options.markSeen, false);
      queueMicrotask(() => {
        for (const uid of ids) {
          const item = new EventEmitter();
          fetcher.emit('message', item);
          item.emit('attributes', { uid, date: new Date(Date.parse(requestAt) - uid * 60_000) });
          if (withBody) item.emit('body', Readable.from(String(uid)));
          item.emit('end');
        }
        fetcher.emit('end');
      });
      return fetcher;
    }
    end() { queueMicrotask(() => this.emit('end')); }
    destroy() {}
  }
  const options = { latest: true, requestAt, expectedEmail: 'alias@example.com', kind: 'code' };
  const result = await fetchImapFolder(mailbox, 'token', MAIL_FOLDERS[0], options, {
    Imap: LatestImap, simpleParser: async stream => {
      let text = '';
      for await (const chunk of stream) text += chunk;
      return { text: text === '101' ? 'Steam Guard code: 42KW7' : 'Unrelated message', to: { value: [{ address: 'alias@example.com' }] } };
    }
  });
  assert.equal(bodyIds.length, 200);
  assert.equal(bodyIds.includes(101), true);
  assert.equal(bodyIds.includes(201), false);
  assert.equal(result.hasMore, false);
  assert.equal(scanMessages(result.messages, 'alias@example.com', options).code, '42KW7');
});

test('browser recipient filter is applied after explicit per-folder scope', async () => {
  const service = createMailService({ token: async () => 'token', graphFolder: async (_token, folder) => ({ hasMore: true, messages: [message(`${folder.label}-mine`, '2026-10-20T09:59:00Z'), message(`${folder.label}-other`, '2026-10-20T09:58:00Z', 'A1B2C', { to: ['other@example.com'] })] }) });
  const result = await service.list(mailbox, 'alias@example.com');
  assert.equal(result.messages.length, 2);
  assert.equal(result.hasMore, true);
  assert.match(result.scope, /100.*再按账号收件人筛选/);
});

test('read status survives database reopen and remains scoped to the mailbox', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mail-read-state-'));
  let database;
  try {
    database = new Database(path.join(dir, 'state.sqlite'));
    database.exec('CREATE TABLE mail_message_reads (mailbox_id TEXT, message_id TEXT, read_at TEXT, PRIMARY KEY (mailbox_id, message_id))');
    createReadStateStore(database).markRead('box-1', 'graph:1');
    database.close();
    database = new Database(path.join(dir, 'state.sqlite'));
    const store = createReadStateStore(database);
    assert.equal(store.annotate('box-1', [{ id: 'graph:1' }])[0].isRead, true);
    assert.equal(store.annotate('box-2', [{ id: 'graph:1' }])[0].isRead, false);
    store.markRead('box-1', 'graph:1');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mail_message_reads').get().n, 1);
  } finally {
    if (database?.open) database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('read status follows the same message across Graph, IMAP fallback and folder moves', async () => {
  const database = new Database(':memory:');
  try {
    database.exec('CREATE TABLE mail_message_reads (mailbox_id TEXT, message_id TEXT, read_at TEXT, PRIMARY KEY (mailbox_id, message_id))');
    const internetMessageId = '<same-message@example.com>';
    const graph = (await fetchGraphFolder('token', MAIL_FOLDERS[0], {}, async () => response([graphMessage('graph-id', { internetMessageId })]))).messages[0];
    const imap = normalizeImapMessage({ messageId: internetMessageId }, { uid: 12, date: new Date(requestAt) }, { label: 'Junk', path: 'Junk' }, 88);
    const different = normalizeImapMessage({ messageId: '<other-message@example.com>' }, { uid: 13, date: new Date(requestAt) }, { label: 'Junk', path: 'Junk' }, 88);
    assert.notEqual(graph.id, imap.id);
    assert.equal(graph.readId, imap.readId);
    assert.doesNotMatch(graph.readId, /example.com/);
    const store = createReadStateStore(database);
    store.markRead(mailbox.id, graph.id, graph.readId);
    assert.deepEqual(store.annotate(mailbox.id, [graph, imap, different]).map((item) => item.isRead), [true, true, false]);
    assert.equal(store.annotate('another-mailbox', [imap])[0].isRead, false);
    store.markRead(mailbox.id, graph.id, graph.readId);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mail_message_reads').get().n, 2);
  } finally { database.close(); }
});

test('migration and full backup restore preserve read state and accept older backups', async () => {
  const previousPath = process.env.DB_PATH;
  const dir = await mkdtemp(path.join(tmpdir(), 'mail-migration-'));
  process.env.DB_PATH = path.join(dir, 'app.sqlite');
  let database;
  try {
    const module = await import('../server/db.js');
    database = module.db;
    module.migrate();
    module.migrate();
    database.prepare('INSERT INTO mailboxes (id, email, client_id, refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(mailbox.id, mailbox.email, 'client', 'refresh', requestAt, requestAt);
    createReadStateStore(database).markRead(mailbox.id, 'graph:backup');
    const payload = Object.fromEntries(module.TABLES.map((table) => [table, module.allRows(table)]));
    module.replaceAllData(payload);
    assert.equal(createReadStateStore(database).annotate(mailbox.id, [{ id: 'graph:backup' }])[0].isRead, true);
    delete payload.mail_message_reads;
    module.replaceAllData(payload);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mail_message_reads').get().n, 0);
    createReadStateStore(database).markRead(mailbox.id, 'graph:cascade');
    database.prepare('DELETE FROM mailboxes WHERE id = ?').run(mailbox.id);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mail_message_reads').get().n, 0);
  } finally {
    if (database?.open) database.close();
    if (previousPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('message routes enforce authentication, admin mailbox access, listing grants and recipient scope', async () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-session-secret', resave: false, saveUninitialized: false }));
  app.post('/test-login', (req, res) => { req.session.role = req.body.role; res.json({ ok: true }); });
  const requireAuth = (req, res, next) => req.session.role ? next() : res.status(401).json({ error: 'auth' });
  const requireAdmin = (req, res, next) => req.session.role === 'admin' ? next() : res.status(403).json({ error: 'admin' });
  let currentRecipient = 'alias@example.com';
  const marks = [];
  const recipients = [];
  registerMailRoutes(app, {
    requireAuth, requireAdmin,
    db: { prepare: (sql) => ({ get: (id) => id === 'a' && sql.includes('accounts') ? { id, remark: currentRecipient } : id === mailbox.id && sql.includes('mailboxes') ? mailbox : null }) },
    mailboxForAccount: () => mailbox,
    expectedRecipientForAccount: (account) => account.remark,
    mailService: { list: async (_box, recipient) => { recipients.push(recipient); return { email: mailbox.email, messages: [message('graph:visible', '2026-10-20T09:59:00Z', 'A1B2C', { readId: 'message:stable', headers: ['private header'] })], warnings: [], hasMore: false }; } },
    readState: { annotate: (_box, messages) => messages.map((item) => ({ ...item, isRead: marks.some((entry) => entry[1] === item.id) })), markRead: (...args) => marks.push(args) }
  });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, cookie = '', body) => fetch(`${base}${url}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request('/api/accounts/a/messages')).status, 401);
    const userCookie = (await request('/test-login', '', { role: 'user' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await request(`/api/mailboxes/${mailbox.id}/messages`, userCookie)).status, 403);
    assert.equal((await request(`/api/mailboxes/${mailbox.id}/messages/read`, userCookie, { id: 'graph:visible' })).status, 403);
    assert.equal((await request('/api/accounts/a/messages/read', userCookie, { id: 'graph:visible' })).status, 403);
    const listed = await request('/api/accounts/a/messages', userCookie);
    assert.equal(listed.status, 200);
    const payload = await listed.json();
    assert.equal(payload.messages[0].readId, undefined);
    assert.equal(payload.messages[0].headers, undefined);
    assert.equal(recipients[0], 'alias@example.com');
    assert.equal((await request('/api/accounts/a/messages/read', userCookie, { id: 'unlisted' })).status, 403);
    assert.equal((await request('/api/accounts/a/messages/read', userCookie, { id: 'graph:visible', readId: 'message:injected' })).status, 200);
    assert.deepEqual(marks, [[mailbox.id, 'graph:visible', 'message:stable']]);
    assert.equal((await (await request('/api/accounts/a/messages', userCookie)).json()).messages[0].isRead, true);
    currentRecipient = 'different@example.com';
    assert.equal((await request('/api/accounts/a/messages/read', userCookie, { id: 'graph:visible' })).status, 403);
    const adminCookie = (await request('/test-login', '', { role: 'admin' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await request(`/api/mailboxes/${mailbox.id}/messages`, adminCookie)).status, 200);
    assert.equal(recipients.at(-1), '');
    assert.equal((await request('/api/accounts/missing/messages', adminCookie)).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('code route returns typed stale, missing and unreadable errors and keeps every query fresh', async () => {
  const app = express();
  app.use(express.json());
  let responseMode = 'stale';
  const optionsSeen = [];
  const audits = [];
  registerMailCodeRoute(app, {
    requireAuth: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: 'user' }; next(); },
    db: { prepare: () => ({ get: id => id === 'account' ? { id, name: 'Test', login: 'test' } : undefined }) },
    mailboxForAccount: () => mailbox, expectedRecipientForAccount: () => 'alias@example.com', now: () => requestAt,
    audit: (...args) => audits.push(args),
    mailService: { find: async (_mailbox, _recipient, options) => {
      optionsSeen.push(options);
      if (responseMode === 'missing') return null;
      if (responseMode === 'success') return { code: 'HFCP5', receivedAt: '2026-10-20T09:59:00Z', expiresAt: '2026-10-20T10:04:00Z' };
      throw Object.assign(new Error(responseMode), { status: responseMode === 'stale' ? 409 : 422, code: responseMode === 'stale' ? 'MAIL_CODE_STALE' : 'MAIL_CODE_UNREADABLE', receivedAt: '2026-10-20T08:49:37Z' });
    } }
  });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (id = 'account', authorized = true) => fetch(`${base}/api/accounts/${id}/mail-code`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'test' } : {}) }, body: JSON.stringify({ afterReceivedAt: '2026-10-20T09:58:00Z' }) });
  try {
    assert.equal((await request('account', false)).status, 401);
    assert.equal((await request('unknown')).status, 404);
    for (const [mode, status, code] of [['stale', 409, 'MAIL_CODE_STALE'], ['missing', 404, 'MAIL_CODE_MISSING'], ['unreadable', 422, 'MAIL_CODE_UNREADABLE'], ['success', 200, undefined]]) {
      responseMode = mode;
      const response = await request();
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      if (mode === 'success') assert.equal(body.code, 'HFCP5');
      else assert.equal(body.code, code);
    }
    assert.equal(optionsSeen.length, 4);
    assert.ok(optionsSeen.every(options => options.latest && options.requestAt === requestAt && options.afterReceivedAt === '2026-10-20T09:58:00Z'));
    assert.equal(audits.length, 4);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
