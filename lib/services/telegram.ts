/**
 * §10.5: a failed message must never fail a job. Every caller of this
 * function does the DB write first, then calls this — and never awaits it
 * in a way that could roll back or block on failure. Errors are caught
 * here and returned as a result, not thrown, so a caller can log them
 * without a try/catch ceremony at every call site.
 */
export async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, error: 'Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Telegram API ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown Telegram error' };
  }
}
