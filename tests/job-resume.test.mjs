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
  const results = new Map(options.initialResults ?? []);
  let rejectDispatch = options.rejectDispatch ?? false;
  const match = q => Object.entries(q).every(([k,v]) => ["limit","order","select"].includes(k) || String(v) === "eq."+String(job[k]));
  const db = {
    eq: v => "eq."+v,
    selectRows: async (table,q) => table === "student_behaviors" ? [...results].map(([student_id, behavior]) => ({student_id, behavior})) : table === "generation_jobs" && match(q) ? [structuredClone(job)] : [],
    updateRows: async (table,q,values) => {
      assert.equal(table, "generation_jobs");
      if(!match(q)) return [];
      writes.push(structuredClone(values)); job = {...job,...values};
      if (values.current_batch !== undefined) await options.boundary?.("cursor-saved");
      return [structuredClone(job)];
    },
    insertRows: () => { throw new Error("Resume must never create a job"); },
  };
  const signature = { signCommentJob: id => "signed:"+id, verifyCommentJob: (id,sig) => sig==="signed:"+id };
  const worker = options.worker?.(db, signature) ?? load("app/api/behavior-jobs/run/route.ts", {
    "@vercel/functions": { waitUntil: p => work.push(p) },
    "../../../ability-statement-policy": { ABILITY_STATEMENT_ISSUE: "issue" },
    "../../../../db/supabase": db,
    "../../../ai-usage": { getAiUsage: async()=>({monthly:0}), MONTHLY_AI_LIMIT:null, recordAiUsage:async()=>{} },
    "../../../behavior-generation": {
      generateBehaviorBatch: async batch => { generations.push(batch.map(x=>x.studentId)); return { behaviors:batch.map(x=>({studentId:x.studentId,behavior:"fixture-call-"+generations.length})),failures:[],usage:{} }; },
      saveGeneratedBehaviors: async x => {
        await options.boundary?.("before-save");
        assert.equal(x.jobId,job.id);
        assert.equal(x.batchIndex,job.current_batch);
        assert.equal(x.lease,job.updated_at);
        job.behavior_save_receipts ??= {};
        for (const b of x.behaviors) {
          results.set(b.studentId,b.behavior);
          job.behavior_save_receipts[x.batchIndex+":"+b.studentId]=true;
        }
        saves.push(x.behaviors.map(b=>b.studentId));
        await options.boundary?.("after-save");
      },
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
  return {route,worker,results,dispatches,generations,saves,writes,get job(){return job;},age:()=>{job.updated_at=old();},
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

for (const stop of ["before-save", "after-save", "cursor-saved"]) {
  test("interrupted behavior worker: " + stop, { timeout: 5000 }, async () => {
    // The interrupted invocation never returns to the runner's catch/retry loop.
    // Durable state survives; after expiry only the explicit resume route runs.
    const crash = oneCrash(stop);
    const h = harness({
      runWorker: true,
      initialResults: [[1, "previous-batch"], [2, "pre-existing-draft"]],
      job: { batches: [[{studentId:1}], [{studentId:2}], [{studentId:3}]],
        current_batch: 1, completed_items: 1, total_batches: 3, total_items: 3 },
      boundary: crash.boundary,
    });
    const attempt = h.worker.POST(new Request("https://example.test/run", {
      method: "POST", body: JSON.stringify({jobId:"existing",signature:"signed:existing"}),
    }));
    await Promise.race([crash.hit, attempt.then(() => { throw Error("Worker passed crash point"); })]);
    assert.deepEqual(h.generations, [[2]]);
    assert.equal(h.job.current_batch, stop === "cursor-saved" ? 2 : 1);
    assert.equal(h.results.get(2), stop === "before-save" ? "pre-existing-draft" : "fixture-call-1");
    assert.equal(h.results.get(1), "previous-batch");
    assert.equal((await resume(h)).status,409);
    for (let i=0; i<2 && h.job.status !== "completed"; i++) {
      h.age();
      assert.equal((await resume(h)).status,202);
      await h.drain();
    }
    const replay = stop === "before-save";
    assert.deepEqual(h.generations, replay ? [[2],[2],[3]] : [[2],[3]]);
    assert.equal(h.results.get(2), replay ? "fixture-call-2" : "fixture-call-1");
    assert.equal(h.results.get(1),"previous-batch");
    assert.equal(h.results.size,3);
    assert.equal(h.job.status,"completed");
    assert.equal(h.job.id,"existing");
    assert.equal(h.job.completed_items,3);
    assert.equal(h.job.failed_items,0);
    assert.equal(h.job.current_batch,3);
    assert.deepEqual(h.saves,[[2],[3]]);
  });
}

function oneCrash(stop) {
  const hit = Promise.withResolvers();
  let armed = true;
  return {
    hit: hit.promise,
    async boundary(point) {
      if (armed && stop === point) {
        armed = false;
        hit.resolve();
        await new Promise(() => {});
      }
    },
  };
}

async function interruptThenResume(h, crash, checkInterrupted) {
  const attempt = h.worker.POST(new Request("https://example.test/run", {
    method:"POST", body:JSON.stringify({jobId:"existing",signature:"signed:existing"}),
  }));
  await Promise.race([crash.hit, attempt.then(() => { throw Error("Missed crash point"); })]);
  checkInterrupted();
  assert.equal(h.job.status,"running");
  assert.equal(h.job.current_batch,1);
  h.age();
  assert.equal((await resume(h)).status,202);
  await h.drain();
  assert.equal(h.job.id,"existing");
  assert.equal(h.job.status,"completed");
  assert.equal(h.job.current_batch,2);
  assert.equal(h.job.completed_items,2);
  assert.equal(h.job.failed_items,0);
}

for (const stop of ["before-save","after-save"]) {
  test("pool candidate generation interrupted " + stop, {timeout:5000}, async () => {
    const crash = oneCrash(stop);
    const sentences = new Set(["already-approved"]);
    let aiCalls = 0;
    const batch = {spec:{canonicalSentence:"fixture"},poolVersionId:7,maxAttempts:1};
    const h = harness({
      runWorker:true, job:{job_type:"comment-pools",batches:[batch,batch],current_batch:1,completed_items:1},
      worker(db,signature) {
        const poolDb = {
          ...db,
          selectRows: async (table,q) => table === "comment_pool_sentences"
            ? [...sentences].map(sentence => ({sentence})) : db.selectRows(table,q),
          updateRows: async (table,q,v) => table === "comment_pool_versions" ? [] : db.updateRows(table,q,v),
          upsertRows: async (table,rows) => {
            assert.equal(table,"comment_pool_sentences");
            await crash.boundary("before-save");
            rows.forEach(row => sentences.add(row.sentence));
            await crash.boundary("after-save");
          },
        };
        return load("app/api/comment-pools/run/route.ts", {
          "../../../../db/supabase":poolDb, "../../../comment-generation":signature,
          "@vercel/functions":{}, "../../../ai-model-policy":{primaryAiModel:()=>"fixture"},
          "../../../ai-usage":{recordAiUsage:async()=>{}},
          "../../../comment-generation-policy":{hasNaturalNominalEnding:()=>true},
          "../../../comment-pool-library":{
            COMMENT_POOL_TARGET:2, normalizedPoolSentence:s=>s,
            approvePoolCandidates:approved=>({approved,rejectedIssues:[]}),
            commentPoolQuality:()=>({issues:[]}), commentPoolIsComplete:rows=>rows.length>=2,
          },
          "../../../comment-pool-prompt":{buildCommentPoolCandidatePrompt:()=>"fixture"},
          "../../../openai-response":{openAiOutputText:p=>p.output,parseFirstJsonObject:JSON.parse},
        }, {process:{env:{OPENAI_API_KEY:"fixture"}}, fetch:async url=>{
          assert.equal(url,"https://api.openai.com/v1/responses");
          aiCalls++;
          return Response.json({output:JSON.stringify({candidates:[{text:"candidate-"+aiCalls}]})});
        }});
      },
    });
    await interruptThenResume(h,crash,()=>{
      assert.equal(aiCalls,1);
      assert.equal(sentences.has("candidate-1"),stop==="after-save");
    });
    const expected = stop==="before-save" ? 2 : 1;
    assert.equal(aiCalls,expected);
    assert.deepEqual([...sentences],["already-approved","candidate-"+expected]);
  });

  test("comment assembly interrupted " + stop, {timeout:5000}, async () => {
    const crash = oneCrash(stop);
    const entry = {studentId:2,subject:"국어",items:[{assessmentIndex:0,text:"fixture",poolFingerprint:"fp"}]};
    let parts=[];
    const comments=new Map([[1,"previous"],[2,"old draft"]]);
    let assemblyWrites=0, partWrites=0, externalCalls=0;
    const h=harness({
      runWorker:true,job:{job_type:"comments",batches:[[],[entry]],current_batch:1,completed_items:1},
      worker(db,signature) {
        return load("app/api/comment-jobs/run/route.ts",{
          "@vercel/functions":{}, "../../../linked-comment-pools":{linkedCommentPools:async()=>new Map()},
          "../../../ability-statement-policy":{hasAbilityStatement:()=>false},
          "../../../comment-generation-policy":{hasNaturalNominalEnding:()=>true},
          "../../../comment-diversity":{selectMostDiverseComments:x=>x},
          "../../../comment-pool-library":{COMMENT_POOL_TARGET:8},
          "../../../comment-assembly":{assembleRotatedComment:items=>items.map(item=>item.text).join(" ")},
          "../../../../db/supabase":{...db,selectRows:async(table,q)=>{
            switch(table) {
              case "generation_jobs": return db.selectRows(table,q);
              case "generated_comment_parts": return parts;
              case "generated_comments": return [...comments].map(([student_id,comment])=>({student_id,comment}));
              case "comment_pool_versions": return [{id:7,fingerprint:"fp"}];
              case "comment_pool_sentences": return [{pool_version_id:7,sentence:"approved"}];
              default: throw Error(table);
            }
          }},
          "../../../comment-generation":{...signature,saveGeneratedCommentParts:async({parts:rows})=>{
            partWrites++;
            parts=rows.map(r=>({student_id:r.studentId,assessment_index:r.assessmentIndex,subject:r.subject,evidence:r.evidence,status:r.status,sentence:r.text}));
          },saveGeneratedComments:async({comments:rows})=>{
            await crash.boundary("before-save");
            assemblyWrites++;
            for(const r of rows) comments.set(r.studentId,r.comment);
            await crash.boundary("after-save");
          }},
        },{fetch:async()=>{externalCalls++;throw Error("external call");}});
      },
    });
    await interruptThenResume(h,crash,()=>assert.equal(comments.get(2),stop==="after-save"?"approved":"old draft"));
    assert.equal(partWrites,1);
    assert.equal(assemblyWrites,stop==="after-save"?2:1);
    assert.deepEqual([...comments],[[1,"previous"],[2,"approved"]]);
    assert.equal(externalCalls,0);
  });
}



test("resume generates only uncommitted students in this job and batch", async () => {
  const h = harness({
    runWorker: true, initialResults: [[1,"teacher-edited"],[2,"other-batch-result"]],
    job: {current_batch:1,completed_items:1,total_batches:2,total_items:3,
      batches:[[{studentId:2}],[{studentId:1},{studentId:2}]],
      behavior_save_receipts:{"1:1":true,"0:2":true}},
  });
  assert.equal((await resume(h)).status,202);
  await h.drain();
  assert.deepEqual(h.generations,[[2]]);
  assert.deepEqual(h.saves,[[2]]);
  assert.equal(h.results.get(1),"teacher-edited");
  assert.equal(h.job.status,"completed");
  assert.equal(h.job.completed_items,3);
});
