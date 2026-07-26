import { eq, insertRows, selectRows, updateRows } from "../db/supabase";
import { getDataScope } from "./data-scope";

export type SchoolOrganization = { id: string; name: string; owner_id: string };
export type SchoolMember = { id: number; organization_id: string; user_id: string | null; email: string; role: "admin" | "teacher"; status: "invited" | "active"; created_at: string };

export async function schoolWorkspaceContext() {
  const { user, classroom, classId } = await getDataScope();
  let memberships = await selectRows<SchoolMember>("school_members", { user_id: eq(user.id), order: "created_at.desc" });
  if (!memberships.length) {
    const invitations = await selectRows<SchoolMember>("school_members", { email: eq(user.email.toLowerCase()), order: "created_at.desc" });
    if (invitations[0]) {
      await updateRows("school_members", { id: eq(invitations[0].id) }, { user_id: user.id, status: "active" });
      memberships = [{ ...invitations[0], user_id: user.id, status: "active" }];
    }
  }
  if (!memberships.length) {
    const organizations = await insertRows<SchoolOrganization>("school_organizations", [{ name: classroom.school_name, owner_id: user.id }]);
    memberships = await insertRows<SchoolMember>("school_members", [{
      organization_id: organizations[0].id, user_id: user.id, email: user.email.toLowerCase(),
      role: "admin", status: "active", invited_by: user.id,
    }]);
  }
  const membership = memberships[0];
  const organization = (await selectRows<SchoolOrganization>("school_organizations", { id: eq(membership.organization_id), limit: 1 }))[0];
  if (!organization) throw new Error("학교 작업공간을 찾을 수 없습니다.");
  return { user, classroom, classId, membership, organization };
}
