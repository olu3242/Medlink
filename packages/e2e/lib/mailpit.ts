// Local Supabase CLI bundles Mailpit as the SMTP catch-all for every
// outgoing email (magic links included) -- this is not a new testing
// mechanism introduced for E2E, it is the existing local dev/CI
// infrastructure the whole stack already runs. This module only reads
// Mailpit's own REST API to recover the magic-link URL a real
// signInWithOtp() call actually sent, so Playwright can complete the
// real production sign-in flow rather than a synthetic bypass.

interface MailpitMessageSummary {
  readonly ID: string;
  readonly To: ReadonlyArray<{ readonly Address: string }>;
  readonly Created: string;
}

interface MailpitMessagesResponse {
  readonly messages: readonly MailpitMessageSummary[];
}

interface MailpitMessageDetail {
  readonly Text: string;
  readonly HTML: string;
}

const LINK_PATTERN = /https?:\/\/[^\s"'<>]+\/auth\/callback\?[^\s"'<>]+/;

async function latestMessageId(mailpitUrl: string, recipient: string): Promise<string | null> {
  const response = await fetch(
    `${mailpitUrl}/api/v1/messages?query=${encodeURIComponent(`to:${recipient}`)}&limit=1`,
  );
  if (!response.ok) return null;
  const body = (await response.json()) as MailpitMessagesResponse;
  return body.messages[0]?.ID ?? null;
}

async function extractMagicLink(mailpitUrl: string, messageId: string): Promise<string | null> {
  const response = await fetch(`${mailpitUrl}/api/v1/message/${messageId}`);
  if (!response.ok) return null;
  const body = (await response.json()) as MailpitMessageDetail;
  const match = LINK_PATTERN.exec(body.Text) ?? LINK_PATTERN.exec(body.HTML);
  return match?.[0] ?? null;
}

// Polls Mailpit for the magic-link email MedLink's own /auth/sign-in
// action just requested, and returns the callback URL from inside it.
// The poll accounts for the small, real delivery delay between the
// signInWithOtp() call returning and Mailpit indexing the message.
export async function awaitMagicLink(
  mailpitUrl: string,
  recipient: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messageId = await latestMessageId(mailpitUrl, recipient);
    if (messageId) {
      const link = await extractMagicLink(mailpitUrl, messageId);
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No magic-link email arrived for ${recipient} within ${timeoutMs}ms`);
}
