#!/usr/bin/env node
/**
 * Full-feature demo seed: users, multi-org, KBs, docs, notes, verify,
 * bots, ACL, connectors, people graph, eval, MCP, chat+feedback, settings.
 *
 * Usage: node scripts/seed-demo.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.API_URL || "http://127.0.0.1:3001/api/v1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "scripts", "seed-data");
const CONNECTOR_INBOX = path.join(DATA, "connector-inbox");

const DEMO = {
  email: "demo@akb.local",
  password: "Demo1234!",
  name: "Demo User",
};

const EXTRA_USERS = [
  { email: "admin@akb.local", password: "Demo1234!", name: "Admin User", role: "admin" },
  { email: "member@akb.local", password: "Demo1234!", name: "Member User", role: "member" },
  { email: "viewer@akb.local", password: "Demo1234!", name: "Viewer User", role: "viewer" },
  { email: "hr@akb.local", password: "Demo1234!", name: "HR Partner", role: "member" },
  { email: "eng@akb.local", password: "Demo1234!", name: "Eng Lead", role: "member" },
];

const ORGS = [
  { name: "Acme Corp", slug: "acme-corp", primary: true },
  { name: "Beta Labs", slug: "beta-labs", primary: false },
];

const KBS = [
  {
    name: "HR Policies",
    description: "Employee handbook, leave, onboarding, remote work",
    files: [
      { file: "employee-handbook.md", title: "Employee Handbook", verify: true },
      { file: "onboarding-checklist.txt", title: "Onboarding Checklist", verify: true },
      { file: "faq-remote-work.md", title: "FAQ Remote Work", verify: true },
    ],
    note: {
      title: "HR quick tips @onboarding",
      content:
        "# HR quick tips\n\n- Confirm remote days with manager\n- See FAQ Remote Work for 3-day policy\n- Tag @onboarding for new hires\n",
    },
    bot: {
      name: "HR Assistant",
      description: "Answers policy questions from HR Policies",
      systemPrompt:
        "You are the Acme HR assistant. Answer ONLY from HR context. Cite sources with [n]. Prefer verified documents.",
    },
  },
  {
    name: "Product & Engineering",
    description: "Product overview, runbooks, security",
    files: [
      { file: "product-overview.md", title: "Product Overview", verify: true },
      { file: "engineering-runbook.md", title: "Engineering Runbook", verify: false },
      { file: "security-policy.md", title: "Security Policy", verify: true },
    ],
    note: {
      title: "Release checklist @eng",
      content:
        "# Release checklist\n\n1. Run eval\n2. Check runbook\n3. Notify #eng-releases\n",
    },
    bot: {
      name: "Eng Copilot",
      description: "Engineering and product Q&A",
      systemPrompt:
        "You are an engineering copilot for Acme. Use runbooks and product docs. Cite with [n].",
    },
  },
];

function mimeFor(filename) {
  if (filename.endsWith(".md") || filename.endsWith(".markdown"))
    return "text/markdown";
  if (filename.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function api(pathname, { method = "GET", token, body, orgId } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers["X-Organization-Id"] = orgId;

  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || data?.code || text || res.statusText;
    const err = new Error(`${method} ${pathname} → ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureUser(u) {
  try {
    await api("/auth/register", {
      method: "POST",
      body: { email: u.email, password: u.password, name: u.name },
    });
    console.log(`  + registered ${u.email}`);
  } catch (e) {
    try {
      await api("/auth/login", {
        method: "POST",
        body: { email: u.email, password: u.password },
      });
      console.log(`  · exists ${u.email}`);
    } catch {
      throw e;
    }
  }
}

async function login(email, password) {
  const data = await api("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return data.accessToken;
}

async function uploadDoc({ token, orgId, kbId, filePath, title }) {
  const buf = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const mimeType = mimeFor(filename);
  const byteSize = buf.byteLength;
  const checksum = crypto.createHash("sha256").update(buf).digest("hex");

  const presign = await api(
    `/organizations/${orgId}/knowledge-bases/${kbId}/documents/upload-url`,
    {
      method: "POST",
      token,
      orgId,
      body: { filename, mimeType, byteSize, title },
    },
  );

  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: buf,
  });
  if (!put.ok) throw new Error(`MinIO PUT failed ${put.status} for ${filename}`);

  return api(`/organizations/${orgId}/knowledge-bases/${kbId}/documents`, {
    method: "POST",
    token,
    orgId,
    body: {
      title,
      storageKey: presign.storageKey,
      mimeType,
      byteSize,
      checksum,
      documentId: presign.documentId,
      versionId: presign.versionId,
      originalFilename: filename,
    },
  });
}

async function waitDocsReady(token, orgId, kbId, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const docs = await api(
      `/organizations/${orgId}/knowledge-bases/${kbId}/documents`,
      { token, orgId },
    );
    const list = Array.isArray(docs) ? docs : [];
    const pending = list.filter((d) =>
      ["pending", "processing"].includes(d.status),
    );
    const failed = list.filter((d) => d.status === "failed");
    if (pending.length === 0 && list.length > 0) {
      console.log(
        `  ✓ ${list.length} docs (${list.filter((d) => d.status === "ready").length} ready, ${failed.length} failed)`,
      );
      return list;
    }
    process.stdout.write(`  … ingestion (${pending.length} pending)\r`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn("  ! timed out waiting for ingestion");
  return api(`/organizations/${orgId}/knowledge-bases/${kbId}/documents`, {
    token,
    orgId,
  });
}

async function chatOnce({ token, orgId, kbId, message, botId, timeoutMs = 45_000 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${API}/organizations/${orgId}/knowledge-bases/${kbId}/chat`,
      {
        method: "POST",
        signal: ac.signal,
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Organization-Id": orgId,
        },
        body: JSON.stringify({
          message,
          botId: botId || undefined,
          rewrite: false,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`chat ${res.status}: ${text.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let conversationId = null;
    let messageId = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const block of parts) {
        const lines = block.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const payload = JSON.parse(data);
          if (event === "conversation.created")
            conversationId = payload.conversationId;
          if (event === "message.completed" || event === "completed") {
            conversationId = payload.conversationId || conversationId;
            messageId =
              payload.messageId || payload.assistantMessageId || messageId;
          }
          if (event === "error") {
            throw new Error(payload.message || "chat stream error");
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
      if (messageId) break;
    }
    return { conversationId, messageId };
  } finally {
    clearTimeout(timer);
  }
}

function ensureConnectorInbox() {
  fs.mkdirSync(CONNECTOR_INBOX, { recursive: true });
  const sample = path.join(CONNECTOR_INBOX, "synced-announcement.md");
  if (!fs.existsSync(sample)) {
    fs.writeFileSync(
      sample,
      "# Office announcement\n\nFriday is a company half-day. See HR Policies for holiday rules.\n",
      "utf8",
    );
  }
}

async function main() {
  console.log(`Full seed against ${API}\n`);
  ensureConnectorInbox();

  console.log("1) Users");
  await ensureUser(DEMO);
  for (const u of EXTRA_USERS) await ensureUser(u);

  const token = await login(DEMO.email, DEMO.password);
  console.log(`\n2) Orgs (as ${DEMO.email})`);

  let orgs = await api("/organizations", { token });
  const orgBySlug = new Map((orgs || []).map((o) => [o.slug, o]));
  const createdOrgs = [];

  for (const def of ORGS) {
    let org = orgBySlug.get(def.slug);
    if (!org) {
      const created = await api("/organizations", {
        method: "POST",
        token,
        body: { name: def.name, slug: def.slug },
      });
      if (created?.status === "pending") {
        throw new Error(
          `Org create for ${def.slug} is pending approval. Mark ${DEMO.email} as platform admin (PLATFORM_ADMIN_EMAILS).`,
        );
      }
      org = created;
      console.log(`  + org ${org.name}`);
    } else {
      console.log(`  · org exists ${org.name}`);
    }
    createdOrgs.push({ ...org, primary: def.primary });
  }

  const primary = createdOrgs.find((o) => o.primary) || createdOrgs[0];
  const orgId = primary.id;

  // Secondary org: add demo as owner already; add viewer lightly
  const beta = createdOrgs.find((o) => o.slug === "beta-labs");
  if (beta) {
    try {
      await api(`/organizations/${beta.id}/members`, {
        method: "POST",
        token,
        orgId: beta.id,
        body: { email: "viewer@akb.local", role: "viewer" },
      });
      console.log("  + viewer@akb.local → Beta Labs");
    } catch (e) {
      console.log(`  · Beta Labs member: ${e.message}`);
    }
    try {
      await api(`/organizations/${beta.id}/knowledge-bases`, {
        method: "POST",
        token,
        orgId: beta.id,
        body: {
          name: "Beta Scratchpad",
          description: "Second-org sample KB",
        },
      });
      console.log("  + KB Beta Scratchpad");
    } catch (e) {
      console.log(`  · Beta KB: ${e.message}`);
    }
  }

  console.log("\n3) Org settings + members (Acme)");
  try {
    await api(`/organizations/${orgId}`, {
      method: "PATCH",
      token,
      orgId,
      body: {
        settings: {
          allow_member_create_kb: true,
          embedding_provider: "gemini",
          llm_provider: "gemini",
          acl_mode: "org_wide",
          dlp_enabled: true,
          retention_days: 365,
          ai_monthly_quota: 5000,
        },
      },
    });
    console.log("  + settings (providers, DLP, retention, quota)");
  } catch (e) {
    console.log(`  · settings: ${e.message}`);
  }

  for (const u of EXTRA_USERS) {
    try {
      await api(`/organizations/${orgId}/members`, {
        method: "POST",
        token,
        orgId,
        body: { email: u.email, role: u.role },
      });
      console.log(`  + ${u.email} as ${u.role}`);
    } catch (e) {
      console.log(`  · ${u.email}: ${e.message}`);
    }
  }

  try {
    const invite = await api(`/organizations/${orgId}/invite-links`, {
      method: "POST",
      token,
      orgId,
      body: { role: "viewer", expiresInDays: 14 },
    });
    console.log(
      `  + invite link token: ${(invite.token || invite.id || "").toString().slice(0, 12)}…`,
    );
  } catch (e) {
    console.log(`  · invite: ${e.message}`);
  }

  console.log("\n4) Knowledge bases, documents, notes, verify, ACL, bots");
  let kbs = await api(`/organizations/${orgId}/knowledge-bases`, {
    token,
    orgId,
  });
  const kbList = Array.isArray(kbs) ? kbs : [];
  const kbIds = {};
  const botIds = {};

  for (const kbDef of KBS) {
    let kb = kbList.find((k) => k.name === kbDef.name);
    if (!kb) {
      kb = await api(`/organizations/${orgId}/knowledge-bases`, {
        method: "POST",
        token,
        orgId,
        body: { name: kbDef.name, description: kbDef.description },
      });
      console.log(`  + KB ${kb.name}`);
    } else {
      console.log(`  · KB ${kb.name}`);
    }
    kbIds[kbDef.name] = kb.id;

    // ACL sample grant for viewer role on KB
    try {
      await api(`/organizations/${orgId}/knowledge-bases/${kb.id}/acls`, {
        method: "POST",
        token,
        orgId,
        body: {
          principalType: "role",
          principalId: "viewer",
          permission: "read",
        },
      });
      console.log(`    + ACL role:viewer read`);
    } catch (e) {
      console.log(`    · ACL: ${e.message}`);
    }

    const existingDocs = await api(
      `/organizations/${orgId}/knowledge-bases/${kb.id}/documents`,
      { token, orgId },
    );
    const docs = Array.isArray(existingDocs) ? existingDocs : [];

    for (const f of kbDef.files) {
      let doc = docs.find((d) => d.title === f.title);
      if (!doc) {
        doc = await uploadDoc({
          token,
          orgId,
          kbId: kb.id,
          filePath: path.join(DATA, f.file),
          title: f.title,
        });
        console.log(`    + doc ${f.title}`);
      } else {
        console.log(`    · doc ${f.title}`);
      }
    }

    if (kbDef.note) {
      const hasNote = docs.some((d) => d.title === kbDef.note.title);
      if (!hasNote) {
        try {
          await api(`/organizations/${orgId}/knowledge-bases/${kb.id}/notes`, {
            method: "POST",
            token,
            orgId,
            body: kbDef.note,
          });
          console.log(`    + note ${kbDef.note.title}`);
        } catch (e) {
          console.log(`    · note: ${e.message}`);
        }
      }
    }

    const readyDocs = await waitDocsReady(token, orgId, kb.id);

    for (const f of kbDef.files.filter((x) => x.verify)) {
      const doc = (readyDocs || []).find((d) => d.title === f.title);
      if (!doc) continue;
      try {
        await api(`/organizations/${orgId}/documents/${doc.id}/governance`, {
          method: "PATCH",
          token,
          orgId,
          body: {
            verify: true,
            expiresAt: new Date(
              Date.now() + 180 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
        });
        console.log(`    ✓ verified ${f.title}`);
      } catch (e) {
        console.log(`    · verify ${f.title}: ${e.message}`);
      }
    }

    if (kbDef.bot) {
      try {
        const bots = await api(`/organizations/${orgId}/bots`, {
          token,
          orgId,
        });
        const list = Array.isArray(bots) ? bots : [];
        let bot = list.find(
          (b) => b.name === kbDef.bot.name && b.knowledgeBaseId === kb.id,
        );
        if (!bot) {
          bot = await api(`/organizations/${orgId}/bots`, {
            method: "POST",
            token,
            orgId,
            body: {
              knowledgeBaseId: kb.id,
              name: kbDef.bot.name,
              description: kbDef.bot.description,
              systemPrompt: kbDef.bot.systemPrompt,
            },
          });
          console.log(`    + bot ${bot.name}`);
        } else {
          console.log(`    · bot ${bot.name}`);
        }
        botIds[kbDef.name] = bot.id;
      } catch (e) {
        console.log(`    · bot: ${e.message}`);
      }
    }
  }

  // Point default Slack KB
  try {
    await api(`/organizations/${orgId}`, {
      method: "PATCH",
      token,
      orgId,
      body: {
        settings: {
          slack_default_kb_id: kbIds["HR Policies"],
          default_kb_id: kbIds["HR Policies"],
        },
      },
    });
    console.log("  + slack_default_kb_id / default_kb_id");
  } catch {
    /* optional */
  }

  console.log("\n5) Connectors");
  try {
    const connectors = await api(`/organizations/${orgId}/connectors`, {
      token,
      orgId,
    });
    const list = Array.isArray(connectors) ? connectors : [];
    if (!list.some((c) => c.name === "Seed inbox")) {
      const c = await api(`/organizations/${orgId}/connectors`, {
        method: "POST",
        token,
        orgId,
        body: {
          name: "Seed inbox",
          type: "local_folder",
          knowledgeBaseId: kbIds["HR Policies"],
          config: { folderPath: CONNECTOR_INBOX },
        },
      });
      console.log(`  + connector ${c.name}`);
      try {
        await api(`/organizations/${orgId}/connectors/${c.id}/sync`, {
          method: "POST",
          token,
          orgId,
        });
        console.log("  → sync queued");
        await new Promise((r) => setTimeout(r, 4000));
        await waitDocsReady(token, orgId, kbIds["HR Policies"], 60_000);
      } catch (e) {
        console.log(`  · sync: ${e.message}`);
      }
    } else {
      console.log("  · connector Seed inbox exists");
    }

    // Notion/Confluence style export paths (same inbox for demo)
    for (const [name, type] of [
      ["Notion export demo", "notion"],
      ["Confluence export demo", "confluence"],
    ]) {
      if (list.some((c) => c.name === name)) continue;
      try {
        await api(`/organizations/${orgId}/connectors`, {
          method: "POST",
          token,
          orgId,
          body: {
            name,
            type,
            knowledgeBaseId: kbIds["Product & Engineering"],
            config: { exportPath: CONNECTOR_INBOX },
          },
        });
        console.log(`  + connector ${name}`);
      } catch (e) {
        console.log(`  · ${name}: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  · connectors: ${e.message}`);
  }

  console.log("\n6) People graph");
  try {
    const graph = await api(`/organizations/${orgId}/entities/rebuild`, {
      method: "POST",
      token,
      orgId,
    });
    console.log(
      `  + rebuilt people=${graph.people} links=${graph.links} docs=${graph.documents}`,
    );
  } catch (e) {
    console.log(`  · entities: ${e.message}`);
  }

  console.log("\n7) Search + chat + feedback");
  try {
    const search = await api(
      `/organizations/${orgId}/knowledge-bases/${kbIds["HR Policies"]}/search`,
      {
        method: "POST",
        token,
        orgId,
        body: {
          query: "How many remote days are allowed?",
          topK: 5,
          verifiedOnly: true,
        },
      },
    );
    console.log(`  + search hits: ${(search.results || []).length}`);
  } catch (e) {
    console.log(`  · search: ${e.message}`);
  }

  try {
    const chat = await chatOnce({
      token,
      orgId,
      kbId: kbIds["HR Policies"],
      botId: botIds["HR Policies"],
      message: "How many remote days are allowed each week?",
    });
    console.log(
      `  + chat conversation=${chat.conversationId || "?"} message=${chat.messageId || "?"}`,
    );
    if (chat.messageId) {
      await api(`/organizations/${orgId}/messages/${chat.messageId}/feedback`, {
        method: "POST",
        token,
        orgId,
        body: { rating: "positive", reason: "seed", comment: "Demo feedback" },
      });
      console.log("  + feedback positive");
    } else if (chat.conversationId) {
      const msgs = await api(
        `/organizations/${orgId}/conversations/${chat.conversationId}/messages`,
        { token, orgId },
      );
      const assistant = (Array.isArray(msgs) ? msgs : [])
        .reverse()
        .find((m) => m.role === "assistant");
      if (assistant) {
        await api(`/organizations/${orgId}/messages/${assistant.id}/feedback`, {
          method: "POST",
          token,
          orgId,
          body: {
            rating: "positive",
            reason: "seed",
            comment: "Demo feedback",
          },
        });
        console.log("  + feedback positive (via messages list)");
      }
    }
  } catch (e) {
    console.log(`  · chat: ${e.message}`);
  }

  console.log("\n8) Eval + MCP + audit");
  try {
    const run = await api(`/organizations/${orgId}/eval-runs`, {
      method: "POST",
      token,
      orgId,
      body: { knowledgeBaseId: kbIds["HR Policies"] },
    });
    console.log(
      `  + eval ${run.status} score=${run.score != null ? Math.round(run.score * 100) + "%" : "—"}`,
    );
  } catch (e) {
    console.log(`  · eval: ${e.message}`);
  }

  try {
    const mcp = await api(`/organizations/${orgId}/mcp/tokens`, {
      method: "POST",
      token,
      orgId,
      body: { name: "Demo MCP" },
    });
    console.log(
      `  + MCP token (save once): ${(mcp.token || "").slice(0, 18)}…`,
    );
    if (mcp.token) {
      const call = await fetch(`${API}/mcp/${orgId}/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MCP-Token": mcp.token,
        },
        body: JSON.stringify({
          name: "search",
          arguments: {
            knowledgeBaseId: kbIds["HR Policies"],
            query: "remote work",
            topK: 3,
          },
        }),
      });
      const body = await call.json();
      console.log(
        `  + MCP search results: ${(body.results || []).length} (http ${call.status})`,
      );
    }
  } catch (e) {
    console.log(`  · mcp: ${e.message}`);
  }

  try {
    const audits = await api(`/organizations/${orgId}/audit-logs?limit=5`, {
      token,
      orgId,
    });
    console.log(`  + audit events: ${(audits || []).length} recent`);
  } catch (e) {
    console.log(`  · audit: ${e.message}`);
  }

  console.log("\nDone. Login accounts (password Demo1234!):");
  console.log(`  owner  ${DEMO.email}`);
  for (const u of EXTRA_USERS) {
    console.log(`  ${u.role.padEnd(6)} ${u.email}`);
  }
  console.log(`\nOrgs: Acme Corp (full demo) · Beta Labs (second org)`);
  console.log(`Web: http://127.0.0.1:3000`);
}

main().catch((e) => {
  console.error("\nSeed failed:", e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
});
