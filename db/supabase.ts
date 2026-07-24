type QueryValue = string | number | boolean;

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return { url, key };
}

export async function supabaseRequest<T>(
  table: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    query?: Record<string, QueryValue>;
    body?: unknown;
    prefer?: string;
  } = {},
): Promise<T> {
  const { url, key } = configuration();
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(options.query ?? {})) search.set(name, String(value));
  const response = await fetch(`${url}/rest/v1/${table}${search.size ? `?${search}` : ""}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "giroksam-server/1.0",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${table} ${response.status}: ${detail.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const eq = (value: QueryValue) => `eq.${value}`;

export function selectRows<T>(table: string, query: Record<string, QueryValue> = {}) {
  return supabaseRequest<T[]>(table, { query: { select: "*", ...query } });
}

export function upsertRows<T>(table: string, rows: unknown[], onConflict: string) {
  if (!rows.length) return Promise.resolve([] as T[]);
  return supabaseRequest<T[]>(table, {
    method: "POST",
    query: { on_conflict: onConflict },
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

export function insertRows<T>(table: string, rows: unknown[]) {
  if (!rows.length) return Promise.resolve([] as T[]);
  return supabaseRequest<T[]>(table, {
    method: "POST",
    body: rows,
    prefer: "return=representation",
  });
}

export function updateRows<T>(table: string, query: Record<string, QueryValue>, values: unknown) {
  return supabaseRequest<T[]>(table, {
    method: "PATCH",
    query: { select: "*", ...query },
    body: values,
    prefer: "return=representation",
  });
}
