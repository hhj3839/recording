import { eq, selectRows, supabaseRequest, updateRows, upsertRows } from "../../../db/supabase";
import { confirmationIssue } from "../../record-confirmation";
import { dataError, getDataScope, requireOwnedStudentIds } from "../../data-scope";
import { validateRecord } from "../../record-validation";
import { archiveBehavior } from "../../record-revisions";

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const rows = await selectRows<Record<string, string | number>>("student_behaviors", {
      owner_id: eq(user.id), class_id: eq(classId), order: "student_id.asc",
    });
    return Response.json({ behaviors: rows.map((row) => ({
      id: row.id, studentId: row.student_id, characteristic: row.characteristic, generatedCharacteristic: row.generated_characteristic ?? "", behavior: row.behavior, confirmed: Boolean(row.confirmed), confirmedAt: row.confirmed_at, updatedAt: row.updated_at,
    })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return dataError(error, "저장된 행동특성을 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { studentId?: unknown; characteristic?: unknown; behavior?: unknown; confirmed?: unknown };
    const studentId = Number(body.studentId);
    const characteristic = typeof body.characteristic === "string" ? body.characteristic.trim().slice(0, 4000) : "";
    const behavior = typeof body.behavior === "string" ? body.behavior.trim().slice(0, 8000) : "";
    if (!Number.isInteger(studentId)) return Response.json({ error: "학생 정보를 확인해 주세요." }, { status: 400 });
    const confirmed = body.confirmed === true;
    const validation = validateRecord(behavior, true);
    const { user, classId } = await getDataScope();
    await requireOwnedStudentIds([studentId], user.id, classId);
    if (confirmed) {
      const peers = await selectRows<{ student_id: number; behavior: string }>("student_behaviors", {
        owner_id: eq(user.id), class_id: eq(classId),
      });
      const issue = confirmationIssue(behavior, studentId, peers.map((item) => ({ studentId: Number(item.student_id), content: item.behavior })), true);
      if (issue) return Response.json(issue, { status: issue.status });
    }
    await archiveBehavior({ ownerId: user.id, ownerEmail: user.email, classId, studentId, nextContent: behavior, nextCharacteristic: characteristic, source: confirmed ? "confirmation" : "manual-edit" });
    const updatedAt = new Date().toISOString();
    await upsertRows("student_behaviors", [{
      student_id: studentId, characteristic, behavior, confirmed, confirmed_at: confirmed ? updatedAt : null, updated_at: updatedAt, owner_email: user.email, owner_id: user.id, class_id: classId,
    }], "class_id,student_id");
    return Response.json({ ok: true, confirmed, validation, updatedAt });
  } catch (error) {
    return dataError(error, "행동특성 내용을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { scope?: unknown; confirmation?: unknown };
    const scope = body.scope === "all" ? "all" : "results";
    if (body.confirmation !== "행동특성초기화") {
      return Response.json({ error: "확인 문구가 올바르지 않습니다." }, { status: 400 });
    }
    const { user, classId } = await getDataScope();
    if (scope === "all") {
      await supabaseRequest("student_behaviors", {
        method: "DELETE", query: { owner_id: eq(user.id), class_id: eq(classId) },
      });
    } else {
      await updateRows("student_behaviors", { owner_id: eq(user.id), class_id: eq(classId) }, {
        behavior: "", generated_characteristic: null, confirmed: false, confirmed_at: null, updated_at: new Date().toISOString(),
      });
    }
    return Response.json({ ok: true, scope });
  } catch (error) {
    return dataError(error, "행동특성을 초기화하지 못했습니다.");
  }
}
