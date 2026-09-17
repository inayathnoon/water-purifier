/**
 * Telegram sends with parse_mode: 'HTML' — any interpolated free-text
 * value containing '<', '>', or a bare '&' rejects the *entire* message
 * with a silent 400 (recorded 'failed' in notifications_log, nothing
 * else watches that table). esc() is the one thing standing between a
 * real customer name/note like "Ravi & Sons <opp. temple>" and a
 * technician who never gets their job. Pure function, no DB/network
 * needed — this is the fast half of `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../lib/services/notifications';

test('esc() neutralizes HTML-breaking characters without touching literal tags', () => {
  const dangerous = 'Ravi & Sons <test>';
  const escaped = esc(dangerous);

  assert.equal(escaped, 'Ravi &amp; Sons &lt;test&gt;');
  assert.ok(!escaped.includes('<'), 'no bare < survives escaping');
  assert.ok(!escaped.includes('>'), 'no bare > survives escaping');

  // A full message body built the same way the notify* functions do —
  // literal <b> tags must survive untouched; only the interpolated
  // value is escaped.
  const body = `📋 <b>Job assigned</b> — ${esc('Rajesh')}\n${esc(dangerous)}`;
  const outsideTags = body.replace(/<b>|<\/b>/g, '');
  assert.ok(!outsideTags.includes('<'), 'no bare < outside the <b> tags');
  assert.ok(!outsideTags.includes('>'), 'no bare > outside the <b> tags');
});

test('esc() handles null/undefined the same way every notify* call site relies on', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
});
