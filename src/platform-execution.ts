import {CONVERSATION_DATA_RULE} from './intake-context.ts';
import {randomUUID} from 'node:crypto';
import type {ExecutionRef,Project,RoleProfile,TaskOutput,Usage,Run,Intake} from './contracts.ts';
import {budgetTokens} from './contracts.ts';
import type {AgentExecutionInput,AgentExecutor,CodexExecution,AdapterEvent} from './adapters/types.ts';
import type {GoalPlanner,GoalPlannerInput} from './goal-planner.ts';
import {validatePlannerDecision} from './goal-planner.ts';
import {isMulticaTaskTerminal,MulticaApiError,type MulticaTask,type MulticaTaskMessage,type MulticaUsage} from './adapters/multica.ts';
import type {Platform,DaemonIdentity,VerificationScopeProof} from './platform.ts';
import type {ControlMcp} from './control-mcp.ts';
import type {VerificationCheck} from './workspaces.ts';
import {AppError,demand,isObject,validateOutput} from './validation.ts';

export type ExecutionRecord={id:string;projectId:string;runId:string;stageId:string;issueId?:string;taskId?:string;agentId?:string;runtimeId?:string;status:string;cleanupConfirmed:boolean;createdAt:string;updatedAt:string;error?:string;daemon?:DaemonIdentity;usage?:Usage;cancelAcknowledgedAt?:string;issueState?:string;issueDesiredState?:'done'|'cancelled';issueSyncError?:string;rejection?:{code:string;status?:number};verification?:{workspaceId:string;manifestHash:string;scope:VerificationScopeProof;check?:VerificationCheck};timeout?:{configuredSeconds:number;observationDeadlineSeconds:number;runtimeMaxSeconds:null};allowanceExecutionId?:string;allowanceFinishedAt?:string;allowanceFinishError?:'ACCOUNT_OBSERVATION_PENDING'};
export type ReconcileOptions={signal?:AbortSignal;cancelIfRunning?:boolean};
type ReconcileResult=ExecutionRecord&{canRetry:boolean};
type Reconciliation={controller:AbortController;cancelIfRunning:boolean;promise:Promise<ReconcileResult>};
type RemoteProject={id:string;providerProjectId:string;workspace:string;sourceCommit:string;verification?:ExecutionRecord['verification']};
type Request={project:Project;role:RoleProfile;runId:string;stageId:string;attemptId:string;prompt:string;signal:AbortSignal;timeoutSeconds:number;tokenBudget:number;onEvent:(event:AdapterEvent)=>void;onTool?:AgentExecutionInput['onTool'];executionPurpose?:'review';accountStageId?:string};
const at=()=>new Date().toISOString();
const wait=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  checkSignal(signal);
  const abort=()=>{clearTimeout(timer);reject(new AppError('EXECUTION_CHECK_ABORTED','The external execution check was cancelled or reached its deadline.',409));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});
});
function checkSignal(signal?:AbortSignal):void{if(signal?.aborted)throw new AppError('EXECUTION_CHECK_ABORTED','The external execution check was cancelled or reached its deadline.',409);}
function observed<T>(operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  checkSignal(signal);if(!signal)return operation();
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(new AppError('EXECUTION_CHECK_ABORTED','The external execution check was cancelled or reached its deadline.',409));
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{checkSignal(signal);return operation();}).then(value=>{signal.removeEventListener('abort',abort);try{checkSignal(signal);resolve(value);}catch(error){reject(error);}},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}

export function multicaUsage(value:MulticaUsage[]|undefined):Usage|undefined{
  if(!value?.length)return undefined;
  const sums=value.reduce((sum,row)=>({input:sum.input+row.input_tokens+(row.cache_read_tokens??0)+(row.cache_write_tokens??0),output:sum.output+row.output_tokens,cachedInput:sum.cachedInput+(row.cache_read_tokens??0)}),{input:0,output:0,cachedInput:0});
  return{...sums,total:sums.input+sums.output};
}
export function parseAgentJSON(value:string):unknown{
  const trimmed=value.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  try{return JSON.parse(trimmed);}catch{throw new AppError('UNSTRUCTURED_AGENT_RESULT','The agent result needs inspection; it did not return the requested structured result.',409);}
}
export function taskResultText(task:MulticaTask,messages:MulticaTaskMessage[]):string{
  if(typeof task.result==='string')return task.result;
  if(isObject(task.result))for(const key of ['output','text','content','summary','result'])if(typeof task.result[key]==='string')return task.result[key] as string;
  const final=messages.filter(row=>typeof row.content==='string'&&['text','assistant_message','assistant','result','message'].includes(row.type)).at(-1);
  return final?.content??'';
}

/** Multica executes each bounded decision/action; the GWI scheduler owns waiting. */
export class PlatformExecution {
  private platform:Platform;
  private projects=new Map<string,Promise<RemoteProject>>();
  private accountFinishes=new Map<string,Promise<void>>();
  private reconciliations=new Map<string,Reconciliation>();
  private controls?:ControlMcp;private closing=false;private completions=new Set<Promise<unknown>>();
  readonly agent:AgentExecutor;
  readonly planner:GoalPlanner;
  constructor(platform:Platform,controls?:ControlMcp){
    this.platform=platform;this.controls=controls;
    this.agent={start:input=>this.startAgent(input),steer:(ref,text)=>this.steer(ref,text),close:()=>this.close()};
    this.planner={start:input=>this.startPlanner(input)};
  }
  private inspect<T>(operation:()=>Promise<T>,signal:AbortSignal):Promise<T>{
    return observed(()=>{const pending=operation();this.completions.add(pending);void pending.then(()=>this.completions.delete(pending),()=>this.completions.delete(pending));return pending;},signal);
  }
  private async executionProject(request:Request):Promise<RemoteProject>{
    if(request.executionPurpose==='review'){
      const capability=this.platform.verificationCapability();demand(capability.available,'VERIFICATION_CAPABILITY_UNAVAILABLE',capability.reason??'Use a protected configured verifier or owner delivery for these checks.',409);
      const runtime=await this.platform.runtime(request.role,true);await this.platform.authorizeExecutionRoot();const copy=await this.platform.workspaces.prepareVerification(request.project,request.runId,request.attemptId);
      try{
        const proof=await this.platform.verifyReviewScope(copy,request.role);demand(runtime.daemon_id,'RUNTIME_IDENTITY_UNAVAILABLE','The runtime did not report its daemon identity.',409);
        const remote=await this.platform.client.createProject({title:request.project.name+' · verify '+request.attemptId.slice(0,8),description:'GWI disposable prepared-input verification for '+request.attemptId,resources:[{resource_type:'local_directory',resource_ref:{local_path:copy.path,daemon_id:runtime.daemon_id,execution_mode:'in_place'},label:'Prepared verification copy'}]});
        const verification={workspaceId:copy.id,manifestHash:copy.manifest.sha256,scope:proof};
        request.onEvent({type:'verification.prepared',message:'Prepared source copied for independent verification; task-scoped scratch writes and original source protection passed a no-model probe. Filesystem read isolation and network domain restrictions are not provided.',data:{manifest:copy.manifest,scope:proof}});
        const record={id:request.attemptId,providerProjectId:remote.id,workspace:copy.path,sourceCommit:copy.sourceCommit,verification};this.platform.engine.store.put('multica-verification-project',record);return record;
      }catch(error){await this.platform.workspaces.disposeVerification(copy.id);throw error;}
    }
    const known=this.platform.engine.store.get<RemoteProject>('multica-run-project',request.runId);if(known)return known;
    const pending=this.projects.get(request.runId);if(pending)return pending;
    const result=(async()=>{
      const runtime=await this.platform.runtime(request.role,true);await this.platform.authorizeExecutionRoot();const checkout=await this.platform.workspaces.ensure(request.project,request.runId);
      demand(runtime.daemon_id,'RUNTIME_IDENTITY_UNAVAILABLE','The runtime did not report its daemon identity.',409);
      const remote=await this.platform.client.createProject({title:request.project.name+' · '+request.runId.slice(0,8),description:'GWI isolated execution for '+request.runId,resources:[{resource_type:'local_directory',resource_ref:{local_path:checkout.path,daemon_id:runtime.daemon_id,execution_mode:'in_place'},label:'Execution checkout'}]});
      const record={id:request.runId,providerProjectId:remote.id,workspace:checkout.path,sourceCommit:checkout.sourceCommit};this.platform.engine.store.put('multica-run-project',record);return record;
    })().finally(()=>this.projects.delete(request.runId));this.projects.set(request.runId,result);return result;
  }
  private async launch(request:Request):Promise<{ref:ExecutionRef;completion:Promise<{text:string;usage?:Usage}>}>{
    try{return await this.dispatch(request);}catch(error){
      // An assignment intent is durable before POST /issues. Earlier preparation cannot start a worker.
      const pending=this.records(request.runId).some(record=>record.stageId===request.stageId&&!record.cleanupConfirmed);
      if(!this.platform.engine.store.get('multica-execution',request.attemptId)&&!pending){this.platform.engine.store.put('multica-execution',{id:request.attemptId,projectId:request.project.id,runId:request.runId,stageId:request.stageId,status:'not_dispatched',cleanupConfirmed:true,createdAt:at(),updatedAt:at(),error:error instanceof Error?error.message:'Preparation failed before assignment.'} satisfies ExecutionRecord);const copy=this.platform.engine.store.get('verification-workspace',request.attemptId);if(copy)await this.platform.workspaces.disposeVerification(request.attemptId);}
      throw error;
    }
  }
  private async dispatch(request:Request):Promise<{ref:ExecutionRef;completion:Promise<{text:string;usage?:Usage}>}>{
    demand(!request.signal.aborted,'EXECUTION_CANCELLED','Execution was cancelled before dispatch.',409);
    demand(!this.closing,'EXECUTION_CLOSING','The execution service is stopping.',409);
    await this.platform.runtime(request.role,true);
    const previous=this.platform.engine.store.list<ExecutionRecord>('multica-execution').find(row=>row.runId===request.runId&&row.stageId===request.stageId&&!row.cleanupConfirmed);
    demand(!previous,'EXTERNAL_RECONCILIATION_REQUIRED','Inspect the previous external execution before starting this stage again.',409);
    const space=await this.executionProject(request),basis=await this.platform.agent(request.project,request.role,false);
    const lease=request.onTool&&this.controls?this.controls.issue(request.role.tools,request.onTool,request.timeoutSeconds+60):undefined;
    let agent=basis;
    if(lease||space.verification){
      const prior=isObject(basis.mcp_config)&&isObject(basis.mcp_config.mcpServers)?basis.mcp_config.mcpServers:{};
      try{agent=await this.platform.client.createAgent({name:basis.name+' · '+request.attemptId.slice(0,8),runtime_id:basis.runtime_id,description:basis.description+'\nExecution '+request.attemptId,instructions:(basis.instructions??'')+(space.verification?'\nThis task verifies an independent copy of the actual prepared source. Run checks in this copy. Keep included source files, deletions and untracked prepared source unchanged; ignored build/cache output may be written here and disposable scratch belongs in .gwi-verification/. Report actual checks and pending browser/CI requirements in the final JSON observations. Reference source artifacts only; scratch artifacts are disposed after this task. Source protection is write confinement, not filesystem read isolation; network access is enabled without a domain allowlist.':''),model:basis.model,thinking_level:basis.thinking_level,service_tier:'default',visibility:'private',permission_mode:'private',max_concurrent_tasks:1,custom_args:space.verification?['-c','default_permissions="gwi-workspace"','-c','approval_policy="never"']:basis.custom_args,skill_ids:basis.skills?.map(skill=>skill.id)??request.role.multica?.skillIds??[],mcp_config:{mcpServers:{...prior,...lease?.config.mcpServers}}});
        await this.platform.client.setAgentSkills(agent.id,basis.skills?.map(skill=>skill.id)??request.role.multica?.skillIds??[]);
        for(const server of await this.platform.client.listAgentMcpServers(basis.id))if(server.enabled!==false)await this.platform.client.addAgentMcpServer(agent.id,server.id);
      }catch(error){lease?.revoke();throw error;}
    }
    if(request.signal.aborted||this.closing){lease?.revoke();throw new AppError('EXECUTION_CANCELLED','Execution was cancelled before assignment.',409);}
    const record:ExecutionRecord={id:request.attemptId,projectId:request.project.id,runId:request.runId,stageId:request.stageId,status:'not_dispatched',cleanupConfirmed:true,createdAt:at(),updatedAt:at(),agentId:agent.id,runtimeId:agent.runtime_id,daemon:this.platform.executionIdentity(),...(space.verification?{verification:space.verification}:{}),timeout:{configuredSeconds:request.timeoutSeconds,observationDeadlineSeconds:request.timeoutSeconds,runtimeMaxSeconds:this.platform.executionLimits().maxTaskSeconds}};
    let issue,assignmentIntent=false;
    try{
      const canonicalStage=request.accountStageId??(this.platform.engine.store.get<Run>('run',request.runId)?.executionKind?'supervise':request.stageId);
      const allowance=await this.platform.engine.beginAccountExecution(request.runId,canonicalStage,basis.model??null);if(allowance)record.allowanceExecutionId=allowance.id;
      demand(!request.signal.aborted&&!this.closing,'EXECUTION_CANCELLED','Execution was cancelled before assignment.',409);
      record.status='creating';record.cleanupConfirmed=false;this.platform.engine.store.put('multica-execution',record);assignmentIntent=true;
      issue=await this.platform.client.createIssue({title:request.project.name.slice(0,70)+' · '+request.stageId+' · '+request.attemptId.slice(0,8),allow_duplicate:true,project_id:space.providerProjectId,status:'todo',assignee_type:'agent',assignee_id:agent.id,description:request.prompt+'\n\nGWI execution identity: '+request.attemptId+'\nWorkspace: '+space.workspace+'\nSource revision: '+space.sourceCommit});
    }catch(error){
      lease?.revoke();const rejected=!assignmentIntent||error instanceof MulticaApiError&&error.status===409&&error.code==='active_duplicate_issue';record.status=rejected?'not_dispatched':'unknown';record.cleanupConfirmed=rejected;record.error=error instanceof Error?error.message:'External creation could not be confirmed.';if(error instanceof MulticaApiError)record.rejection={code:error.code,status:error.status};record.updatedAt=at();this.platform.engine.store.put('multica-execution',record);
      if(rejected){await this.finishAccountExecution(record,request.onEvent);if(record.verification)await this.platform.workspaces.disposeVerification(record.verification.workspaceId);}throw error;
    }
    record.issueId=issue.id;record.status='queued';this.platform.engine.store.put('multica-execution',record);
    const ref:ExecutionRef={provider:'multica',issueId:issue.id,agentId:agent.id,runtimeId:agent.runtime_id};
    request.onEvent({type:'multica.issue',message:'Agent work queued in Multica.',ref,data:{sourceCommit:space.sourceCommit,workspace:space.workspace}});
    const completion=this.observe(record,request,ref).finally(()=>{lease?.revoke();this.completions.delete(completion);});this.completions.add(completion);return{ref,completion};
  }
  private async observe(record:ExecutionRecord,request:Request,ref:ExecutionRef):Promise<{text:string;usage?:Usage}>{
    const deadline=Date.now()+request.timeoutSeconds*1000,total=new AbortController(),cancellation=new AbortController(),signal=AbortSignal.any([total.signal,cancellation.signal]);
    const totalTimer=setTimeout(()=>total.abort(),request.timeoutSeconds*1000+20000);totalTimer.unref();let cancelDeadline:number|undefined,cancelTimer:ReturnType<typeof setTimeout>|undefined;
    const beginCancellation=()=>{if(cancelDeadline!==undefined)return;cancelDeadline=Date.now()+20000;cancelTimer=setTimeout(()=>cancellation.abort(),20000);cancelTimer.unref();};
    request.signal.addEventListener('abort',beginCancellation,{once:true});if(request.signal.aborted)beginCancellation();
    let sequence=0,lastStatus='',cancelRequested=false,messageFailureReported=false;let messages:MulticaTaskMessage[]=[];
    const readMessages=async(task:MulticaTask)=>{
      try{const added=await this.platform.client.listTaskMessages(task.id,sequence,{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});messages.push(...added);if(messages.length>1000)messages=messages.slice(-1000);for(const row of added){sequence=Math.max(sequence,row.seq);if(row.content)request.onEvent({type:'multica.message',message:row.content.slice(0,6000),ref,data:{sequence:row.seq,type:row.type,tool:row.tool}});}}
      catch(error){if(signal.aborted&&!record.cleanupConfirmed)throw error;if(!messageFailureReported){messageFailureReported=true;request.onEvent({type:'multica.messages_unavailable',message:'Optional execution messages could not be read; task state and reported results remain authoritative.',ref});}}
    };
    try{for(;;){
      if(this.closing){record.status='observation_interrupted';record.updatedAt=at();this.platform.engine.store.put('multica-execution',record);throw new AppError('EXTERNAL_RECONCILIATION_REQUIRED','The service stopped observing this execution. Reconcile its external state before retrying.',409);}
      const tasks=await this.platform.client.listTaskRuns(record.issueId!,{signal});const task=record.taskId?tasks.find(item=>item.id===record.taskId):tasks.at(-1);
      if(task){
        this.taskScope(record,task);
        if(!record.taskId){record.taskId=task.id;ref.externalId=task.id;request.onEvent({type:'multica.task',message:'Multica task identity confirmed.',ref});}
        record.status=task.status;record.updatedAt=at();this.platform.engine.store.put('multica-execution',record);
        if(lastStatus!==task.status){lastStatus=task.status;request.onEvent({type:'multica.status',message:'Agent execution: '+task.status,ref,data:{status:task.status}});}
        const usage=multicaUsage(task.usage);if(usage){this.meter(record,usage);request.onEvent({type:'usage',message:'Multica reported execution usage.',ref,usage:record.usage,data:{buckets:task.usage}});}
        if(isMulticaTaskTerminal(task)){
          if(task.status==='completed'&&task.result!==undefined&&task.result!==null){record.cleanupConfirmed=true;this.platform.engine.store.put('multica-execution',record);request.onEvent({type:'cleanup',message:'Completed external execution confirmed.',ref,data:{confirmed:true}});await this.finishAccountExecution(record,request.onEvent);await this.checkVerification(record,request.onEvent);await readMessages(task);return{text:taskResultText(task,messages),usage:record.usage};}
          if(!task.started_at||task.result!==undefined&&task.result!==null||await this.inspect(()=>this.platform.confirmDaemonIdle(record.daemon),signal)){record.cleanupConfirmed=true;this.platform.engine.store.put('multica-execution',record);}
          if(record.cleanupConfirmed){await this.syncIssue(record,'cancelled',request.onEvent,signal);await this.finishAccountExecution(record,request.onEvent);await this.checkVerification(record,request.onEvent);}
          throw new AppError(record.cleanupConfirmed?'MULTICA_TASK_FAILED':'EXTERNAL_RECONCILIATION_REQUIRED',task.error??task.failure_reason??'The external task did not deliver a verified result.',409);
        }
        if(!cancelRequested&&(request.signal.aborted||Date.now()>=deadline||(record.usage&&budgetTokens(record.usage)>request.tokenBudget))){
          beginCancellation();cancelRequested=true;record.status='cancel_requested';this.platform.engine.store.put('multica-execution',record);const acknowledged=await this.platform.client.cancelTask(record.issueId!,task.id,{signal});this.taskScope(record,acknowledged);demand(acknowledged.id===task.id,'EXTERNAL_TASK_SCOPE','Cancellation acknowledged a different task.',409);record.cancelAcknowledgedAt=at();this.platform.engine.store.put('multica-execution',record);request.onEvent({type:'multica.cancel_requested',message:'External cancellation requested; awaiting authoritative execution state.',ref});
        }
        if(!cancelRequested)await readMessages(task);
      }
      if(cancelDeadline!==undefined&&Date.now()>=Math.min(deadline+20000,cancelDeadline))throw new AppError('EXTERNAL_RECONCILIATION_REQUIRED','External cancellation still needs reconciliation.',409);
      if(!task&&Date.now()>deadline)throw new AppError('EXTERNAL_RECONCILIATION_REQUIRED','Queued work needs external reconciliation before another dispatch.',409);
      await wait(2000,signal);
    }}finally{request.signal.removeEventListener('abort',beginCancellation);clearTimeout(totalTimer);if(cancelTimer)clearTimeout(cancelTimer);}
  }
  private async startAgent(input:AgentExecutionInput):Promise<CodexExecution>{
    const result=await this.launch({...input,prompt:input.prompt+'\n\nReturn only one final JSON object: {"outcome":"done|revise|blocked|no_change","summary":"concise actual result","artifacts":[{"label":"meaningful name","path":"optional relative artifact path","url":"optional actual URL"}],"observations":["actual check or unresolved finding"]}. Do not claim a check that was not performed.'});
    return{ref:result.ref,completion:result.completion.then(async value=>{const output=parseAgentJSON(value.text) as TaskOutput;validateOutput(output);await this.finishIssue(input.attemptId,['done','no_change'].includes(output.outcome)?'done':'cancelled',input.onEvent);return{output,usage:value.usage};}).catch(async error=>{await this.finishIssue(input.attemptId,'cancelled',input.onEvent);throw error;})};
  }
  private async startPlanner(input:GoalPlannerInput){
    const role=input.project.roles.find(item=>item.id==='lead'&&!item.retired)??input.project.roles.find(item=>!item.retired);demand(role,'NO_ACTIVE_COORDINATOR','Connect a project coordinator.');
    const account=input.account?{status:input.account.status,code:input.account.code,action:input.account.action,windows:input.account.account.windows,observedAt:input.account.account.observedAt,expiresAt:input.account.account.expiresAt,trend:input.account.trend,activeExecutions:input.account.activeExecutions}:undefined;
    const brief={request:input.request,baseline:input.baseline,conversation:input.conversation,conversationRule:CONVERSATION_DATA_RULE,continuation:input.continuation,resourceMode:input.resourceMode??'tokens',remaining:input.resourceMode==='account'?{seconds:input.remaining.seconds,rounds:input.remaining.rounds}:input.remaining,...(account?{account}:{}),roles:input.project.roles.filter(role=>!role.retired).map(role=>({id:role.id,sandbox:role.sandbox})),workflows:input.pipelines.map(flow=>({id:flow.id,name:flow.name,owner:flow.roleId,stages:flow.stages.map(stage=>({id:stage.id,name:stage.name,role:stage.roleId,checks:stage.checks,review:stage.review}))})),rounds:input.rounds,observations:input.observations,knowledge:input.knowledge.filter(entry=>!entry.roles.length||entry.roles.includes(role.id)).slice(0,4).map(entry=>({id:entry.id,revision:entry.revision,hash:entry.hash,title:entry.title,excerpt:entry.content.slice(0,1500)}))};
    const prompt='Make exactly one project coordination decision from actual evidence. Do not execute implementation, poll CI, or wait for humans: the platform owns waiting. Reuse accepted work; choose a short useful action. Retry only a failed owned stage when new evidence supports it. For an informational question with no earlier delegated action, use answer with a concise evidence-based response and no tasks. Gather only relevant evidence; state uncertainty. Do not dispatch a workflow merely to answer. Answer cannot certify requested changes, tests, publication or acceptance. Artifact-changing work must still be dispatched and complete only after the requested outcome and accepted delivery are proven.'+(input.resourceMode==='account'?' Account windows and execution trends describe shared account observations. Do not convert token diagnostics into subscription allowance, attribute shared changes solely to this task, or propose token refills. The platform rechecks account admission before paid work.':'')+'\n'+JSON.stringify(brief)+'\nReturn only JSON {"action":"answer|dispatch|retry|complete|clarify|stop","rationale":"concise reason","expectedGain":"useful result","tasks":[{"pipelineId":"actual workflow ID","goal":"bounded instruction"}],"response":"only for answer: the actual read-only answer, at most 16000 characters","question":"only for clarify","retry":{"runId":"owned run ID","stageId":"failed stage ID","note":"what changes"}}. tasks must be empty except for dispatch; at most two tasks. Never invent identifiers.';
    const attemptId=randomUUID(),result=await this.launch({project:input.project,role:{...role,sandbox:'read-only'},runId:input.executionId,stageId:'decision-'+(input.rounds.length+1),accountStageId:'supervise',attemptId,prompt,signal:input.signal,timeoutSeconds:Math.min(300,input.remaining.seconds),tokenBudget:input.remaining.tokens,onEvent:input.onEvent});
    return{ref:result.ref,completion:result.completion.then(async value=>{const decision=validatePlannerDecision(parseAgentJSON(value.text));await this.finishIssue(attemptId,'done',input.onEvent);return{decision,usage:value.usage};}).catch(async error=>{await this.finishIssue(attemptId,'cancelled',input.onEvent);throw error;})};
  }
  private async steer(ref:ExecutionRef,text:string){
    demand(ref.provider==='multica'&&ref.issueId&&ref.externalId,'INVALID_EXECUTION_REFERENCE','An actual running task is required.',409);
    const task=await this.platform.client.getTask(ref.issueId,ref.externalId);demand(task.status==='running'&&task.can_supplement,'STEER_UNAVAILABLE','The active runtime cannot receive another instruction at this point.',409);
    const receipt=await this.platform.client.appendTaskInstruction(ref.issueId,ref.externalId,text,randomUUID());return{id:receipt.id,status:receipt.supplements.find(item=>item.task_id===ref.externalId)?.status??'pending'};
  }
  async close(){this.closing=true;for(const job of this.reconciliations.values())job.controller.abort();await Promise.allSettled([...this.completions,...[...this.reconciliations.values()].map(job=>job.promise)]);}
  private async finishAccountExecution(record:ExecutionRecord,onEvent?:(event:AdapterEvent)=>void):Promise<void>{
    if(!record.allowanceExecutionId||record.allowanceFinishedAt||!record.cleanupConfirmed||!(record.status==='not_dispatched'||isMulticaTaskTerminal(record)))return;
    const pending=this.accountFinishes.get(record.id);if(pending){await pending;const latest=this.platform.engine.store.get<ExecutionRecord>('multica-execution',record.id);if(latest){record.allowanceFinishedAt=latest.allowanceFinishedAt;record.allowanceFinishError=latest.allowanceFinishError;}return;}
    const finish=(async()=>{
      try{
        await this.platform.engine.finishAccountExecution(record.allowanceExecutionId!,{status:record.status,dispatched:record.status!=='not_dispatched'&&Boolean(record.issueId||record.taskId),...(record.usage?{usage:record.usage}:{})});
        record.allowanceFinishedAt=at();delete record.allowanceFinishError;
      }catch{record.allowanceFinishError='ACCOUNT_OBSERVATION_PENDING';onEvent?.({type:'account.observation_pending',message:'Execution ended; its account allowance observation needs another refresh.'});}
      const latest=this.platform.engine.store.get<ExecutionRecord>('multica-execution',record.id)??record;latest.allowanceFinishedAt=record.allowanceFinishedAt;if(record.allowanceFinishError)latest.allowanceFinishError=record.allowanceFinishError;else delete latest.allowanceFinishError;this.platform.engine.store.put('multica-execution',latest);
    })().finally(()=>this.accountFinishes.delete(record.id));this.accountFinishes.set(record.id,finish);await finish;
  }
  private async checkVerification(record:ExecutionRecord,onEvent?:(event:AdapterEvent)=>void){
    if(!record.verification||record.verification.check)return;
    const check=await this.platform.workspaces.checkVerification(record.verification.workspaceId);record.verification.check=check;this.platform.engine.store.put('multica-execution',record);
    await this.platform.workspaces.disposeVerification(record.verification.workspaceId);
    onEvent?.({type:'verification.checked',message:check.unchanged?'Verification finished with the prepared source unchanged; the disposable copy has been removed.':'Verification changed prepared source; its result cannot satisfy independent review.',data:check});
    demand(check.unchanged,'VERIFICATION_SOURCE_MUTATED','The verification task changed prepared source. Its result was rejected; retry independent verification or return the change to implementation.',409);
  }
  private async finishIssue(id:string,state:'done'|'cancelled',onEvent?:(event:AdapterEvent)=>void){const record=this.platform.engine.store.get<ExecutionRecord>('multica-execution',id);if(record)await this.syncIssue(record,state,onEvent);}
  private async syncIssue(record:ExecutionRecord,state:'done'|'cancelled',onEvent?:(event:AdapterEvent)=>void,signal?:AbortSignal){
    checkSignal(signal);
    if(!record.issueId||!record.cleanupConfirmed||record.issueState===state)return;
    record.issueDesiredState=state;this.platform.engine.store.put('multica-execution',record);
    try{await this.platform.client.updateIssue(record.issueId,{status:state},{signal});checkSignal(signal);record.issueState=state;delete record.issueSyncError;}
    catch(error){checkSignal(signal);record.issueSyncError=error instanceof Error?error.message:'Issue metadata could not be synchronized.';onEvent?.({type:'multica.issue_sync_pending',message:'Execution ended; issue metadata synchronization needs another check.',data:{issueId:record.issueId}});}
    record.updatedAt=at();this.platform.engine.store.put('multica-execution',record);
  }
  records(runId:string){return this.platform.engine.store.list<ExecutionRecord>('multica-execution').filter(row=>row.runId===runId);}
  private meter(record:ExecutionRecord,usage:Usage){
    if(record.usage&&budgetTokens(record.usage)>budgetTokens(usage))return;
    record.usage=usage;const store=this.platform.engine.store;
    store.transaction(()=>{store.put('multica-execution',record);const run=store.get<Run>('run',record.runId);if(!run||run.projectId!==record.projectId)return;
      const stage=run.stages.find(stage=>stage.stageId===record.stageId)??(run.executionKind==='agent-goal'?run.stages.find(stage=>stage.stageId==='supervise'):undefined);
      const attempt=stage?.attempts.find(attempt=>attempt.ref?.provider==='multica'&&attempt.ref.issueId===record.issueId&&(!attempt.ref.externalId||attempt.ref.externalId===record.taskId));
      if(attempt&&(!attempt.usage||budgetTokens(usage)>=budgetTokens(attempt.usage))){attempt.usage=usage;run.updatedAt=at();store.put('run',run);}
    });
  }
  private taskScope(record:ExecutionRecord,task:MulticaTask){demand(task.issue_id===record.issueId&&task.agent_id===record.agentId&&(!record.runtimeId||task.runtime_id===record.runtimeId),'EXTERNAL_TASK_SCOPE','The observed task does not belong to this recorded assignment and runtime.',409);}
  async reconcile(runId:string,stageId:string,options:ReconcileOptions={}):Promise<ReconcileResult>{
    checkSignal(options.signal);demand(!this.closing,'EXECUTION_CLOSING','The execution service is stopping.',409);
    const run=this.platform.engine.run(runId),item=stageId==='supervise'&&run.executionKind==='agent-goal'?this.platform.engine.store.list<Intake>('intake').find(value=>value.projectId===run.projectId&&(value.routerRunId===runId||value.supervisorRunIds?.includes(runId))):undefined;
    const canonical=item?'decision-'+(item.rounds.find(round=>round.routerRunId===runId)?.number??item.rounds.length+1):stageId,key=JSON.stringify([runId,canonical]);
    const pending=this.reconciliations.get(key);if(pending){pending.cancelIfRunning||=options.cancelIfRunning===true;return observed(()=>pending.promise,options.signal);}
    const controller=new AbortController(),signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
    const job:Reconciliation={controller,cancelIfRunning:options.cancelIfRunning===true,promise:Promise.resolve().then(()=>this.reconcileOwned(runId,stageId,signal,job)).finally(()=>{if(this.reconciliations.get(key)===job)this.reconciliations.delete(key);})};
    this.reconciliations.set(key,job);
    return observed(()=>job.promise,options.signal);
  }
  private async reconcileOwned(runId:string,stageId:string,signal:AbortSignal,job:Reconciliation):Promise<ReconcileResult>{
    checkSignal(signal);
    const run=this.platform.engine.run(runId),attempt=run.stages[0]?.attempts.at(-1);
    if(stageId==='supervise'&&run.executionKind==='agent-goal'){
      const item=this.platform.engine.store.list<Intake>('intake').find(item=>item.projectId===run.projectId&&(item.routerRunId===runId||item.supervisorRunIds?.includes(runId)));demand(item,'EXECUTION_NOT_FOUND','This coordinator has no owning outcome.',404);
      stageId='decision-'+(item.rounds.find(round=>round.routerRunId===runId)?.number??item.rounds.length+1);
      if(!this.records(runId).length&&run.status==='failed'&&attempt?.status==='failed'&&attempt.provider==='multica'&&attempt.error&&!attempt.ref?.issueId&&!attempt.ref?.externalId&&!attempt.ref?.threadId){
        const record:ExecutionRecord={id:'preparation-'+runId,projectId:run.projectId,runId,stageId,status:'not_dispatched',cleanupConfirmed:true,createdAt:attempt.startedAt,updatedAt:at(),error:attempt.error};this.platform.engine.store.put('multica-execution',record);
        this.platform.engine.store.event({projectId:run.projectId,runId,stageId,type:'multica.preparation_reconciled',actor:'local-owner',message:'Local preparation ended before any external assignment intent. No worker was dispatched.'});
      }
    }
    const record=this.records(runId).filter(row=>row.stageId===stageId).at(-1);demand(record,'EXECUTION_NOT_FOUND','This stage has no recorded external execution.',404);demand(record.projectId===run.projectId,'EXTERNAL_TASK_SCOPE','The recorded assignment belongs to another project.',409);
    for(const previous of this.records(runId).filter(previous=>previous.id!==record.id&&previous.stageId===stageId&&previous.cleanupConfirmed)){await this.inspect(()=>this.finishAccountExecution(previous),signal);if(previous.issueDesiredState&&previous.issueSyncError)await this.syncIssue(previous,previous.issueDesiredState,undefined,signal);else if(['failed','cancelled','aborted','timeout'].includes(previous.status))await this.syncIssue(previous,'cancelled',undefined,signal);}
    if(record.issueDesiredState&&record.issueSyncError)await this.syncIssue(record,record.issueDesiredState,undefined,signal);
    if(record.status==='not_dispatched'&&record.cleanupConfirmed&&!record.issueId&&!record.taskId){await this.inspect(()=>this.finishAccountExecution(record),signal);return{...record,canRetry:true};}
    if(!record.issueId&&record.agentId){
      const space=record.verification?this.platform.engine.store.get<RemoteProject>('multica-verification-project',record.id):this.platform.engine.store.get<RemoteProject>('multica-run-project',runId),matches:{task:MulticaTask;issueId:string}[]=[];
      for(const task of await this.platform.client.listAgentTasks(record.agentId,{signal})){
        if(!task.issue_id||task.agent_id!==record.agentId||record.runtimeId&&task.runtime_id!==record.runtimeId)continue;
        const issue=await this.platform.client.getIssue(task.issue_id,{signal});
        if(space&&issue.project_id===space.providerProjectId&&issue.description?.includes('\nGWI execution identity: '+record.id+'\n'))matches.push({task,issueId:issue.id});
      }
      checkSignal(signal);if(matches.length===1){record.issueId=matches[0].issueId;record.taskId=matches[0].task.id;this.platform.engine.store.put('multica-execution',record);
        const current=this.platform.engine.run(runId),state=current.stages.find(state=>state.stageId===stageId)??(current.executionKind==='agent-goal'?current.stages.find(state=>state.stageId==='supervise'):undefined),attempt=state?.attempts.at(-1);
        if(attempt&&!attempt.ref?.issueId&&!attempt.ref?.externalId){attempt.provider='multica';attempt.ref={provider:'multica',issueId:record.issueId,externalId:record.taskId,agentId:record.agentId,runtimeId:record.runtimeId};current.updatedAt=at();this.platform.engine.store.put('run',current);}
      }
    }
    demand(record.issueId,'EXTERNAL_CREATION_UNCERTAIN','The assignment response was lost. Inspect the recorded execution identity in Multica before another dispatch.',409);
    const tasks=await this.platform.client.listTaskRuns(record.issueId,{signal});const task=record.taskId?tasks.find(task=>task.id===record.taskId):tasks.length===1?tasks[0]:undefined;
    demand(task,'EXTERNAL_TASK_UNCONFIRMED','The provider has not confirmed an unambiguous task for this assignment.',409);
    this.taskScope(record,task);
    checkSignal(signal);record.taskId=task.id;record.status=task.status;if(!isMulticaTaskTerminal(task))record.cleanupConfirmed=false;record.updatedAt=at();
    const usage=multicaUsage(task.usage);if(usage)this.meter(record,usage);
    if(isMulticaTaskTerminal(task)&&(!task.started_at||task.result!==undefined&&task.result!==null||await this.inspect(()=>this.platform.confirmDaemonIdle(record.daemon),signal)))record.cleanupConfirmed=true;
    checkSignal(signal);
    this.platform.engine.store.put('multica-execution',record);
    if(!isMulticaTaskTerminal(task)&&job.cancelIfRunning&&!record.cancelAcknowledgedAt){record.status='cancel_requested';record.updatedAt=at();this.platform.engine.store.put('multica-execution',record);const acknowledged=await this.platform.client.cancelTask(record.issueId,task.id,{signal});checkSignal(signal);this.taskScope(record,acknowledged);demand(acknowledged.id===task.id,'EXTERNAL_TASK_SCOPE','Cancellation acknowledged a different task.',409);record.cancelAcknowledgedAt=at();this.platform.engine.store.put('multica-execution',record);}
    if(record.cleanupConfirmed){await this.inspect(()=>this.finishAccountExecution(record),signal);await this.inspect(()=>this.checkVerification(record),signal);}
    if(record.cleanupConfirmed&&task.status!=='completed')await this.syncIssue(record,'cancelled',undefined,signal);
    this.platform.engine.store.event({projectId:record.projectId,runId,stageId,type:'multica.reconciled',actor:'local-owner',message:record.cleanupConfirmed?'External task termination confirmed; prior results remain available for review.':'External task state observed; termination is not yet confirmed.',data:{taskId:task.id,status:task.status,cleanupConfirmed:record.cleanupConfirmed}});
    return{...record,canRetry:record.cleanupConfirmed};
  }
}
