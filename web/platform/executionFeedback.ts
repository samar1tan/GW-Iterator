import type {Attempt,AuditEvent,Run} from '../../src/contracts';

export type ExecutionOperation='preparing'|'submitted'|'queued'|'working'|'command'|'tool'|'files'|'responding'|'output'|'commentary'|'reported'|'human'|'review'|'ci'|'approval'|'stopping'|'providerWait'|'paused'|'received';
export type ExecutionSignal={operation:ExecutionOperation;at:string;text?:string;command?:string;tool?:string;lifecycle?:'active'|'queued'|'waiting'|'stopping'};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const metadata=(event:AuditEvent)=>{const outer=object(event.data);return{outer,detail:Object.keys(object(outer.detail)).length?object(outer.detail):outer};};
const typeOf=(event:AuditEvent)=>event.type.replace(/^codex\.(?=multica\.|item\/|turn\/|thread\/|model\/|gwi\.|codex\.|error$|usage$)/,'');

/** Only public, classified operations become progress; transport/reasoning stays technical. */
export function executionSignal(event:AuditEvent):ExecutionSignal|undefined {
  const type=typeOf(event),{detail}=metadata(event),base={at:event.at};
  if(type==='multica.status'){
    if(['queued','pending'].includes(String(detail.status)))return{...base,operation:'queued',lifecycle:'queued'};
    if(['running','in_progress'].includes(String(detail.status)))return{...base,operation:'working',lifecycle:'active'};
    return{...base,operation:'providerWait',lifecycle:'waiting'};
  }
  if(type==='multica.issue')return{...base,operation:'queued',lifecycle:'queued'};
  if(type==='multica.task')return{...base,operation:'submitted'};
  if(type==='codex.started'||type==='started'||type==='turn/started')return{...base,operation:'working',lifecycle:'active'};
  if(type==='thread/status/changed'){
    if(Array.isArray(detail.activeFlags)&&detail.activeFlags.some(flag=>flag==='waitingOnApproval'||flag==='waitingOnUserInput'))return{...base,operation:'providerWait',lifecycle:'waiting'};
    if(detail.status==='active')return{...base,operation:'working',lifecycle:'active'};
    return{...base,operation:'providerWait',lifecycle:'waiting'};
  }
  if(['error','codex.disconnected','codex.goal_cleanup_failed','codex.goal_circuit_open','codex.token_limit','codex.timeout','model/verification'].includes(type)||type==='model/safetyBuffering/updated'&&detail.showBufferingUi===true)return{...base,operation:'providerWait',lifecycle:'waiting'};
  if(type==='codex.goal_stopping')return{...base,operation:'stopping',lifecycle:'stopping'};
  if(type==='gwi.tool.started'||type==='gwi.tool.completed')return{...base,operation:type.endsWith('started')?'tool':'reported',tool:typeof detail.tool==='string'?detail.tool.slice(0,160):undefined};
  if(type==='multica.message'&&['tool_call','tool_result','tool_use'].includes(String(detail.type))&&typeof detail.tool==='string')return{...base,operation:detail.type==='tool_result'?'reported':'tool',tool:detail.tool.slice(0,160)};
  if(type==='multica.message'&&detail.type==='text'&&event.message.trim())return{...base,operation:'output'};
  if(type==='item/started'||type==='item/completed'){
    const started=type==='item/started';
    if(detail.itemType==='commandExecution')return{...base,operation:started?'command':'reported',command:event.message.slice(0,2000)};
    if(['mcpToolCall','dynamicToolCall','webSearch'].includes(String(detail.itemType)))return{...base,operation:started?'tool':'reported'};
    if(detail.itemType==='fileChange')return{...base,operation:started?'files':'reported'};
    if(detail.itemType==='agentMessage'){
      if(!started&&detail.phase==='commentary'&&event.message.trim()&&!/^\s*[\[{]/.test(event.message))return{...base,operation:'commentary',text:event.message.slice(0,800)};
      if(started)return{...base,operation:'responding'};
    }
  }
  return undefined;
}

export function currentAttemptEvents(run:Run,stageId:string,attempt:Attempt|undefined,events:AuditEvent[]):AuditEvent[] {
  if(!attempt)return[];
  return events.filter(event=>{
    if(event.projectId!==run.projectId||event.runId!==run.id||event.stageId!==stageId||!Number.isFinite(Date.parse(event.at))||!Number.isFinite(Date.parse(attempt.startedAt))||Date.parse(event.at)<Date.parse(attempt.startedAt))return false;
    const {outer}=metadata(event);if(typeof outer.attemptId==='string')return outer.attemptId===attempt.id;
    const ref=object(outer.ref);
    for(const key of ['threadId','turnId','externalId'] as const)if(ref[key]&&attempt.ref?.[key]&&ref[key]!==attempt.ref[key])return false;
    return Number.isFinite(Date.parse(event.at))&&Number.isFinite(Date.parse(attempt.startedAt))&&(['threadId','turnId','externalId'] as const).some(key=>!!attempt.ref?.[key]&&ref[key]===attempt.ref[key]);
  }).sort((a,b)=>a.seq-b.seq);
}

export type ExecutionFeedback={operation:ExecutionOperation;signal?:ExecutionSignal;elapsedSeconds?:number;activitySeconds?:number;lastActivityAt?:string;quiet:boolean;observationGap:boolean;moving:boolean};
export function executionFeedback(run:Run,stageId:string,events:AuditEvent[],options:{now:number;observedAt?:number;observationFailed?:boolean;settling?:boolean}):ExecutionFeedback|null {
  const stage=run.stages.find(item=>item.stageId===stageId),definition=run.snapshot.pipeline.stages.find(item=>item.id===stageId),attempt=stage?.attempts.at(-1);
  if(!stage||!definition)return null;
  const terminal=['completed','failed','cancelled','interrupted','skipped'].includes(stage.status)||['completed','failed','cancelled','interrupted','skipped'].includes(run.status);
  if(terminal&&(!options.settling||stage.status!=='completed'||run.status!=='completed'))return null;
  const signals=currentAttemptEvents(run,stageId,attempt,events).map(executionSignal).filter((value):value is ExecutionSignal=>!!value),signal=signals.at(-1);
  const lifecycle=signals.findLast(value=>value.lifecycle)?.lifecycle;
  let operation:ExecutionOperation=signal?.operation??(attempt?.ref?'submitted':'preparing');
  if(lifecycle==='queued')operation='queued';
  else if(lifecycle==='waiting')operation='providerWait';
  else if(lifecycle==='stopping')operation='stopping';
  if(terminal)operation='received';
  else if(run.cancelRequested)operation='stopping';
  else if(stage.allowanceHold)operation='approval';
  else if(stage.status==='review')operation='review';
  else if(stage.status==='waiting')operation=definition.executor==='manual'?'human':definition.executor==='github'?'ci':'providerWait';
  else if(stage.status==='queued')operation='queued';
  else if(run.status==='paused'||stage.status==='paused')operation='paused';
  else if(definition.executor==='github')operation='ci';
  const startedAt=attempt?.startedAt,lastActivityAt=signal?.at??startedAt;
  const activitySeconds=lastActivityAt?Math.max(0,Math.floor((options.now-Date.parse(lastActivityAt))/1000)):undefined,elapsedSeconds=startedAt?Math.max(0,Math.floor(((attempt?.endedAt?Date.parse(attempt.endedAt):options.now)-Date.parse(startedAt))/1000)):undefined;
  const observationGap=!!options.observationFailed||(options.observedAt!==undefined&&options.now-options.observedAt>15000);
  const staticOperation=!['working','command','tool','files','responding','output','commentary','reported'].includes(operation);
  const quiet=!terminal&&!staticOperation&&activitySeconds!==undefined&&activitySeconds>=30;
  return{operation,signal,elapsedSeconds,activitySeconds,lastActivityAt,quiet,observationGap,moving:stage.status==='running'&&!terminal&&!staticOperation&&!quiet&&!observationGap};
}
