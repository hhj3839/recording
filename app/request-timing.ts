import { AsyncLocalStorage } from "node:async_hooks";

type Phase = "auth" | "database";
type Route = "login" | "class-data" | "assessment-plan" | "generated-comments" | "student-behaviors";
const timing = new AsyncLocalStorage<Map<Phase, { duration: number; count: number }>>();

export async function timedPhase<T>(phase: Phase, action: () => Promise<T>): Promise<T> {
  const phases = timing.getStore();
  if (!phases) return action();
  const start = performance.now();
  try { return await action(); }
  finally {
    const previous = phases.get(phase) ?? { duration: 0, count: 0 };
    phases.set(phase, { duration: previous.duration + performance.now() - start, count: previous.count + 1 });
  }
}

// Only fixed labels, durations, counts and status are recorded. No credentials,
// query strings, user IDs, bodies or upstream error messages enter diagnostics.
export async function withRequestTiming(route: Route, action: () => Promise<Response>) {
  const phases = new Map<Phase, { duration: number; count: number }>();
  return timing.run(phases, async () => {
    const start = performance.now();
    let status = 500;
    try {
      const response = await action();
      status = response.status;
      response.headers.set("Server-Timing", [
        `total;dur=${(performance.now() - start).toFixed(1)}`,
        ...[...phases].map(([name, value]) => `${name};dur=${value.duration.toFixed(1)};desc="${value.count} calls"`),
      ].join(", "));
      return response;
    } finally {
      if (process.env.LOADING_DIAGNOSTICS === "1") console.info(JSON.stringify({
        event: "loading-timing", route, status, durationMs: Math.round(performance.now() - start),
        phases: Object.fromEntries([...phases].map(([name, value]) => [name, { durationMs: Math.round(value.duration), count: value.count }])),
      }));
    }
  });
}
