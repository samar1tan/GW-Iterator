import type {Intake,ProjectOverview,Run,WorkspaceSummary,WorkspaceWork} from './contracts.ts';
import {currentWorkStatuses,activeRecoveryPhases} from './contracts.ts';
import {currentGoalRecovery,runAcceptsInput} from './contracts.ts';

/** Project membership is supplied by the caller's authorized project list. Never expose snapshots here. */
export function workspaceSummary(projects:ProjectOverview[],allRuns:Run[],allIntakes:Intake[],sequence:number):WorkspaceSummary {
  const ids=new Set(projects.map(project=>project.id)),runs=allRuns.filter(run=>ids.has(run.projectId)),intakes=allIntakes.filter(goal=>ids.has(goal.projectId));
  const runKey=(projectId:string,id:string)=>JSON.stringify([projectId,id]);
  const owned=new Map(intakes.flatMap(goal=>[goal.routerRunId,...(goal.supervisorRunIds??[]),...goal.targetRunIds].map(id=>[runKey(goal.projectId,id),goal.id] as const)));
  const root=(run:Run):{workKind:'goal'|'run';workId:string}=>{let current=run;const seen=new Set<string>();while(!seen.has(current.id)){seen.add(current.id);const goal=owned.get(runKey(current.projectId,current.id));if(goal)return{workKind:'goal',workId:goal};const parent=runs.find(item=>item.projectId===current.projectId&&item.id===current.parentRunId);if(!parent)break;current=parent;}return{workKind:'run',workId:current.id};};
  const decisions:WorkspaceSummary['decisions']=[];
  for(const goal of intakes)if(goal.status==='clarification')decisions.push({id:goal.projectId+':goal:'+goal.id,projectId:goal.projectId,kind:'clarification',title:goal.question??goal.request,request:goal.request,intakeId:goal.id,workKind:'goal',workId:goal.id});
  for(const run of runs.filter(run=>!run.executionKind&&runAcceptsInput(run,runs,intakes)))for(const stage of run.stages){
    const definition=run.snapshot.pipeline.stages.find(item=>item.id===stage.stageId);
    if(!definition)continue;
    const kind=stage.status==='review'?'review':stage.status==='waiting'?(stage.allowanceHold?'account':definition.executor==='manual'?'manual':undefined):undefined;
    if(kind)decisions.push({id:run.projectId+':stage:'+run.id+':'+stage.stageId,projectId:run.projectId,kind,title:definition.name,request:run.goal,runId:run.id,stageId:stage.stageId,...root(run)});
  }
  const work:WorkspaceWork[]=intakes.map(goal=>{
    const execution=runs.find(run=>run.id===goal.routerRunId),action=runs.find(run=>goal.targetRunIds.includes(run.id)&&currentWorkStatuses.has(run.status)),current=goal.status==='dispatched'?action:execution;
    const stage=current?.stages.find(stage=>['running','waiting','review'].includes(stage.status)),recovery=currentGoalRecovery(goal),recovering=activeRecoveryPhases.has(recovery?.phase??'');
    return{id:goal.id,projectId:goal.projectId,kind:'goal',title:goal.request,status:goal.status,updatedAt:goal.updatedAt,routerRunId:goal.routerRunId,controlRevision:goal.controlRevision,...(recovery?{recoveryPhase:recovery.phase,recoveryId:recovery.id}:{}),...(goal.resultKind?{resultKind:goal.resultKind}:{}),...(stage&&goal.status==='dispatched'?{stageName:current!.snapshot.pipeline.stages.find(item=>item.id===stage.stageId)?.name}:{}),...(goal.status==='failed'&&!recovering?{attention:true}:{})};
  });
  for(const run of runs.filter(run=>!run.parentRunId&&!run.executionKind&&!owned.has(runKey(run.projectId,run.id)))){
    const stage=run.stages.find(stage=>['running','waiting','review'].includes(stage.status));
    work.push({id:run.id,projectId:run.projectId,kind:'run',title:run.goal,status:run.status,updatedAt:run.updatedAt,pipelineName:run.snapshot.pipeline.name,...(stage?{stageName:run.snapshot.pipeline.stages.find(item=>item.id===stage.stageId)?.name}:{}),...(['failed','interrupted'].includes(run.status)?{attention:true}:{})});
  }
  for(const item of work){const hasDecision=decisions.some(decision=>decision.projectId===item.projectId&&decision.workKind===item.kind&&decision.workId===item.id);if(!hasDecision)continue;const running=runs.some(run=>{if(run.projectId!==item.projectId||!(run.status==='queued'||run.stages.some(stage=>stage.status==='running'||stage.status==='waiting'&&!stage.allowanceHold&&['codex','github'].includes(run.snapshot.pipeline.stages.find(item=>item.id===stage.stageId)?.executor??''))))return false;const owner=root(run);return owner.workKind===item.kind&&owner.workId===item.id;});if(!running)item.waitingForInput=true;}
  work.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.projectId.localeCompare(b.projectId)||a.id.localeCompare(b.id));
  return{projects:projects.map(({id,name,repository,revision,pipelineCount})=>({id,name,repository,revision,pipelineCount})),work,decisions,sequence,observedAt:new Date().toISOString()};
}
