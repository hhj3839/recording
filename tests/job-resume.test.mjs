import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, deps, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", ...Object.keys(globals), code)(name => {
    assert.ok(name in deps, "Unexpected import: " + name);
    return deps[name];
  }, exports, ...Object.values(globals));
  return exports;
}
const policy = load("app/job-resume-policy.ts", {});
const old = () => new Date(Date.now() - 400_000).toISOString();
function harness(options = {}) {
  let job = { id: "existing", owner_id: "owner", class_id: 1, job_type: "behaviors", status: "queued", updated_at: old(),
    current_batch: 0, total_batches: 2, total_items: 2, completed_items: 0, failed_items: 0, error_message: "",
    batches: [[{ studentId: 1 }], [{ studentId: 2 }]], ...options.job };
  const work = [], dispatches = [], generations = [], saves = [], writes = [];
  let rejectDispatch = options.rejectDispatch ?? false;
  const match = q => Object.entries(q).every(([k,v]) => ["limit","order"].includes(k) || String(v) === "eq."+String(job[k]));
  const db = {
    eq: v => "eq."+v,
    selectRows: async (table,q) => table === "generation_jobs" && match(q) ? [structuredClone(job)] : [],
    updateRows: async (table,q,values) => {
      assert.equal(table, "generation_jobs");
      if(!match(q)) return [];
      writes.push(structuredClone(values)); job = {...job,...values}; return [structuredClone(job)];
    },
    insertRows: () => { throw new Error("Resume must never create a job"); },
  };
  const signature = { signCommentJob: id => "signed:"+id, verifyCommentJob: (id,sig) => sig==="signed:"+id };
  const worker = load("app/api/behavior-jobs/run/route.ts", {
    "@vercel/functions": { waitUntil: p => work.push(p) },
    "../../../ability-statement-policy": { ABILITY_STATEMENT_ISSUE: "issue" },
    "../../../../db/supabase": db,
    "../../../ai-usage": { getAiUsage: async()=>({monthly:0}), MONTHLY_AI_LIMIT:null, recordAiUsage:async()=>{} },
    "../../../behavior-generation": {
      generateBehaviorBatch: async batch => { generations.push(batch.map(x=>x.studentId)); return { behaviors:batch.map(x=>({studentId:x.studentId,behavior:"fixture"})),failures:[],usage:{} }; },
      saveGeneratedBehaviors: async x => saves.push(x.behaviors.map(b=>b.studentId)),
    },
    "../../../behavior-repair-policy": {}, "../../../comment-generation": signature,
    "../../../ai-model-policy": { generationModel: () => "fixture" },
  }, { fetch: async () => { throw new Error("simulated lost follow-up"); } });
  const route = load("app/api/generation-jobs/resume/route.ts", {
    "@vercel/functions": { waitUntil: p => work.push(p) }, "../../../../db/supabase": db,
    "../../../data-scope": {
      getDataScope: async()=>{ if(options.unauthorized) throw new Error("auth"); return {user:{id:"owner"},classId:1}; },
      dataError: ()=>Response.json({error:"denied"},{status:401}),
    },
    "../../../comment-generation": signature, "../../../job-resume-policy": policy,
  }, { fetch: async (url,init) => {
    dispatches.push({path:new URL(url).pathname,body:JSON.parse(init.body)});
    if(rejectDispatch) throw new Error("simulated delivery failure");
    if(options.httpFailure) return Response.json({}, {status:503});
    if(options.runWorker) return worker.POST(new Request(url,init));
    return Response.json({ok:true});
  } });
  return {route,worker,dispatches,generations,saves,writes,get job(){return job;},age:()=>{job.updated_at=old();},
    reject: value=>{rejectDispatch=value;}, drain: async()=>{while(work.length) await Promise.all(work.splice(0));}};
}
const resume = h => h.route.POST(new Request("https://example.test/api/generation-jobs/resume",{method:"POST",body:JSON.stringify({jobId:"existing"})}));
test("lost runner follow-up leaves queued progress; explicit resume continues only remaining batch", async()=>{
  const h=harness({runWorker:true});
  await h.worker.POST(new Request("https://example.test/run",{method:"POST",body:JSON.stringify({jobId:"existing",signature:"signed:existing"})}));
  await h.drain();
  assert.equal(h.job.status,"queued"); assert.equal(h.job.current_batch,1); assert.deepEqual(h.generations,[[1]]);
  // Polling time alone causes no further execution. No new job is inserted.
  h.age(); assert.equal((await resume(h)).status,202); await h.drain();
  assert.equal(h.job.id,"existing"); assert.equal(h.job.status,"completed"); assert.equal(h.job.current_batch,2);
  assert.deepEqual(h.generations,[[1],[2]]); assert.deepEqual(h.saves,[[1],[2]]);
});
test("concurrent resume requests dispatch once and preserve cursor/payload", async()=>{
  const h=harness(); const batch=structuredClone(h.job.batches);
  const responses=await Promise.all([resume(h),resume(h)]);
  await h.drain();
  assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]); assert.equal(h.dispatches.length,1);
  assert.equal(h.job.current_batch,0); assert.deepEqual(h.job.batches,batch);
  assert.deepEqual(Object.keys(h.writes[0]).sort(),["status","updated_at"]);
});
for(const kind of ["comments","behaviors","comment-pools"]) test(kind+" resumes exact owned existing job",async()=>{
 const h=harness({job:{job_type:kind}}); assert.equal((await resume(h)).status,202); await h.drain();
 assert.deepEqual(h.dispatches[0].body,{jobId:"existing",signature:"signed:existing"});
 assert.equal(h.dispatches[0].path,kind==="comments"?"/api/comment-jobs/run":kind==="behaviors"?"/api/behavior-jobs/run":"/api/comment-pools/run");
});
for(const status of ["completed","completed_with_errors","failed","cancelled"]) test(status+" cannot resume",async()=>{
 const h=harness({job:{status}}); assert.equal((await resume(h)).status,409); assert.equal(h.dispatches.length,0);
});
for(const job of [{owner_id:"foreign"},{class_id:2},{job_type:"other"}]) test("foreign scope or unknown type is rejected "+JSON.stringify(job),async()=>{
 const h=harness({job}); assert.equal((await resume(h)).status,404); assert.equal(h.writes.length,0);
});
test("unauthenticated resume cannot dispatch",async()=>{
 const h=harness({unauthorized:true}); assert.equal((await resume(h)).status,401); assert.equal(h.writes.length,0);
});
test("fresh running lease is protected; expired lease may be reclaimed",async()=>{
 const h=harness({job:{status:"running",updated_at:new Date().toISOString()}});
 assert.equal((await resume(h)).status,409); h.age(); assert.equal((await resume(h)).status,202);
});
for(const fail of [{rejectDispatch:true},{httpFailure:true}]) test("delivery failure leaves same queued job recoverable "+JSON.stringify(fail),async()=>{
 const h=harness(fail); assert.equal((await resume(h)).status,202); await h.drain();
 assert.equal(h.job.status,"queued"); assert.match(h.job.error_message,/전달에 실패/); assert.equal(h.job.current_batch,0);
 assert.equal((await resume(h)).status,409); // cooldown blocks immediate duplicate
 h.age(); assert.equal(policy.canResumeJob(h.job),true);
});
test("invalid timestamps and boundary ages fail closed",()=>{
 const now=Date.now();
 assert.equal(policy.canResumeJob({status:"queued",updated_at:"invalid"},now),false);
 for(const [status,age] of [["queued",30000],["running",360000]]){
  assert.equal(policy.canResumeJob({status,updated_at:new Date(now-age+1).toISOString()},now),false);
  assert.equal(policy.canResumeJob({status,updated_at:new Date(now-age).toISOString()},now),true);
 }
});

test("duplicate signed worker deliveries execute a batch only once", async()=>{
 const h=harness();
 const request=()=>new Request("https://example.test/run",{method:"POST",body:JSON.stringify({jobId:"existing",signature:"signed:existing"})});
 const responses=await Promise.all([h.worker.POST(request()),h.worker.POST(request())]);
 await h.drain();
 assert.equal(responses.length,2); assert.deepEqual(h.generations,[[1]]); assert.deepEqual(h.saves,[[1]]);
 assert.equal(h.job.current_batch,1);
});
