import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* The Monday draft task posts proposed changes here once the app replaces the pilot page.
   POST /api/drafts  Authorization: Bearer <DRAFTS_API_TOKEN>
   Body: { "drafts": [ {id, section, op, key, label, reason, refs, value, createdAt, createdBy}, ... ] }
   Same draft shape the pilot uses. Nothing is published until an editor approves it.
   GET /api/drafts returns the published content and pending drafts so the task can avoid duplicates. */

const SECTIONS = ["items", "deadlines", "activity", "sources", "week"];
const ID = /^[A-Za-z0-9_-]{1,160}$/;

function authorized(req: NextRequest) {
  const token = process.env.DRAFTS_API_TOKEN;
  return !!token && token.length >= 24 && req.headers.get("authorization") === `Bearer ${token}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { drafts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const list = Array.isArray(body.drafts) ? body.drafts : [];
  if (!list.length || list.length > 100) return NextResponse.json({ error: "Send 1 to 100 drafts" }, { status: 400 });

  const rows = [];
  for (const raw of list as Record<string, unknown>[]) {
    const id = String(raw.id || "");
    if (!ID.test(id)) return NextResponse.json({ error: `Bad id: ${id}` }, { status: 400 });
    if (!SECTIONS.includes(String(raw.section))) return NextResponse.json({ error: `Bad section on ${id}` }, { status: 400 });
    if (raw.op !== "upsert" && raw.op !== "remove") return NextResponse.json({ error: `Bad op on ${id}` }, { status: 400 });
    if (raw.op === "upsert" && (typeof raw.value !== "object" || raw.value === null)) return NextResponse.json({ error: `Missing value on ${id}` }, { status: 400 });
    rows.push({
      id,
      section: raw.section,
      op: raw.op,
      key: String(raw.key || ""),
      label: raw.label ? String(raw.label).slice(0, 200) : null,
      reason: raw.reason ? String(raw.reason).slice(0, 2000) : null,
      refs: Array.isArray(raw.refs) ? raw.refs.slice(0, 10) : [],
      value: raw.op === "remove" ? null : raw.value,
      created_by: raw.createdBy ? String(raw.createdBy).slice(0, 80) : "Monday draft task",
      status: "pending",
    });
  }
  const { error } = await createAdminClient().from("drafts").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ queued: rows.length });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const [standards, deadlines, actions, sources, pending, recent] = await Promise.all([
    admin.from("standards").select("*"),
    admin.from("deadlines").select("*"),
    admin.from("actions").select("*"),
    admin.from("sources").select("*"),
    admin.from("drafts").select("id, section, op, key, label").eq("status", "pending"),
    admin.from("drafts").select("id, section, key, label, status, decided_at").neq("status", "pending").order("decided_at", { ascending: false }).limit(100),
  ]);
  return NextResponse.json({
    standards: standards.data, deadlines: deadlines.data, actions: actions.data, sources: sources.data,
    pendingDrafts: pending.data, recentDecisions: recent.data,
  });
}
