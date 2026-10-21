import { mailError } from './mail-service.js';

export function registerMailRoutes(app, { requireAuth, requireAdmin, db, mailService, readState, mailboxForAccount, expectedRecipientForAccount }) {
  function context(req, kind) {
    if (kind === 'accounts') {
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
      if (!account) throw mailError('账号不存在', 'NOT_FOUND', 404);
      const mailbox = mailboxForAccount(account);
      return { mailbox, recipient: expectedRecipientForAccount(account, mailbox) };
    }
    const mailbox = db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(req.params.id);
    if (!mailbox) throw mailError('邮箱不存在', 'NOT_FOUND', 404);
    return { mailbox, recipient: '' };
  }

  for (const kind of ['accounts', 'mailboxes']) {
    const middleware = kind === 'mailboxes' ? [requireAuth, requireAdmin] : [requireAuth];
    app.get(`/api/${kind}/:id/messages`, ...middleware, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const { mailbox, recipient } = context(req, kind);
        const result = await mailService.list(mailbox, recipient);
        const scope = `${kind}:${req.params.id}`;
        // Only messages returned to this signed-in session may be marked read.
        const grants = (req.session.mailMessageGrants || []).filter((grant) => grant.scope !== scope && grant.at > Date.now() - 86_400_000);
        req.session.mailMessageGrants = [...grants.slice(-7), { scope, mailboxId: mailbox.id, recipient,
          ids: result.messages.map((message) => message.id),
          readIds: result.messages.filter((message) => message.readId && message.readId !== message.id).map((message) => ({ id: message.id, readId: message.readId })),
          at: Date.now() }];
        const messages = readState.annotate(mailbox.id, result.messages).map((message) => ({
          id: message.id, mailbox: message.mailbox, sender: message.sender, to: message.to,
          subject: message.subject, text: message.text, html: message.html, receivedAt: message.receivedAt, isRead: message.isRead
        }));
        res.json({ ...result, messages });
      } catch (error) {
        res.status(error.status || 502).json({ error: error.status ? error.message : '读取邮件失败，请稍后重试' });
      }
    });

    app.post(`/api/${kind}/:id/messages/read`, ...middleware, (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const { mailbox, recipient } = context(req, kind);
        const id = req.body?.id;
        if (typeof id !== 'string' || !id || id.length > 2048) return res.status(400).json({ error: '邮件标识无效' });
        const grant = (req.session.mailMessageGrants || []).find((item) => item.scope === `${kind}:${req.params.id}`
          && item.mailboxId === mailbox.id && item.recipient === recipient && item.at > Date.now() - 86_400_000 && item.ids.includes(id));
        if (!grant) return res.status(403).json({ error: '请先刷新邮件列表，再打开这封邮件' });
        const readId = grant.readIds?.find((item) => item.id === id)?.readId;
        if (readId) readState.markRead(mailbox.id, id, readId);
        else readState.markRead(mailbox.id, id);
        res.json({ ok: true, id, isRead: true });
      } catch (error) {
        res.status(error.status || 500).json({ error: error.status ? error.message : '保存已读状态失败，请稍后重试' });
      }
    });
  }
}
