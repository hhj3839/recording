import { eq, selectRows, supabaseRequest, upsertRows } from "../../../db/supabase";
import { dataError } from "../../data-scope";
import { SchoolMember, schoolWorkspaceContext } from "../../school-workspace";

type Collaborator = {
  id: number; organization_id: string; class_id: number; user_id: string; email: string;
  collaboration_role: "homeroom" | "subject"; subjects: string[]; can_manage_students: boolean;
};

async function ownerContext() {
  const context = await schoolWorkspaceContext();
  if (context.classroom.owner_id !== context.user.id) {
    throw new Error("학급 소유 교사만 협업 권한을 관리할 수 있습니다.");
  }
  return context;
}

const present = (row: Collaborator) => ({
  id: Number(row.id), email: row.email, role: row.collaboration_role,
  subjects: Array.isArray(row.subjects) ? row.subjects : [], canManageStudents: Boolean(row.can_manage_students),
});

export async function GET() {
  try {
    const { user, classId, organization } = await ownerContext();
    const [collaborators, members, plans] = await Promise.all([
      selectRows<Collaborator>("classroom_collaborators", { organization_id: eq(organization.id), class_id: eq(classId), order: "created_at.asc" }),
      selectRows<SchoolMember>("school_members", { organization_id: eq(organization.id), status: eq("active"), order: "created_at.asc" }),
      selectRows<{ subject: string }>("assessment_plans", { owner_id: eq(user.id), class_id: eq(classId), order: "sort_order.asc" }),
    ]);
    const assigned = new Set(collaborators.map((item) => item.user_id));
    return Response.json({
      collaborators: collaborators.map(present),
      availableMembers: members.filter((member) => member.user_id && member.user_id !== user.id && !assigned.has(member.user_id))
        .map((member) => ({ id: member.id, email: member.email })),
      subjects: [...new Set(plans.map((item) => item.subject).filter(Boolean))],
    });
  } catch (error) {
    return dataError(error, "학급 협업 권한을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, classId, organization } = await ownerContext();
    const body = await request.json().catch(() => ({})) as {
      memberId?: unknown;
      role?: unknown;
      canManageStudents?: unknown;
      subjects?: unknown;
    };
    const memberId = Number(body.memberId);
    const role = body.role === "homeroom" ? "homeroom" : "subject";
    const canManageStudents = role === "homeroom" && body.canManageStudents === true;
    const plans = await selectRows<{ subject: string }>("assessment_plans", { owner_id: eq(user.id), class_id: eq(classId) });
    const allowedSubjects = new Set(plans.map((item) => item.subject));
    const requestedSubjects: unknown[] = Array.isArray(body.subjects) ? body.subjects : [];
    const subjects = role === "subject"
      ? [...new Set(requestedSubjects.filter((item): item is string => typeof item === "string" && allowedSubjects.has(item)))].slice(0, 20)
      : [];
    if (role === "subject" && !subjects.length) return Response.json({ error: "교과전담교사의 담당 과목을 한 개 이상 선택해 주세요." }, { status: 400 });
    const member = (await selectRows<SchoolMember>("school_members", {
      id: eq(memberId), organization_id: eq(organization.id), status: eq("active"), limit: 1,
    }))[0];
    if (!member?.user_id || member.user_id === user.id) return Response.json({ error: "협업 교사를 확인해 주세요." }, { status: 400 });
    const rows = await upsertRows<Collaborator>("classroom_collaborators", [{
      organization_id: organization.id, class_id: classId, user_id: member.user_id, email: member.email,
      collaboration_role: role, subjects, can_manage_students: canManageStudents, invited_by: user.id, updated_at: new Date().toISOString(),
    }], "class_id,user_id");
    return Response.json({ collaborator: present(rows[0]) });
  } catch (error) {
    return dataError(error, "학급 협업 권한을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { classId, organization } = await ownerContext();
    const body = await request.json().catch(() => ({})) as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "해제할 협업 권한을 확인해 주세요." }, { status: 400 });
    await supabaseRequest("classroom_collaborators", {
      method: "DELETE", query: { id: eq(id), organization_id: eq(organization.id), class_id: eq(classId) },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return dataError(error, "학급 협업 권한을 해제하지 못했습니다.");
  }
}
