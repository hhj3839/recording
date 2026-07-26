import { eq, selectRows, supabaseRequest, upsertRows } from "../../../db/supabase";
import { dataError } from "../../data-scope";
import { SchoolMember as Member, schoolWorkspaceContext } from "../../school-workspace";

export async function GET() {
  try {
    const { membership, organization } = await schoolWorkspaceContext();
    const members = await selectRows<Member>("school_members", { organization_id: eq(organization.id), order: "created_at.asc" });
    return Response.json({
      organization: { id: organization.id, name: organization.name },
      currentRole: membership.role,
      members: members.map((member) => ({ id: member.id, email: member.email, role: member.role, status: member.status, isMe: member.id === membership.id })),
    });
  } catch (error) {
    return dataError(error, "학교 구성원을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, membership, organization } = await schoolWorkspaceContext();
    if (membership.role !== "admin") return Response.json({ error: "학교 관리자만 구성원을 초대할 수 있습니다." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 320);
    const role = body.role === "admin" ? "admin" : "teacher";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "올바른 교사 이메일을 입력해 주세요." }, { status: 400 });
    const teacher = (await selectRows<{ user_id: string }>("teachers", { email: eq(email), limit: 1 }))[0];
    const rows = await upsertRows<Member>("school_members", [{
      organization_id: organization.id, user_id: teacher?.user_id ?? null, email, role,
      status: teacher?.user_id ? "active" : "invited", invited_by: user.id,
    }], "organization_id,email");
    return Response.json({ member: { id: rows[0].id, email: rows[0].email, role: rows[0].role, status: rows[0].status } });
  } catch (error) {
    return dataError(error, "학교 구성원을 초대하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { membership, organization } = await schoolWorkspaceContext();
    if (membership.role !== "admin") return Response.json({ error: "학교 관리자만 구성원을 삭제할 수 있습니다." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isInteger(id) || id === membership.id) return Response.json({ error: "삭제할 구성원을 확인해 주세요." }, { status: 400 });
    await supabaseRequest("school_members", { method: "DELETE", query: { id: eq(id), organization_id: eq(organization.id) }, prefer: "return=minimal" });
    return Response.json({ ok: true });
  } catch (error) {
    return dataError(error, "학교 구성원을 삭제하지 못했습니다.");
  }
}
