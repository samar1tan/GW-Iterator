import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {AccountAllowanceService,normalizeAccountObservation} from '../src/account-allowance.ts';
import {parseCodexAccountAllowance} from '../src/adapters/codex.ts';
import {Store} from '../src/store.ts';
import type {AccountAllowanceObservation,AllowanceTarget} from '../src/account-allowance-types.ts';

const NOW=Date.UTC(2026,0,2),RESET=NOW/1000+7*24*3600;
const TARGET:AllowanceTarget={projectId:'synthetic-project',pipelineId:'synthetic-flow',stageId:'inspect',roleId:'qa',model:'synthetic-model',effort:'max',kind:'stage'};
const identity=(email='synthetic-person@example.invalid')=>({account:{type:'chatgpt',email,accountId:'synthetic-account',planType:'synthetic'}});
const window=(usedPercent:number,windowDurationMins=300,resetsAt=RESET)=>({usedPercent,windowDurationMins,resetsAt});
const payload=(used=10)=>({rateLimitsByLimitId:{codex:{limitId:'codex',primary:window(used),secondary:null,rateLimitReachedType:null}}});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(value=>{resolve=value;});return{promise,resolve};}
async function fixture(t:TestContext){
  const directory=await mkdtemp(path.join(tmpdir(),'gwi-account-test-')),store=new Store(directory);
  const h={store,now:NOW,used:10,email:'synthetic-person@example.invalid',reset:RESET,calls:0,custom:undefined as undefined|(()=>Promise<AccountAllowanceObservation>)};
  const reader={readAccountAllowance:async()=>{h.calls++;return h.custom?h.custom():parseCodexAccountAllowance(identity(h.email),{rateLimitsByLimitId:{codex:{limitId:'codex',primary:window(h.used,300,h.reset)}}},h.now);}};
  const service=new AccountAllowanceService(store,reader,{now:()=>h.now});
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});return Object.assign(h,{service});
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function sample(h:Fixture,delta:number,target=TARGET){const execution=await h.service.begin(target);h.now+=10000;h.used+=delta;await h.service.finish(execution.id,{status:'completed',dispatched:true,usage:{input:11,output:4,total:15}});h.now+=1000;return execution;}

test('native window decoding prefers actual multi-bucket identities and keeps only sanitized fields',()=>{
  const observation=parseCodexAccountAllowance(identity(),{rateLimits:{limitId:'legacy',primary:window(99)},rateLimitsByLimitId:{codex:{limitId:'codex',limitName:'Codex',primary:window(25,15),secondary:null,credits:{balance:'synthetic-credit'}},codex_other:{limitId:'codex_other',primary:window(42,60)}},rateLimitResetCredits:{availableCount:4,credits:[{id:'synthetic-reset'}]}},NOW);
  assert.equal(observation.status,'available');assert.equal(observation.windows.length,2);
  assert.deepEqual(observation.windows.map(value=>[value.bucketId,value.remainingPercent,value.windowDurationMins]),[['codex',75,15],['codex_other',58,60]]);
  assert.match(observation.accountKey!,/^[a-f0-9]{64}$/);
  const serialized=JSON.stringify(observation);for(const value of ['synthetic-person','synthetic-account','credits','synthetic-reset','synthetic-credit'])assert.equal(serialized.includes(value),false);
  const later=parseCodexAccountAllowance(identity(),payload(),NOW+1000),first=parseCodexAccountAllowance(identity(),payload(),NOW);
  assert.equal(first.id,later.id);assert.notEqual(first.observedAt,later.observedAt);
  assert.notEqual(first.id,parseCodexAccountAllowance(identity('other@example.invalid'),payload(),NOW).id);
  assert.notEqual(first.id,parseCodexAccountAllowance(identity(),payload(11),NOW).id);
  assert.notEqual(first.id,parseCodexAccountAllowance(identity(),{rateLimitsByLimitId:{codex:{primary:window(10,300,RESET+300)}}},NOW).id);
});

test('missing, malformed and unsupported windows never look unused or fall back past a present multi view',()=>{
  for(const value of [null,{}, {rateLimitsByLimitId:null,rateLimits:{limitId:'legacy',primary:window(10)}},{rateLimitsByLimitId:[]},{rateLimitsByLimitId:{}},{rateLimits:{primary:window(10)}},{rateLimits:{limitId:'legacy',primary:{...window(5),usedPercent:'5'}}},{rateLimits:{limitId:'legacy',primary:{...window(5),windowDurationMins:0}}},{rateLimits:{limitId:'legacy',primary:{...window(5),resetsAt:NaN}}}]){
    const observation=parseCodexAccountAllowance(identity(),value,NOW);assert.equal(observation.status,'unavailable');assert.equal(observation.exhausted,false);
  }
  const absentIdentity=parseCodexAccountAllowance({account:null},payload(),NOW);assert.equal(absentIdentity.status,'unavailable');assert.equal(absentIdentity.reason,'ACCOUNT_IDENTITY_UNAVAILABLE');
  const malformed=normalizeAccountObservation({status:'available',source:'local-codex',windows:[],observedAt:'bad',expiresAt:'later'},NOW);assert.equal(malformed.status,'unavailable');
});

test('real exhausted windows and provider limit markers stop dispatch even when another bucket is malformed',async t=>{
  const h=await fixture(t);h.used=100;
  const assessment=await h.service.assess(TARGET);assert.equal(assessment.status,'exhausted');assert.equal(assessment.action,'wait');
  await assert.rejects(h.service.begin(TARGET),error=>(error as {code?:string}).code==='ACCOUNT_ALLOWANCE_EXHAUSTED');
  assert.equal(h.store.list('account-allowance-execution').length,0);
  const marker=parseCodexAccountAllowance(identity(),{rateLimitsByLimitId:{codex:{primary:window(5),rateLimitReachedType:'usage_limit'},broken:null}},NOW);
  assert.equal(marker.exhausted,true);assert.equal(marker.status,'unavailable');
  const over=parseCodexAccountAllowance(identity(),payload(101),NOW);assert.equal(over.windows[0].remainingPercent,0);assert.equal(over.exhausted,true);
});

test('stale or past-reset 100 percent evidence becomes unavailable rather than a current hard stop',async t=>{
  for(const state of ['stale','past-reset']as const)await t.test(state,async sub=>{
    const h=await fixture(sub);
    const original=parseCodexAccountAllowance(identity(),payload(100),h.now);
    h.custom=async()=>state==='stale'?parseCodexAccountAllowance(identity(),payload(100),h.now-90000):parseCodexAccountAllowance(identity(),{rateLimits:{limitId:'codex',primary:window(100,300,h.now/1000-1)}},h.now);
    const value=await h.service.assess(TARGET,{refresh:true});assert.equal(value.account.status,'unavailable');assert.equal(value.status,'unavailable');assert.equal(value.action,'owner-step');assert.equal(value.account.exhausted,false);
    assert.equal(value.account.reason,state==='stale'?'STALE_OBSERVATION':'ACCOUNT_WINDOW_EXPIRED');
    const allowed=await h.service.begin(TARGET);assert.equal(allowed.before.exhausted,false);assert.equal(allowed.before.accountKey,original.accountKey);assert.notEqual(allowed.before.id,original.id);
  });
});

test('a fresh explicit provider marker is still authoritative when windows are missing, malformed or past reset',async t=>{
  for(const state of ['missing','malformed','past-reset']as const)await t.test(state,async sub=>{
    const h=await fixture(sub),bucket={limitId:'codex',rateLimitReachedType:'usage_limit',...(state==='missing'?{}:{primary:state==='malformed'?'invalid':window(100,300,h.now/1000-1)})};
    h.custom=async()=>parseCodexAccountAllowance(identity(),{rateLimitsByLimitId:{codex:bucket}},h.now);
    const value=await h.service.assess(TARGET,{refresh:true});assert.equal(value.status,'exhausted');assert.equal(value.action,'wait');assert.equal(value.account.reason,'ACCOUNT_LIMIT_REACHED');
    await assert.rejects(h.service.begin(TARGET),error=>(error as {code?:string}).code==='ACCOUNT_ALLOWANCE_EXHAUSTED');assert.equal(h.store.list('account-allowance-execution').length,0);
  });
});

test('crossing a reset invalidates cache and semantic snapshot identity without changing account identity',async t=>{
  const h=await fixture(t);h.used=100;h.reset=h.now/1000+5;
  const before=await h.service.assess(TARGET);assert.equal(before.status,'exhausted');const key=parseCodexAccountAllowance(identity(),{rateLimits:{limitId:'codex',primary:window(100,300,h.reset)}},h.now).accountKey;
  h.now+=6000;const expired=await h.service.assess(TARGET);assert.equal(h.calls,2);assert.equal(expired.status,'unavailable');assert.equal(expired.account.exhausted,false);assert.notEqual(expired.key,before.key);assert.notEqual(expired.account.id,before.account.id);
  const expiredAgain=await h.service.assess(TARGET,{refresh:true});assert.equal(expiredAgain.account.id,expired.account.id);
  const unknown=await h.service.begin(TARGET);assert.equal(unknown.before.accountKey,key);
  h.used=0;h.reset+=300;const reset=await h.service.assess(TARGET,{refresh:true});assert.equal(reset.status,'learning');assert.notEqual(reset.account.id,expired.account.id);
});

test('an explicit marker cached before a reset cannot prove the new cycle is exhausted',async t=>{
  const h=await fixture(t),old=parseCodexAccountAllowance(identity(),{rateLimits:{limitId:'codex',primary:window(100,300,h.now/1000+5),rateLimitReachedType:'usage_limit'}},h.now);
  h.custom=async()=>old;assert.equal((await h.service.assess(TARGET)).status,'exhausted');h.now+=6000;
  const expired=await h.service.assess(TARGET);assert.equal(h.calls,2);assert.equal(expired.status,'unavailable');assert.equal(expired.action,'owner-step');assert.equal(expired.account.exhausted,false);
  h.custom=async()=>parseCodexAccountAllowance(identity(),{rateLimits:{limitId:'codex',primary:window(100,300,h.now/1000-1),rateLimitReachedType:'usage_limit'}},h.now);
  assert.equal((await h.service.assess(TARGET,{refresh:true})).status,'exhausted');
});

test('ordinary reads cache for one minute, semantic keys are stable and fresh boundaries coalesce',async t=>{
  const h=await fixture(t),first=await h.service.assess(TARGET);assert.equal(h.calls,1);
  h.now+=59000;assert.equal((await h.service.assess(TARGET)).key,first.key);assert.equal(h.calls,1);
  h.now+=1001;const refreshed=await h.service.assess(TARGET);assert.equal(h.calls,2);assert.equal(refreshed.key,first.key);assert.equal(refreshed.account.id,first.account.id);
  const pending=deferred<AccountAllowanceObservation>();h.custom=()=>pending.promise;
  const checking=h.service.assess(TARGET,{refresh:true}),beginning=h.service.begin(TARGET);assert.equal(h.calls,3);
  pending.resolve(parseCodexAccountAllowance(identity(),payload(),h.now));const [checked,execution]=await Promise.all([checking,beginning]);
  assert.equal(checked.account.id,execution.before.id);assert.equal(h.calls,3);
  h.custom=undefined;assert.notEqual((await h.service.assess(TARGET)).key,first.key);
  h.now+=1000;const beforeFinish=h.calls;await Promise.all([h.service.finish(execution.id,{status:'completed',dispatched:true}),h.service.finish(execution.id,{status:'completed',dispatched:true})]);
  assert.equal(h.calls,beforeFinish+1);await h.service.finish(execution.id,{status:'failed',dispatched:false});assert.equal(h.calls,beforeFinish+1);
  assert.equal(h.store.list('account-allowance-execution').length,1);
});

test('unavailable reads remain explicit, private errors are dropped and assessments expose no account fingerprint',async t=>{
  const h=await fixture(t);h.custom=async()=>{throw new Error('synthetic-private@example.invalid synthetic-sensitive-error');};
  const unavailable=await h.service.assess(TARGET);assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.action,'owner-step');
  assert.equal(JSON.stringify(unavailable).includes('synthetic-sensitive-error'),false);assert.equal(JSON.stringify(unavailable).includes('accountKey'),false);
  h.custom=undefined;const fresh=await h.service.assess(TARGET,{refresh:true});assert.equal(fresh.status,'learning');assert.equal(JSON.stringify(fresh).includes('accountKey'),false);
  const unsupported=new AccountAllowanceService(h.store,{}, {now:()=>h.now});assert.equal((await unsupported.assess()).account.reason,'ACCOUNT_ALLOWANCE_UNSUPPORTED');
});

test('zero samples collect evidence and three comparable attempts produce ranges and recent direction',async t=>{
  const h=await fixture(t);let value=await h.service.assess(TARGET);assert.equal(value.status,'learning');assert.equal(value.trend.sampleCount,0);assert.deepEqual(value.trend.windows,[]);
  await sample(h,1);await sample(h,2);value=await h.service.assess(TARGET,{refresh:true});assert.equal(value.trend.comparableCount,2);assert.deepEqual(value.trend.windows,[]);assert.equal(value.trend.direction,'unknown');
  await sample(h,4);value=await h.service.assess(TARGET,{refresh:true});assert.equal(value.status,'ready');assert.equal(value.trend.sampleCount,3);assert.equal(value.trend.comparableCount,3);assert.equal(value.trend.direction,'rising');
  assert.deepEqual(value.trend.windows,[{bucketId:'codex',slot:'primary',windowDurationMins:300,lowPercent:1,highPercent:4}]);assert.deepEqual(value.trend.durationSeconds,{low:10,high:10});
  await sample(h,4);await sample(h,2);await sample(h,1);assert.equal((await h.service.assess(TARGET,{refresh:true})).trend.direction,'falling');
});

test('rounded zero delta remains an uncertain finite range rather than a free task',async t=>{
  const h=await fixture(t);for(let index=0;index<3;index++)await sample(h,0);
  const result=await h.service.assess(TARGET,{refresh:true});assert.equal(result.trend.comparableCount,3);assert.equal(result.trend.windows[0].lowPercent,0);assert.equal(result.trend.windows[0].highPercent,1);assert.ok(result.trend.reasons.includes('ZERO_DELTA_UNCERTAIN'));assert.equal(result.trend.attribution,'shared-account-observation');
});

test('history never pools another account, model, effort, project or unresolved inherited model',async t=>{
  const h=await fixture(t);for(let index=0;index<3;index++)await sample(h,1);
  for(const target of [{...TARGET,model:'another-model'},{...TARGET,effort:'high' as const},{...TARGET,projectId:'another-project'}])assert.equal((await h.service.assess(target,{refresh:true})).trend.sampleCount,0);
  h.email='another@example.invalid';assert.equal((await h.service.assess(TARGET,{refresh:true})).trend.sampleCount,0);
  h.email='synthetic-person@example.invalid';for(let index=0;index<3;index++)await sample(h,1,{...TARGET,model:null});
  const unresolved=await h.service.assess({...TARGET,model:null},{refresh:true});assert.equal(unresolved.trend.sampleCount,3);assert.equal(unresolved.trend.comparableCount,0);assert.ok(unresolved.trend.reasons.includes('MODEL_UNRESOLVED'));
});

test('reset, changed account and missing windows invalidate deltas while duration and diagnostics survive',async t=>{
  for(const failure of ['reset','account','missing']as const)await t.test(failure,async sub=>{
    const h=await fixture(sub),started=await h.service.begin(TARGET);h.now+=10000;
    if(failure==='reset')h.reset+=300;
    if(failure==='account')h.email='changed@example.invalid';
    if(failure==='missing')h.custom=async()=>parseCodexAccountAllowance(identity(),{rateLimitsByLimitId:{other:{limitId:'other',primary:window(12,60)}}},h.now);
    h.used+=2;await h.service.finish(started.id,{status:'failed',dispatched:true,usage:{input:11,output:4,total:15}});h.email='synthetic-person@example.invalid';h.custom=undefined;
    const value=await h.service.assess(TARGET,{refresh:true});assert.equal(value.trend.sampleCount,1);assert.equal(value.trend.comparableCount,0);assert.ok(value.trend.reasons.includes(failure==='reset'?'WINDOW_RESET':failure==='account'?'ACCOUNT_CHANGED':'WINDOW_MISSING'));
    const stored=h.store.list<{durationSeconds:number;usage:{total:number};before:unknown;after:unknown}>('account-allowance-execution')[0];assert.equal(stored.durationSeconds,10);assert.equal(stored.usage.total,15);assert.ok(stored.before&&stored.after);
  });
});

test('stale and backward-clock observations cannot manufacture a comparable delta',async t=>{
  const h=await fixture(t);h.custom=async()=>parseCodexAccountAllowance(identity(),payload(),h.now-90000);
  const started=await h.service.begin(TARGET);assert.equal(started.before.status,'unavailable');h.custom=undefined;h.now+=10000;await h.service.finish(started.id,{status:'completed',dispatched:true});
  let result=await h.service.assess(TARGET,{refresh:true});assert.equal(result.trend.comparableCount,0);assert.ok(result.trend.reasons.includes('STALE_OBSERVATION'));
  const backward=await h.service.begin(TARGET);h.now-=1000;await h.service.finish(backward.id,{status:'failed',dispatched:true});result=await h.service.assess(TARGET,{refresh:true});assert.ok(result.trend.reasons.includes('CLOCK_CHANGED'));
});

test('a recent but cached pre-completion after reading is not a fresh execution delta',async t=>{
  const h=await fixture(t),execution=await h.service.begin(TARGET),cached=execution.before;
  h.now+=10000;h.custom=async()=>cached;await h.service.finish(execution.id,{status:'completed',dispatched:true});h.custom=undefined;
  const value=await h.service.assess(TARGET,{refresh:true});assert.equal(value.trend.comparableCount,0);assert.ok(value.trend.reasons.includes('STALE_OBSERVATION'));
});

test('overlapping executions are retained but do not become task-specific account samples',async t=>{
  const h=await fixture(t),left=await h.service.begin(TARGET),right=await h.service.begin(TARGET);
  const active=await h.service.assess(TARGET);assert.equal(active.activeExecutions,2);assert.equal(active.status,'learning');assert.equal(active.action,'continue');
  h.now+=1000;h.used+=2;await h.service.finish(left.id,{status:'completed',dispatched:true});h.now+=1000;h.used+=2;await h.service.finish(right.id,{status:'completed',dispatched:true});
  const ended=await h.service.assess(TARGET,{refresh:true});assert.equal(ended.trend.sampleCount,2);assert.equal(ended.trend.comparableCount,0);assert.ok(ended.trend.reasons.includes('OVERLAPPING_EXECUTIONS'));assert.equal(ended.activeExecutions,0);
});

test('known active estimates share the account remainder without blocking all healthy parallel work',async t=>{
  const h=await fixture(t);for(let index=0;index<3;index++)await sample(h,2);h.used=92;
  assert.equal((await h.service.assess(TARGET,{refresh:true})).status,'ready');await h.service.begin(TARGET);
  assert.equal((await h.service.assess(TARGET)).status,'ready');await h.service.begin(TARGET);
  const second=await h.service.assess(TARGET);assert.equal(second.activeExecutions,2);assert.equal(second.status,'caution');assert.equal(second.action,'owner-step');
});

test('active counts follow the current account while unknown records and ledger invalidation remain conservative',async t=>{
  const h=await fixture(t),other=await h.service.begin(TARGET);
  h.email='other-synthetic-person@example.invalid';
  assert.equal((await h.service.assess(TARGET,{refresh:true})).activeExecutions,0);
  await h.service.begin(TARGET);
  h.custom=async()=>normalizeAccountObservation({...other.before,status:'unavailable',accountKey:undefined,reason:'ACCOUNT_IDENTITY_UNAVAILABLE'},h.now);
  await h.service.begin(TARGET);h.custom=undefined;
  const before=await h.service.assess(TARGET,{refresh:true});assert.equal(before.activeExecutions,2);
  await h.service.finish(other.id,{status:'not_dispatched',dispatched:false});
  const after=await h.service.assess(TARGET);assert.equal(after.activeExecutions,2);assert.notEqual(after.key,before.key);
});

test('confirmed preparation-only work is not an actual execution sample and bad diagnostics are rejected',async t=>{
  const h=await fixture(t),execution=await h.service.begin(TARGET);
  await assert.rejects(h.service.finish(execution.id,{status:'failed',dispatched:true,usage:{input:-1,output:0,total:0}}),/INVALID_ALLOWANCE_FINISH/);
  h.now+=1000;await h.service.finish(execution.id,{status:'not_dispatched',dispatched:false});
  const value=await h.service.assess(TARGET);assert.equal(value.trend.sampleCount,0);assert.equal(value.activeExecutions,0);
});

test('a freshly assessed admission records the checked observation once and cannot be replayed',async t=>{
  const h=await fixture(t),assessment=await h.service.assess(TARGET,{refresh:true}),reads=h.calls;
  const execution=await h.service.begin({...TARGET,runId:'synthetic-run',attemptId:'synthetic-attempt'},{assessment});
  assert.equal(h.calls,reads);assert.equal(execution.before.id,assessment.account.id);assert.equal(execution.before.observedAt,assessment.account.observedAt);assert.ok(execution.before.accountKey);
  assert.equal(execution.target.runId,'synthetic-run');assert.equal(execution.target.attemptId,'synthetic-attempt');
  await assert.rejects(h.service.begin(TARGET,{assessment}),error=>(error as {code?:string}).code==='ACCOUNT_ALLOWANCE_CHANGED');
  assert.equal(h.calls,reads);assert.equal(h.store.list('account-allowance-execution').length,1);
});

test('admission rejects unissued, altered, stale and superseded assessment evidence without recording work',async t=>{
  for(const failure of ['ordinary-read','clone','altered','target','expired','clock','account','ledger']as const)await t.test(failure,async sub=>{
    const h=await fixture(sub);let assessment=await h.service.assess(TARGET,{refresh:failure!=='ordinary-read'}),target=TARGET;
    if(failure==='clone')assessment=structuredClone(assessment);
    if(failure==='altered'){assessment.action='continue';assessment.account.windows[0].remainingPercent=100;}
    if(failure==='target')target={...TARGET,model:'synthetic-other-model'};
    if(failure==='expired')h.now+=60000;
    if(failure==='clock')h.now--;
    if(failure==='account'){h.email='synthetic-changed@example.invalid';await h.service.assess(TARGET,{refresh:true});}
    if(failure==='ledger')await h.service.begin(TARGET);
    const count=h.store.list('account-allowance-execution').length,reads=h.calls;
    await assert.rejects(h.service.begin(target,{assessment}),error=>(error as {code?:string}).code==='ACCOUNT_ALLOWANCE_CHANGED');
    assert.equal(h.calls,reads);assert.equal(h.store.list('account-allowance-execution').length,count);
  });
});

test('using issued admission evidence cannot bypass an exhausted observation or a window reset',async t=>{
  const h=await fixture(t);h.used=100;const exhausted=await h.service.assess(TARGET,{refresh:true});
  await assert.rejects(h.service.begin(TARGET,{assessment:exhausted}),error=>(error as {code?:string}).code==='ACCOUNT_ALLOWANCE_EXHAUSTED');
  h.used=20;h.reset=h.now/1000+1;const beforeReset=await h.service.assess(TARGET,{refresh:true});h.now+=1001;
  await assert.rejects(h.service.begin(TARGET,{assessment:beforeReset}),error=>(error as {code?:string}).code==='ACCOUNT_ALLOWANCE_CHANGED');
  assert.equal(h.store.list('account-allowance-execution').length,0);
});
