const waitingCodes = new Set(['MAIL_CODE_MISSING', 'MAIL_CODE_STALE', 'MAIL_CODE_NOT_NEW']);

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

// Each view tracks the last mail it fetched, even after its visible code expires.
export function createMailCodeLookup({ request, now = Date.now, sleep = wait, waitMs = 120_000, pollMs = 5_000 }) {
  const lastReceived = new Map();
  const active = new Map();
  function remember(accountId, receivedAt) {
    if (Number.isFinite(Date.parse(receivedAt)) && (!lastReceived.has(accountId) || Date.parse(receivedAt) > Date.parse(lastReceived.get(accountId)))) {
      lastReceived.set(accountId, receivedAt);
    }
  }
  async function run(accountId, signal) {
    const deadline = now() + waitMs;
    for (;;) {
      try {
        const afterReceivedAt = lastReceived.get(accountId);
        const result = await request(`/api/accounts/${accountId}/mail-code`, {
          method: 'POST', cache: 'no-store', signal,
          body: JSON.stringify(afterReceivedAt ? { afterReceivedAt } : {})
        });
        if (signal.aborted) throw signal.reason;
        if (!Number.isFinite(Date.parse(result.receivedAt)) || !Number.isFinite(Date.parse(result.expiresAt))) {
          throw new Error('服务器未返回验证码有效时间，请更新服务器后重新获取');
        }
        if (Date.parse(result.expiresAt) <= now()) {
          throw Object.assign(new Error('最新验证码邮件已过旧'), { code: 'MAIL_CODE_STALE', receivedAt: result.receivedAt });
        }
        remember(accountId, result.receivedAt);
        return result;
      } catch (error) {
        if (signal.aborted || !waitingCodes.has(error.code)) throw error;
        remember(accountId, error.receivedAt);
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error('等待 2 分钟仍未收到新验证码，请在 Steam 重新发送后再试');
        await sleep(Math.min(pollMs, remaining), signal);
      }
    }
  }
  return {
    lookup(accountId) {
      if (active.has(accountId)) return active.get(accountId).promise;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('等待 2 分钟仍未收到新验证码，请在 Steam 重新发送后再试')), waitMs);
      const promise = run(accountId, controller.signal).finally(() => { clearTimeout(timer); active.delete(accountId); });
      active.set(accountId, { controller, promise });
      return promise;
    },
    cancel() { for (const { controller } of active.values()) controller.abort(); }
  };
}
