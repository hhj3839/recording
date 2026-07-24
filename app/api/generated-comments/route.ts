import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { generatedComments } from "../../../db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.select().from(generatedComments).orderBy(asc(generatedComments.studentId), asc(generatedComments.subject));
    return Response.json({ comments: rows.map(({ studentId, subject, comment, updatedAt }) => ({ studentId, subject, comment, updatedAt })) });
  } catch (error) {
    console.error("Generated comments load failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "저장된 평어를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { studentId?: unknown; subject?: unknown; comment?: unknown };
    const studentId = Number(body.studentId);
    const subject = typeof body.subject === "string" ? body.subject : "";
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";
    if (!Number.isInteger(studentId) || !subject) return Response.json({ error: "평어 정보를 확인해 주세요." }, { status: 400 });
    const db = await getDb();
    const updatedAt = new Date().toISOString();
    await db.insert(generatedComments).values({ studentId, subject, comment, updatedAt }).onConflictDoUpdate({
      target: [generatedComments.studentId, generatedComments.subject],
      set: { comment, updatedAt },
    });
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    console.error("Generated comment save failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "수정한 평어를 저장하지 못했습니다." }, { status: 500 });
  }
}
