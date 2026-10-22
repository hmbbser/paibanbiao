export type MailCodeResponse = {
  code: string; email: string; recipient?: string; mailbox?: string; subject?: string;
  sender?: string; receivedAt: string; expiresAt: string;
};
export function createMailCodeLookup(options: {
  request: <T>(url: string, options?: RequestInit) => Promise<T>;
}): { lookup(accountId: string): Promise<MailCodeResponse>; cancel(): void };
