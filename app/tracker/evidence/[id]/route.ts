import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Opens one evidence item: a link goes to its address; an uploaded file downloads through a 60-second signed URL.
 *  Read as the signed-in person, so row level security and the storage rules decide whether they may. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login?next=/tracker/tasks", req.url));
  const db = createClient();
  const { data: e } = await db.from("evidence").select("kind, url, storage_path, file_name, removed_at").eq("id", params.id).maybeSingle();
  if (!e) return new NextResponse("Evidence not found.", { status: 404 });
  if (e.removed_at) return new NextResponse("This evidence was removed.", { status: 410 });
  if (e.kind !== "file") return NextResponse.redirect(e.url as string);
  const { data, error } = await db.storage.from("evidence").createSignedUrl(e.storage_path as string, 60, { download: (e.file_name as string) || true });
  if (error || !data) return new NextResponse("The file couldn't be opened.", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
