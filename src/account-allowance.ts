import {createHash,randomUUID} from 'node:crypto';
import {EFFORTS} from './contracts.ts';
import type {Usage} from './contracts.ts';
import {AppError} from './validation.ts';
import type {Store} from './store.ts';
import type {AccountAllowanceObservation,AccountAllowanceSnapshot,AccountAllowanceWindow,AllowanceAssessment,AllowanceExecution,AllowanceFinish,AllowanceTarget,ExecutionTrend} from './account-allowance-types.ts';

export const ACCOUNT_ALLOWANCE_TTL_MS=60_000;
const KIND='account-allowance-execution',CONTROL='account-allowance-control';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value);
const epoch=(value:unknown):number=>typeof value==='string'?Date.parse(value):NaN;
const windowKey=(value:AccountAllowanceWindow)=>JSON.stringify([value.bucketId,value.slot,value.windowDurationMins]);
const targetKey=(value:AllowanceTarget)=>JSON.stringify([value.projectId,value.pipelineId,value.stageId,value.roleId,value.model,value.effort,value.kind]);
const iso=(value:number)=>new Date(value).toISOString();
const validUsage=(value:unknown):value is Usage=>object(value)&&['input','output','total'].every(key=>Number.isSafeInteger(value[key])&&Number(value[key])>=0)&&(value.cachedInput===undefined||(Number.isSafeInteger(value.cachedInput)&&Number(value.cachedInput)>=0&&Number(value.cachedInput)<=Number(value.input)));
type StoredExecution=AllowanceExecution&{after?:AccountAllowanceObservation;endedAt?:string;finishedAt?:string;startOrder?:number;endOrder?:number;durationSeconds?:number;status?:string;dispatched?:boolean;usage?:AllowanceFinish['usage']};
type Delta={key:string;low:number;high:number};

/** Validate the narrow owner-facing observation; never retain provider extras or error payloads. */
export function normalizeAccountObservation(value:unknown,now:number):AccountAllowanceObservation{
  const source=object(value)?value:{},windows:AccountAllowanceWindow[]=[];
  let invalid=false;
  if(Array.isArray(source.windows))for(const candidate of source.windows){
    if(!object(candidate)||!validId(candidate.bucketId)||!['primary','secondary'].includes(String(candidate.slot))||typeof candidate.usedPercent!=='number'||!Number.isFinite(candidate.usedPercent)||candidate.usedPercent<0||!Number.isSafeInteger(candidate.windowDurationMins)||Number(candidate.windowDurationMins)<=0||!Number.isSafeInteger(candidate.resetsAt)||Number(candidate.resetsAt)<=0||Number(candidate.resetsAt)>8_640_000_000_000){invalid=true;continue;}
    const name=typeof candidate.bucketName==='string'&&/^[\p{L}\p{N} ._:/()+-]{1,120}$/u.test(candidate.bucketName)&&!/(?:Bearer|sk-|gh[pousr]_)/i.test(candidate.bucketName)?candidate.bucketName:undefined;
    windows.push({bucketId:candidate.bucketId,...(name?{bucketName:name}:{}),slot:candidate.slot as AccountAllowanceWindow['slot'],usedPercent:candidate.usedPercent,remainingPercent:Math.max(0,Math.min(100,100-candidate.usedPercent)),windowDurationMins:Number(candidate.windowDurationMins),resetsAt:Number(candidate.resetsAt)});
  }else invalid=true;
  windows.sort((a,b)=>windowKey(a)<windowKey(b)?-1:windowKey(a)>windowKey(b)?1:0);
  if(new Set(windows.map(window=>JSON.stringify([window.bucketId,window.slot]))).size!==windows.length)invalid=true;
  const observed=epoch(source.observedAt),expires=epoch(source.expiresAt),timesValid=Number.isFinite(observed)&&Number.isFinite(expires)&&observed<=now&&expires>observed;
  const accountKey=typeof source.accountKey==='string'&&/^[a-f0-9]{64}$/.test(source.accountKey)?source.accountKey:undefined;
  const fresh=timesValid&&now-observed<ACCOUNT_ALLOWANCE_TTL_MS&&expires>now;
  const expiredWindow=windows.some(window=>window.resetsAt*1000<=now);
  const providerLimitReached=source.reason==='ACCOUNT_LIMIT_REACHED'&&!windows.some(window=>window.resetsAt*1000>observed&&window.resetsAt*1000<=now);
  // A past window is historical evidence; a fresh provider hard-limit marker is independent of it.
  const exhausted=fresh&&source.source==='local-codex'&&(providerLimitReached||windows.some(window=>window.remainingPercent===0&&window.resetsAt*1000>now)||(source.exhausted===true&&!expiredWindow));
  let reason=typeof source.reason==='string'&&/^[A-Z_]{1,80}$/.test(source.reason)?source.reason:undefined;
  if((source.status!=='available'&&source.status!=='unavailable')||source.source!=='local-codex')reason='ACCOUNT_ALLOWANCE_MALFORMED';
  else if(!timesValid)reason='ACCOUNT_ALLOWANCE_MALFORMED';
  else if(!fresh)reason='STALE_OBSERVATION';
  else if(providerLimitReached)reason='ACCOUNT_LIMIT_REACHED';
  else if(invalid)reason='ACCOUNT_ALLOWANCE_MALFORMED';
  else if(expiredWindow)reason='ACCOUNT_WINDOW_EXPIRED';
  else if(!windows.length)reason??='ACCOUNT_WINDOWS_MISSING';
  else if(!accountKey)reason??='ACCOUNT_IDENTITY_UNAVAILABLE';
  const status=source.status==='available'&&fresh&&!invalid&&!expiredWindow&&windows.length>0&&accountKey&&(!reason||reason==='ACCOUNT_LIMIT_REACHED')?'available':'unavailable';
  if(status==='unavailable')reason??='ACCOUNT_ALLOWANCE_UNAVAILABLE';
  const snapshot={status,source:'local-codex' as const,windows,exhausted,...(reason?{reason}:{}),...(accountKey?{accountKey}:{})};
  return{id:hash(snapshot),...snapshot,status:status as AccountAllowanceObservation['status'],observedAt:timesValid?String(source.observedAt):iso(now),expiresAt:timesValid?String(source.expiresAt):iso(now+ACCOUNT_ALLOWANCE_TTL_MS)};
}

export function unavailableAccountObservation(reason:string,now=Date.now()):AccountAllowanceObservation{
  return normalizeAccountObservation({status:'unavailable',source:'local-codex',windows:[],exhausted:false,reason,observedAt:iso(now),expiresAt:iso(now+ACCOUNT_ALLOWANCE_TTL_MS)},now);
}

function validateTarget(value:AllowanceTarget):AllowanceTarget{
  if(!object(value)||![value.projectId,value.pipelineId,value.stageId,value.roleId].every(validId)||(value.model!==null&&!validId(value.model))||!EFFORTS.includes(value.effort)||!['stage','planner'].includes(value.kind)||(value.runId!==undefined&&!validId(value.runId))||(value.attemptId!==undefined&&!validId(value.attemptId)))throw new Error('INVALID_ALLOWANCE_TARGET');
  return{projectId:value.projectId,pipelineId:value.pipelineId,stageId:value.stageId,roleId:value.roleId,model:value.model,effort:value.effort,kind:value.kind,...(value.runId?{runId:value.runId}:{}),...(value.attemptId?{attemptId:value.attemptId}:{})};
}

/** Account changes are shared observations, never a token-to-subscription exchange rate. */
export class AccountAllowanceService{
  private cache?:{value:AccountAllowanceObservation;at:number};
  private reading?:Promise<AccountAllowanceObservation>;
  private finishing=new Map<string,Promise<void>>();
  private readonly now:()=>number;
  private readonly store:Store;
  private readonly reader:{readAccountAllowance?:()=>Promise<AccountAllowanceObservation>};
  constructor(store:Store,reader:{readAccountAllowance?:()=>Promise<AccountAllowanceObservation>},options:{now?:()=>number}={}){this.store=store;this.reader=reader;this.now=options.now??Date.now;}
  private time(){const value=this.now();if(!Number.isFinite(value)||!Number.isFinite(new Date(value).getTime()))throw new Error('INVALID_ALLOWANCE_CLOCK');return value;}
  private async observe(refresh=false):Promise<AccountAllowanceObservation>{
    const now=this.time();
    if(this.reading)return this.reading;
    if(!refresh&&this.cache&&now>=this.cache.at&&now-this.cache.at<ACCOUNT_ALLOWANCE_TTL_MS&&(this.cache.value.status==='unavailable'||epoch(this.cache.value.expiresAt)>now)&&!this.cache.value.windows.some(window=>window.resetsAt*1000>this.cache!.at&&window.resetsAt*1000<=now))return structuredClone(this.cache.value);
    const work=(async()=>{let value:AccountAllowanceObservation;
      try{value=this.reader.readAccountAllowance?normalizeAccountObservation(await this.reader.readAccountAllowance(),this.time()):unavailableAccountObservation('ACCOUNT_ALLOWANCE_UNSUPPORTED',this.time());}
      catch{value=unavailableAccountObservation('ACCOUNT_ALLOWANCE_READ_FAILED',this.time());}
      this.cache={value,at:this.time()};return structuredClone(value);
    })();
    this.reading=work;try{return await work;}finally{if(this.reading===work)this.reading=undefined;}
  }
  private records(){return this.store.list<StoredExecution>(KIND);}
  private generation(){return this.store.get<{id:string;generation:number}>(CONTROL,'ledger')?.generation??0;}
  private advance(){this.store.put(CONTROL,{id:'ledger',generation:this.generation()+1});}
  private publicSnapshot(observation:AccountAllowanceObservation):AccountAllowanceSnapshot{const {accountKey,...snapshot}=observation;return structuredClone(snapshot);}
  private comparison(record:StoredExecution,all:StoredExecution[]):{deltas:Delta[];reasons:string[]}{
    const reasons:string[]=[],after=record.after,before=record.before,start=epoch(record.startedAt),end=epoch(record.endedAt);
    if(!after||before.status!=='available'||after.status!=='available')reasons.push('OBSERVATION_UNAVAILABLE');
    if(!before.accountKey||!after?.accountKey||before.accountKey!==after.accountKey)reasons.push('ACCOUNT_CHANGED');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)reasons.push('CLOCK_CHANGED');
    if(epoch(before.observedAt)>start||epoch(before.expiresAt)<=start||(after&&(epoch(after.observedAt)<end||epoch(after.expiresAt)<=epoch(record.finishedAt))))reasons.push('STALE_OBSERVATION');
    if(all.some(other=>other.id!==record.id&&other.dispatched!==false&&(!before.accountKey||!other.before.accountKey||other.before.accountKey===before.accountKey)&&(record.startOrder!==undefined&&record.endOrder!==undefined&&other.startOrder!==undefined?other.startOrder<record.endOrder&&(other.endOrder===undefined||other.endOrder>record.startOrder):epoch(other.startedAt)<end&&(!other.endedAt||epoch(other.endedAt)>start))))reasons.push('OVERLAPPING_EXECUTIONS');
    if(record.target.model===null)reasons.push('MODEL_UNRESOLVED');
    if(reasons.length||!after)return{deltas:[],reasons:[...new Set(reasons)]};
    const left=new Map(before.windows.map(window=>[windowKey(window),window])),right=new Map(after.windows.map(window=>[windowKey(window),window]));
    if(left.size!==right.size||[...left.keys()].some(key=>!right.has(key)))return{deltas:[],reasons:['WINDOW_MISSING']};
    const deltas:Delta[]=[];
    for(const [key,window]of left){const next=right.get(key)!;
      if(window.resetsAt!==next.resetsAt||next.usedPercent<window.usedPercent)return{deltas:[],reasons:['WINDOW_RESET']};
      const delta=next.usedPercent-window.usedPercent;
      if(delta===0)reasons.push('ZERO_DELTA_UNCERTAIN');
      deltas.push({key,low:delta,high:delta===0?1:delta});
    }
    return{deltas,reasons};
  }
  private trend(target:AllowanceTarget|undefined,observation:AccountAllowanceObservation,all:StoredExecution[]):ExecutionTrend{
    const reasons=new Set<string>(['SHARED_ACCOUNT_ACTIVITY']);
    if(!target||!observation.accountKey)return{sampleCount:0,comparableCount:0,direction:'unknown',windows:[],attribution:'shared-account-observation',reasons:[...reasons,!target?'NO_TARGET':'OBSERVATION_UNAVAILABLE']};
    const samples=all.filter(record=>record.finishedAt&&record.dispatched===true&&record.before.accountKey===observation.accountKey&&targetKey(record.target)===targetKey(target));
    const currentKeys=new Set(observation.windows.map(windowKey)),comparable:{record:StoredExecution;deltas:Delta[]}[]=[];
    for(const record of samples){const result=this.comparison(record,all);result.reasons.forEach(reason=>reasons.add(reason));if(result.deltas.length&&result.deltas.length===currentKeys.size&&result.deltas.every(delta=>currentKeys.has(delta.key)))comparable.push({record,deltas:result.deltas});else if(result.deltas.length)reasons.add('WINDOW_MISSING');}
    if(target.model===null)reasons.add('MODEL_UNRESOLVED');
    if(!samples.length)reasons.add('NO_SAMPLES');else if(comparable.length<3)reasons.add('INSUFFICIENT_SAMPLES');
    const durations=samples.flatMap(record=>record.durationSeconds===undefined?[]:[record.durationSeconds]);
    const windows=comparable.length>=3?observation.windows.map(window=>{const values=comparable.slice(-20).map(sample=>sample.deltas.find(delta=>delta.key===windowKey(window))!);return{bucketId:window.bucketId,slot:window.slot,windowDurationMins:window.windowDurationMins,lowPercent:Math.min(...values.map(value=>value.low)),highPercent:Math.max(...values.map(value=>value.high))};}):[];
    let direction:ExecutionTrend['direction']='unknown';
    if(comparable.length>=3&&observation.windows.length){
      const limiting=[...observation.windows].sort((a,b)=>a.remainingPercent-b.remainingPercent)[0],key=windowKey(limiting),recent=comparable.slice(-3).map(sample=>sample.deltas.find(delta=>delta.key===key)!.low);
      const diff=recent.at(-1)!-recent[0],tolerance=Math.max(0.25,(Math.max(...recent)-Math.min(...recent))*0.1);
      direction=diff>tolerance?'rising':diff< -tolerance?'falling':'steady';
    }
    return{sampleCount:samples.length,comparableCount:comparable.length,direction,...(durations.length?{durationSeconds:{low:Math.min(...durations),high:Math.max(...durations)}}:{}),windows,attribution:'shared-account-observation',reasons:[...reasons].sort()};
  }
  async assess(target?:AllowanceTarget,options:{refresh?:boolean}={}):Promise<AllowanceAssessment>{
    const selected=target?validateTarget(target):undefined,observation=await this.observe(options.refresh),all=this.records(),active=all.filter(record=>!record.finishedAt),trend=this.trend(selected,observation,all);
    let status:AllowanceAssessment['status']='ready',action:AllowanceAssessment['action']='continue';
    if(observation.exhausted){status='exhausted';action='wait';}
    else if(observation.status!=='available'){status='unavailable';action='owner-step';}
    else{
      const reservations=new Map<string,number>();let unknownActive=false;
      for(const execution of active){if(execution.before.accountKey&&execution.before.accountKey!==observation.accountKey)continue;const estimate=this.trend(execution.target,observation,all);if(estimate.comparableCount<3||!estimate.windows.length){unknownActive=true;continue;}for(const window of estimate.windows){const key=JSON.stringify([window.bucketId,window.slot,window.windowDurationMins]);reservations.set(key,(reservations.get(key)??0)+window.highPercent);}}
      const risky=observation.windows.some(window=>{const expected=trend.windows.find(item=>windowKey(window)===JSON.stringify([item.bucketId,item.slot,item.windowDurationMins]))?.highPercent??0;return window.remainingPercent-(reservations.get(windowKey(window))??0)<=Math.max(expected,5);});
      if(risky){status='caution';action='owner-step';trend.reasons.push('LIMITED_REMAINING_ACCOUNT_WINDOW');}
      else if(trend.comparableCount<3||unknownActive){status='learning';if(unknownActive)trend.reasons.push('ACTIVE_ESTIMATE_UNAVAILABLE');}
    }
    const code='ACCOUNT_ALLOWANCE_'+status.toUpperCase(),account=this.publicSnapshot(observation);
    const value={status,code,account,trend,action,...(selected?{target:selected}:{}),activeExecutions:active.filter(record=>!record.before.accountKey||record.before.accountKey===observation.accountKey).length};
    return{...value,key:hash({accountId:account.id,target:selected??null,trend,status,action,generation:this.generation(),active:active.map(record=>record.id).sort()})};
  }
  async begin(target:AllowanceTarget):Promise<AllowanceExecution>{
    const selected=validateTarget(target),before=await this.observe(true);
    if(before.exhausted)throw new AppError('ACCOUNT_ALLOWANCE_EXHAUSTED','The connected Codex account allowance is exhausted.',409);
    const execution:AllowanceExecution={id:randomUUID(),target:selected,before,startedAt:iso(this.time())};
    this.store.transaction(()=>{this.store.put(KIND,{...execution,startOrder:this.generation()+1});this.advance();});return structuredClone(execution);
  }
  async finish(id:string,input:AllowanceFinish):Promise<void>{
    const known=this.store.get<StoredExecution>(KIND,id);if(!known)throw new Error('ALLOWANCE_EXECUTION_NOT_FOUND');if(known.finishedAt)return;
    const pending=this.finishing.get(id);if(pending)return pending;
    if(!object(input)||typeof input.status!=='string'||!input.status.trim()||input.status.length>160||typeof input.dispatched!=='boolean'||(input.usage!==undefined&&!validUsage(input.usage)))throw new Error('INVALID_ALLOWANCE_FINISH');
    const ended=this.time();
    const work=(async()=>{const after=await this.observe(true),current=this.store.get<StoredExecution>(KIND,id);if(!current||current.finishedAt)return;
      const elapsed=(ended-epoch(current.startedAt))/1000;
      const record:StoredExecution={...current,after,endedAt:iso(ended),finishedAt:iso(this.time()),status:input.status,dispatched:input.dispatched,...(elapsed>=0?{durationSeconds:elapsed}:{}),...(input.usage?{usage:{input:input.usage.input,output:input.usage.output,total:input.usage.total,...(input.usage.cachedInput!==undefined?{cachedInput:input.usage.cachedInput}:{})}}:{})};
      this.store.transaction(()=>{this.store.put(KIND,{...record,endOrder:this.generation()+1});this.advance();});
    })();
    this.finishing.set(id,work);try{await work;}finally{if(this.finishing.get(id)===work)this.finishing.delete(id);}
  }
}
