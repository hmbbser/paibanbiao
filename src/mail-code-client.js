// A click performs one mailbox lookup. Missing mail is reported immediately.
export function createMailCodeLookup({ request, now = Date.now, timeoutMs = 30_000 }) {
  const active = new Map();
  async function run(accountId, signal) {
    let aborted;
    const cancellation = new Promise((_resolve, reject) => {
      aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
    try {
      const result = await Promise.race([
        request(`/api/accounts/${accountId}/mail-code`, { method: 'POST', cache: 'no-store', signal, body: '{}' }),
        cancellation
      ]);
      if (signal.aborted) throw signal.reason;
      if (!Number.isFinite(Date.parse(result.receivedAt)) || !Number.isFinite(Date.parse(result.expiresAt))) {
        throw new Error('服务器未返回验证码有效时间，请更新服务器后重新获取');
      }
      if (Date.parse(result.expiresAt) <= now()) {
        throw Object.assign(new Error('最新验证码邮件已过旧，请在 Steam 重新发送后再点击获取'), { code: 'MAIL_CODE_STALE', receivedAt: result.receivedAt });
      }
      return result;
    } finally {
      signal.removeEventListener('abort', aborted);
    }
  }
  return {
    lookup(accountId) {
      if (active.has(accountId)) return active.get(accountId).promise;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('本次邮箱查询超时，请点击重试')), timeoutMs);
      const promise = run(accountId, controller.signal).finally(() => { clearTimeout(timer); active.delete(accountId); });
      active.set(accountId, { controller, promise });
      return promise;
    },
    cancel() { for (const { controller } of active.values()) controller.abort(); }
  };
}
