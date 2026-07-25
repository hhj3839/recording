import { eq, selectRows, supabaseRequest } from "../../../../db/supabase";
import { snapshotAssessmentPlan } from "../../../assessment-plan-versions";
import { dataError, getDataScope } from "../../../data-scope";

type VersionRow = {
  id: number;
  source: string;
  label: string;
  item_count: number;
  created_at: string;
};

const present = (row: VersionRow) => ({
  id: Number(row.id),
  source: row.source,
  label: row.label,
  itemCount: Number(row.item_count),
  createdAt: row.created_at,
});

export async function GET() {
  try {
    const { user, classId } = await getDataScope();
    const versions = await selectRows<VersionRow>("assessment_plan_versions", {
      owner_id: eq(user.id), class_id: eq(classId), order: "created_at.desc", limit: 30,
    });
    return Response.json({ versions: versions.map(present) });
  } catch (error) {
    return dataError(error, "평가계획 버전 기록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { versionId?: unknown };
    const versionId = Number(body.versionId);
    if (!Number.isInteger(versionId)) return Response.json({ error: "복원할 버전을 선택해 주세요." }, { status: 400 });
    const { user, classId } = await getDataScope();
    const version = (await selectRows<VersionRow>("assessment_plan_versions", {
      id: eq(versionId), owner_id: eq(user.id), class_id: eq(classId), limit: 1,
    }))[0];
    if (!version) return Response.json({ error: "복원할 수 없는 평가계획 버전입니다." }, { status: 403 });
    const levels = await selectRows<{ id: number }>("assessment_levels", {
      owner_id: eq(user.id), class_id: eq(classId), limit: 1,
    });
    if (levels.length) {
      return Response.json({ error: "이미 평가수준이 입력되어 있어 평가계획 버전을 복원할 수 없습니다." }, { status: 409 });
    }
    const restored = await supabaseRequest<number>("rpc/restore_assessment_plan_version", {
      method: "POST",
      body: { p_owner_id: user.id, p_class_id: classId, p_version_id: versionId },
    });
    await snapshotAssessmentPlan({
      ownerId: user.id, ownerEmail: user.email, classId, source: "restore",
      label: `‘${version.label}’ 버전 복원`,
    });
    return Response.json({ ok: true, restored: Number(restored), version: present(version) });
  } catch (error) {
    return dataError(error, "평가계획 버전을 복원하지 못했습니다.");
  }
}
