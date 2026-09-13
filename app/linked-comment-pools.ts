import { eq, selectRows } from '../db/supabase.ts';
import { buildCommentPoolSpecs, type PoolPlanItem, type CommentPoolSpec } from './comment-pool-library.ts';

type Version = { id: number; fingerprint: string; subject: string; unit: string; domain: string; level: string; criterion: string };
type Link = { assessment_plan_id: number; pool_version_id: number };

export function matchLinkedPools(specs: CommentPoolSpec[], links: Link[], versions: Version[]) {
  const byId = new Map(versions.map(v => [Number(v.id), v]));
  return new Map(specs.flatMap(spec => {
    const version = links.filter(link => Number(link.assessment_plan_id) === spec.assessmentPlanId)
      .map(link => byId.get(Number(link.pool_version_id)))
      .find(v => v && v.subject === spec.subject && v.unit === spec.unit && v.domain === spec.domain
        && v.level === spec.level && v.criterion === spec.criterion);
    return version ? [[spec.fingerprint, version] as const] : [];
  }));
}

export async function linkedCommentPools(ownerId: string, classId: number) {
  const plans = await selectRows<PoolPlanItem>('assessment_plans', { owner_id: eq(ownerId), class_id: eq(classId), order: 'sort_order.asc' });
  const links = await selectRows<Link>('assessment_plan_pool_links', { owner_id: eq(ownerId), class_id: eq(classId), order: 'id.desc' });
  const ids = [...new Set(links.map(link => Number(link.pool_version_id)))];
  const versions = ids.length ? await selectRows<Version>('comment_pool_versions', { id: `in.(${ids.join(',')})` }) : [];
  return matchLinkedPools(buildCommentPoolSpecs(plans), links, versions);
}
