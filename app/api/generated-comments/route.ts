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
