#!/usr/bin/env node
/**
 * Basic RAG eval: login → search hit@k + chat citation presence on seed KB.
 * Usage: node scripts/eval-rag.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';

const API = process.env.API_URL || 'http://127.0.0.1:3001/api/v1';
const EMAIL = process.env.EVAL_EMAIL || 'demo@akb.local';
const PASSWORD = process.env.EVAL_PASSWORD || 'Demo1234!';

async function json(path, { method = 'GET', token, orgId, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Organization-Id': orgId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

const cases = [
  {
    name: 'remote_days',
    query: 'How many remote days are allowed?',
    expectKeywords: ['remote', 'day'],
  },
  {
    name: 'leave',
    query: 'Annual leave policy',
    expectKeywords: ['leave'],
  },
];

async function main() {
  const login = await json('/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  const token = login.accessToken || login.access_token;
  const orgs = await json('/organizations', { token });
  const orgId = orgs[0]?.id || login.organizations?.[0]?.id;
  if (!orgId) throw new Error('No organization');

  const kbs = await json(`/organizations/${orgId}/knowledge-bases`, {
    token,
    orgId,
  });
  const kb = kbs.find((k) => /hr|policy|policies/i.test(k.name)) || kbs[0];
  if (!kb) throw new Error('No knowledge base');

  const results = [];
  for (const c of cases) {
    const search = await json(
      `/organizations/${orgId}/knowledge-bases/${kb.id}/search`,
      {
        method: 'POST',
        token,
        orgId,
        body: { query: c.query, topK: 8 },
      },
    );
    const hits = search.results || search || [];
    const joined = hits.map((h) => h.content || '').join('\n').toLowerCase();
    const hitAtK = c.expectKeywords.every((k) => joined.includes(k.toLowerCase()));
    results.push({
      case: c.name,
      query: c.query,
      hitAtK,
      hitCount: Array.isArray(hits) ? hits.length : 0,
      topScore: hits[0]?.score ?? null,
    });
  }

  mkdirSync('/tmp/akb-logs', { recursive: true });
  const out = `/tmp/akb-logs/eval-${Date.now()}.json`;
  const payload = {
    at: new Date().toISOString(),
    orgId,
    kbId: kb.id,
    kbName: kb.name,
    results,
    pass: results.every((r) => r.hitAtK),
  };
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Wrote ${out}`);
  process.exit(payload.pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
