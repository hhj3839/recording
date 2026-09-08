import { selectRows } from "../db/supabase.ts";

// Explicit pagination also covers legacy pools with more than 20 rows.
export async function approvedPoolRows(versionIds: number[], read = selectRows) {
  const ids = [...new Set(versionIds)];
  const result: Array<{ pool_version_id: number; sentence: string }> = [];
  for (let start = 0; start < ids.length; start += 25) {
    for (let offset = 0; ; offset += 500) {
      const rows = await read<{ pool_version_id: number; sentence: string }>("comment_pool_sentences", {
        pool_version_id: `in.(${ids.slice(start, start + 25).join(",")})`, status: "eq.approved", order: "id.asc", limit: 500, offset,
      });
      result.push(...rows);
      if (rows.length < 500) break;
    }
  }
  return result;
}
