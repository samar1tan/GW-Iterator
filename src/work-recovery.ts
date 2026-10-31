import {randomUUID} from 'node:crypto';
import type {Engine} from './engine.ts';
import type {BrowserContinuation,Intake,Run,WorkRecoveryRecord,WorkResumeInput} from './contracts.ts';
import {isNativeCapacityFailure} from './execution-failures.ts';
import {AppError,demand} from './validation.ts';
import {executionFailureIdentity} from './execution-evidence.ts';

const ended=(run:Run)=>['completed','failed','interrupted','cancelled'].includes(run.status);
const pending=new Set(['checking','backoff','retrying','resuming']);
async function within<T>(promise:Promise<T>,milliseconds:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AppError('RECOVERY_CHECK_TIMEOUT','Recovery observation did not finish within its finite check window.',409)),milliseconds);timer.unref();})]);}
  finally{if(timer)clearTimeout(timer);}
}
export const currentWorkRecovery=(goal:Intake)=>goal.workRecoveryHistory?.at(-1);
export const workRecoveryPending=(goal:Intake)=>pending.has(currentWorkRecovery(goal)?.phase??'');
type Context={
  engine:Engine;get:(id:string)=>Intake;all:()=>Intake[];family:(goal:Intake)=>Run[];
  save:(goal:Intake,event:string)=>void;active:(id:string)=>boolean;
  pause:(goal:Intake)=>void;resume:(goal:Intake,record:WorkRecoveryRecord)=>Promise<void>;
  confirmed:(run:Run)=>boolean;
};

/** Model-free, finite recovery around the existing scheduler and admission checks. */
export class WorkRecovery {
  private busy=new Set<string>();private closed=false;
  private context:Context;
  constructor(context:Context){this.context=context;}
  private target(goal:Intake){
    for(const run of this.context.family(goal).filter(run=>!run.executionKind)){
      const stage=run.stages.find(stage=>['failed','interrupted'].includes(stage.status)||!!stage.allowanceHold);
      if(stage)return{run,stage};
    }
    const run=this.context.engine.run(goal.routerRunId);return{run,stage:run.stages[0]};
  }
  private transient(goal:Intake){
    const {run,stage}=this.target(goal),attempt=stage?.attempts.at(-1);
    if(!['failed','interrupted'].includes(run.status)||run.cancelRequested||!attempt||!['failed','interrupted'].includes(stage.status))return false;
    if(!run.executionKind&&run.snapshot.pipeline.stages.find(item=>item.id===stage.stageId)?.executor!=='codex')return false;
    return attempt.failureCode==='STAGE_TIMEOUT'||isNativeCapacityFailure(attempt.error??goal.lastFailure?.message);
  }
  begin(id:string,trigger:'manual'|'automatic',note?:string,options:{target?:WorkResumeInput['target'];browserContinuation?:BrowserContinuation;idempotencyKey?:string;inputHash?:string}={}):Intake{
    demand(note===undefined||typeof note==='string'&&note.trim().length>0&&note.length<=2000,'INVALID_RECOVERY_NOTE','Keep additional recovery instructions within 2,000 characters.');
    const goal=this.context.get(id);if(workRecoveryPending(goal)){demand(!options.idempotencyKey||currentWorkRecovery(goal)?.idempotencyKey===options.idempotencyKey,'RECOVERY_IN_PROGRESS','Another recovery is already being checked.',409);return goal;}
    demand(goal.status!=='completed','GOAL_COMPLETED','This task is already complete.',409);
    demand(goal.status!=='clarification','CLARIFICATION_REPLY_REQUIRED','Reply to the current question before continuing.',409);
    demand(!this.context.active(id)||goal.status==='dispatched','EXECUTION_ACTIVE','Wait for the current decision to finish.',409);
    demand(this.context.family(goal).every(ended),'GOAL_WORK_ACTIVE','Wait for active work to finish before retrying.',409);
    const selected=options.target&&this.context.family(goal).find(run=>run.id===options.target!.runId);
    demand(!options.target||selected,'PROJECT_SCOPE','Choose a failed execution belonging to this goal.',403);
    const {run,stage}=selected?{run:selected,stage:selected.stages.find(stage=>stage.stageId===options.target!.stageId)}:this.target(goal);
    demand(!options.target||stage?.attempts.at(-1)?.id===options.target.attemptId&&(run.controlRevision??0)===options.target.runControlRevision,'RECOVERY_CONFLICT','The failed step changed before continuation.',409);
    demand(run.executionKind||!run.cancelRequested&&run.status!=='cancelled','RECOVERY_CANCELLED','Further work in this execution was stopped.',409);
    demand(stage&&(['failed','interrupted','cancelled'].includes(stage.status)||run.executionKind&&stage.status==='completed'),'NO_FAILED_STAGE','There is no failed step ready to retry.',409);
    demand(!options.browserContinuation||trigger==='manual'&&!!options.target,'OWNER_REQUIRED','Browser continuation requires an explicit owner target.',403);
    if(trigger==='manual')goal.controlRevision=(goal.controlRevision??0)+1;
    if(goal.status==='stopped'&&trigger==='manual')goal.status='failed';
    const now=Date.now(),record:WorkRecoveryRecord={id:randomUUID(),trigger,phase:'checking',runId:run.id,stageId:stage.stageId,attemptId:stage.attempts.at(-1)?.id,runControlRevision:run.controlRevision??0,routerRunId:goal.routerRunId,controlRevision:goal.controlRevision??0,startedAt:new Date(now).toISOString(),deadlineAt:new Date(now+60000).toISOString(),nextAt:new Date(now).toISOString(),checks:0,code:'CONFIRMING_TERMINATION'};
    if(options.browserContinuation)record.browserContinuation=structuredClone(options.browserContinuation);
    if(options.idempotencyKey){record.idempotencyKey=options.idempotencyKey;record.inputHash=options.inputHash;}
    if(note)record.note=note.trim();goal.workRecoveryHistory??=[];goal.workRecoveryHistory.push(record);this.context.save(goal,'work.recovery_checking');return goal;
  }
  tick(){
    if(this.closed)return;
    for(const stored of this.context.all()){
      let goal=stored;
      const held=currentWorkRecovery(goal),heldAttempt=held?.browserContinuation&&this.context.engine.run(held.runId).stages.find(stage=>stage.stageId===held.stageId)?.attempts.at(-1);
      if(held?.phase==='needs_input'&&held.code.startsWith('ACCOUNT_')&&heldAttempt?.browserContinuationId===held.browserContinuation?.id&&heldAttempt?.id!==held.attemptId&&heldAttempt?.admissionHeld!==true&&!['stopped','completed'].includes(goal.status)&&held.controlRevision===(goal.controlRevision??0)&&held.routerRunId===goal.routerRunId){held.phase='retrying';held.code='RETRYING_STEP';held.retriedAt=new Date().toISOString();this.context.save(goal,'work.recovery_retrying');}
      if(!workRecoveryPending(goal)&&goal.status==='dispatched'&&goal.policy.smartRetry===true&&this.transient(goal)){
        const previous=currentWorkRecovery(goal);
        if(previous?.phase==='needs_input'||previous?.phase==='cancelled')continue;
        if(!this.context.family(goal).every(ended))continue;
        const {stage}=this.target(goal),attempt=stage.attempts.at(-1)!;
        const unchanged=stage.attempts.slice(0,-1).some(previous=>executionFailureIdentity(previous)===executionFailureIdentity(attempt));
        if(unchanged){goal=this.begin(goal.id,'automatic');this.finish(goal,attempt.failureCode==='STAGE_TIMEOUT'?'REPEATED_TIMEOUT':'UNCHANGED_FAILURE');continue;}
        goal=this.begin(goal.id,'automatic');
      }
      if(!workRecoveryPending(goal)||this.busy.has(goal.id))continue;
      const recoveryId=currentWorkRecovery(goal)!.id;
      this.busy.add(goal.id);void this.advance(goal.id).catch(error=>{
        if(!this.closed){const current=this.context.get(goal.id);if(currentWorkRecovery(current)?.id===recoveryId&&workRecoveryPending(current))this.finish(current,error instanceof AppError?error.code:'RECOVERY_CHECK_FAILED',error instanceof Error?error.message:String(error));}
      }).finally(()=>this.busy.delete(goal.id));
    }
  }
  private valid(id:string,record:WorkRecoveryRecord):Intake|undefined{
    if(this.closed)return;
    const goal=this.context.get(id),current=currentWorkRecovery(goal);
    if(current?.id!==record.id||!pending.has(current.phase))return;
    if((goal.controlRevision??0)!==record.controlRevision||(this.context.engine.run(record.runId).controlRevision??0)!==(record.runControlRevision??0)||goal.routerRunId!==record.routerRunId||goal.status==='completed'||goal.status==='stopped'){
      current.phase='cancelled';current.endedAt=new Date().toISOString();current.code='RECOVERY_CANCELLED';this.context.save(goal,'work.recovery_cancelled');return;
    }
    return goal;
  }
  private finish(goal:Intake,code:string,error?:string){
    const record=currentWorkRecovery(goal)!;record.phase='needs_input';record.code=code;record.error=error;record.endedAt=new Date().toISOString();this.context.save(goal,'work.recovery_needs_input');this.context.pause(goal);
  }
  private cleanup(goal:Intake){
    const family=this.context.family(goal),records=this.context.engine.store.list<{runId:string;stageId:string;cleanupConfirmed:boolean}>('multica-execution');
    const row=records.find(row=>!row.cleanupConfirmed&&family.some(run=>run.id===row.runId));
    if(row){const run=family.find(run=>run.id===row.runId)!;return{runId:row.runId,stageId:run.executionKind?'supervise':row.stageId};}
    const coordinator=family.find(run=>run.executionKind&&!this.context.confirmed(run));
    if(coordinator)return{runId:coordinator.id,stageId:'supervise',native:coordinator.executionKind==='native-goal'};
    for(const run of family.filter(run=>!run.executionKind))for(const stage of run.stages){const attempt=stage.attempts.at(-1);if(!attempt||!['failed','interrupted','cancelled'].includes(stage.status))continue;
      if(attempt.provider==='multica'&&!records.some(row=>row.runId===run.id&&row.stageId===stage.stageId))return{runId:run.id,stageId:stage.stageId};
      if(attempt.ref?.threadId&&attempt.nativeCleanupConfirmed!==true)return{runId:run.id,stageId:stage.stageId,native:true};
    }
    const native=family.find(run=>run.stages.some(stage=>stage.attempts.some(attempt=>attempt.nativeCleanupConfirmed===false)));
    if(native)return{runId:native.id,stageId:'supervise',native:true};
  }
  private async advance(id:string){
    let goal=this.context.get(id),record=currentWorkRecovery(goal)!;if(!this.valid(id,record))return;
    if(record.phase==='resuming'){this.finish(goal,'RECOVERY_INTERRUPTED');return;}
    const run=this.context.engine.run(record.runId),stage=run.stages.find(stage=>stage.stageId===record.stageId);
    if(!stage){this.finish(goal,'RECOVERY_TARGET_CHANGED');return;}
    if(!run.executionKind&&run.snapshot.pipeline.stages.find(item=>item.id===stage.stageId)?.executor!=='codex'){this.finish(goal,'EXTERNAL_REVIEW_REQUIRED');return;}
    if(record.phase==='retrying'){
      if(stage.allowanceHold){this.finish(goal,stage.allowanceHold.code);return;}
      if(stage.status==='completed'&&this.context.active(id)){await this.complete(goal,record);return;}
      if(!ended(run))return;
      if(run.status!=='completed'){this.finish(goal,stage.attempts.at(-1)?.failureCode==='STAGE_TIMEOUT'?'REPEATED_TIMEOUT':'RETRY_FAILED');return;}
      await this.complete(goal,record);return;
    }
    if(stage.attempts.at(-1)?.id!==record.attemptId||!ended(run)){this.finish(goal,'RECOVERY_TARGET_CHANGED');return;}
    if(Date.now()<Date.parse(record.nextAt))return;
    if(record.phase==='checking'){
      if(Date.now()>=Date.parse(record.deadlineAt)){this.finish(goal,'TERMINATION_UNCONFIRMED');return;}
      const target=this.cleanup(goal);
      if(target){
        if(target.native||!this.context.engine.reconcileExternal){this.finish(goal,'TERMINATION_UNCONFIRMED');return;}
        record.checks++;this.context.save(goal,'work.recovery_observing');
        try{const milliseconds=Math.max(1,Math.min(5000,Date.parse(record.deadlineAt)-Date.now()));await within(this.context.engine.reconcileExternal(target.runId,target.stageId,{signal:AbortSignal.timeout(milliseconds),cancelIfRunning:true}),milliseconds);}
        catch(error){record.error=error instanceof Error?error.message:String(error);}
        const latest=this.valid(id,record);if(!latest)return;goal=latest;record=currentWorkRecovery(goal)!;
        if(this.cleanup(goal)){record.nextAt=new Date(Math.min(Date.parse(record.deadlineAt),Date.now()+Math.min(15000,record.checks*5000))).toISOString();this.context.save(goal,'work.recovery_waiting');return;}
      }
      if(run.executionKind){await this.complete(goal,record);return;}
      if(record.browserContinuation)this.context.engine.authorizeBrowserContinuation(run.id,record.browserContinuation,{name:record.browserContinuation.actor,kind:'human'});
      record.phase='backoff';record.code='RETRY_SCHEDULED';record.nextAt=new Date(Date.now()+(record.trigger==='automatic'?30000:0)).toISOString();this.context.save(goal,'work.recovery_scheduled');return;
    }
    if(this.context.engine.accountMode(run)&&this.context.engine.accountAllowances){
      const account=await within((async()=>this.context.engine.accountAllowances!.assess(await this.context.engine.resolvedAllowanceTarget(run,stage.stageId),{refresh:true}))(),15000);
      const latest=this.valid(id,record);if(!latest)return;goal=latest;record=currentWorkRecovery(goal)!;
      if(account.action!=='continue'||!['ready','learning'].includes(account.status)||Date.parse(account.account.expiresAt)<=Date.now()){this.finish(goal,account.code);return;}
    }
    const fresh=this.context.engine.run(record.runId).stages.find(stage=>stage.stageId===record.stageId);
    if(fresh?.attempts.at(-1)?.id!==record.attemptId||!['failed','interrupted','cancelled'].includes(fresh?.status??'')){record.phase='cancelled';record.code='RECOVERY_TARGET_CHANGED';record.endedAt=new Date().toISOString();this.context.save(goal,'work.recovery_cancelled');return;}
    if(this.cleanup(goal)){this.finish(goal,'TERMINATION_UNCONFIRMED');return;}
    record.phase='retrying';record.code='RETRYING_STEP';record.retriedAt=new Date().toISOString();this.context.save(goal,'work.recovery_retrying');
    try{this.context.engine.retry(run.id,stage.stageId,record.note??'Retry only this failed step from retained work and prior findings; preserve accepted upstream work and current boundaries.',{name:record.trigger==='automatic'?'smart-recovery':'local-owner-recovery',kind:record.trigger==='automatic'?'agent':'human',...(record.trigger==='automatic'?{projectId:goal.projectId}:{})},{...(record.browserContinuation?{browserContinuation:record.browserContinuation}:{})});}
    catch(error){this.finish(this.context.get(id),error instanceof Error&&'code'in error?String(error.code):'RETRY_FAILED',error instanceof Error?error.message:String(error));}
  }
  private async complete(goal:Intake,record:WorkRecoveryRecord){
    if(this.context.active(goal.id)){record.phase='completed';record.endedAt=new Date().toISOString();record.code='RECOVERY_COMPLETED';this.context.save(goal,'work.recovery_completed');return;}
    record.phase='resuming';record.code='RESUMING_COORDINATION';this.context.save(goal,'work.recovery_resuming');
    await within(this.context.resume(goal,record),15000);
  }
  cancel(goal:Intake){const record=currentWorkRecovery(goal);if(record&&pending.has(record.phase)){record.phase='cancelled';record.code='RECOVERY_CANCELLED';record.endedAt=new Date().toISOString();}}
  close(){this.closed=true;}
}
