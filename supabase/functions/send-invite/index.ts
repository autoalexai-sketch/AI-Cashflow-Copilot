// SplitBooks — send a partner invite by email (Resend).
//
// The owner has already created the invite row from the app (RLS: only the
// org owner can insert/select it). This function only e-mails the link.
//
// Checks, in order:
//   1. who you are  — the caller's JWT (getUser validates it with Supabase);
//   2. what you own — the invite is read with the CALLER's token, so RLS
//      (is_org_owner) decides; a stranger's token simply finds nothing;
//   3. limits       — each invite is e-mailed once, max 5 e-mails per hour
//      per user, so an account cannot be turned into a spam cannon.
//
// verify_jwt is off at the platform level for the same reason as admin-api:
// the browser's CORS preflight (OPTIONS) carries no Authorization header.
// GET returns only whether the Resend key is configured (no secrets).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const APP_URL = 'https://splitbooks.pl/app';
const FROM = 'SplitBooks <invite@splitbooks.pl>';
const MAX_PER_HOUR = 5;

const ALLOWED_ORIGINS = new Set(['https://splitbooks.pl', 'https://www.splitbooks.pl']);
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function cors(origin: string | null) {
  const allow = origin && (ALLOWED_ORIGINS.has(origin) || LOCALHOST.test(origin)) ? origin : 'https://splitbooks.pl';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Lang = 'en' | 'pl' | 'uk';
const TEXT: Record<Lang, { subject: (who: string) => string; lead: (who: string, org: string) => string; body: string; cta: string; expires: string; ignore: string }> = {
  en: {
    subject: (who) => `${who} invites you to SplitBooks`,
    lead: (who, org) => `${who} invites you to the shared workspace <b>${org}</b> in SplitBooks.`,
    body: 'You will see the same income, expenses and partner split in real time.',
    cta: 'Accept invite',
    expires: 'The link works once and expires in 30 days.',
    ignore: 'If you did not expect this e-mail, just ignore it.',
  },
  pl: {
    subject: (who) => `${who} zaprasza Cię do SplitBooks`,
    lead: (who, org) => `${who} zaprasza Cię do wspólnego workspace <b>${org}</b> w SplitBooks.`,
    body: 'Zobaczysz te same przychody, koszty i podział między partnerami w czasie rzeczywistym.',
    cta: 'Przyjmij zaproszenie',
    expires: 'Link działa jednorazowo i wygasa po 30 dniach.',
    ignore: 'Jeśli nie spodziewałeś się tej wiadomości, po prostu ją zignoruj.',
  },
  uk: {
    subject: (who) => `${who} запрошує вас до SplitBooks`,
    lead: (who, org) => `${who} запрошує вас до спільного робочого простору <b>${org}</b> у SplitBooks.`,
    body: 'Ви бачитимете ті самі доходи, витрати та розподіл між партнерами в реальному часі.',
    cta: 'Прийняти запрошення',
    expires: 'Посилання одноразове і діє 30 днів.',
    ignore: 'Якщо ви не очікували цього листа, просто проігноруйте його.',
  },
};

function renderEmail(lang: Lang, who: string, org: string, link: string) {
  const t = TEXT[lang];
  const w = esc(who), o = esc(org), l = esc(link);
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#ffffff;border-radius:16px;padding:28px">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold">SplitBooks</p>
<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${t.lead(w, o)}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#475569">${t.body}</p>
<a href="${l}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:12px">${t.cta}</a>
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#64748b">${t.expires}<br><a href="${l}" style="color:#4f46e5;word-break:break-all">${l}</a></p>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center">${t.ignore}</p>
</div></body></html>`;
  const text = `${t.lead(who, org).replace(/<\/?b>/g, '')}\n${t.body}\n\n${t.cta}: ${link}\n\n${t.expires}\n${t.ignore}`;
  return { subject: t.subject(who), html, text };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method === 'GET') return json({ configured: Boolean(RESEND_API_KEY) }, 200, origin);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (!RESEND_API_KEY) return json({ error: 'email_not_configured' }, 503, origin);

  // 1. Who you are.
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await asUser.auth.getUser();
  if (authError || !user) return json({ error: 'unauthorized' }, 401, origin);

  let body: { token?: string; email?: string; lang?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400, origin); }
  const token = String(body.token ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const lang: Lang = body.lang === 'pl' || body.lang === 'uk' ? body.lang : 'en';
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'bad_token' }, 400, origin);
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ error: 'bad_email' }, 400, origin);

  // 2. What you own: RLS lets only the org owner see the invite.
  const { data: invite } = await asUser
    .from('invites')
    .select('id, org_id, expires_at, used_at, emailed_at')
    .eq('token', token)
    .maybeSingle();
  if (!invite) return json({ error: 'invite_not_found' }, 404, origin);
  if (invite.used_at) return json({ error: 'invite_used' }, 409, origin);
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return json({ error: 'invite_expired' }, 409, origin);
  if (invite.emailed_at) return json({ error: 'already_sent' }, 409, origin);

  // 3. Limits.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from('invites')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .gte('emailed_at', since);
  if ((count ?? 0) >= MAX_PER_HOUR) return json({ error: 'rate_limited' }, 429, origin);

  // Claim the invite before sending, so two clicks cannot send two e-mails.
  const { data: claimed } = await admin
    .from('invites')
    .update({ emailed_to: email, emailed_at: new Date().toISOString() })
    .eq('id', invite.id)
    .is('emailed_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) return json({ error: 'already_sent' }, 409, origin);

  const [{ data: org }, { data: me }] = await Promise.all([
    admin.from('organizations').select('name').eq('id', invite.org_id).maybeSingle(),
    admin.from('memberships').select('display_name').eq('org_id', invite.org_id).eq('user_id', user.id).maybeSingle(),
  ]);
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 80);
  const who = clean(me?.display_name || user.email || 'SplitBooks');
  const orgName = clean(org?.name || 'SplitBooks');
  const { subject, html, text } = renderEmail(lang, who, orgName, `${APP_URL}?invite=${token}`);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], reply_to: user.email, subject, html, text }),
  });

  if (!res.ok) {
    // Release the claim so the owner can retry; log the provider's answer, not the key.
    await admin.from('invites').update({ emailed_to: null, emailed_at: null }).eq('id', invite.id);
    console.error('resend_failed', res.status, await res.text());
    return json({ error: 'send_failed' }, 502, origin);
  }
  return json({ ok: true }, 200, origin);
});
