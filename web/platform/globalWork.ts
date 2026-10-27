import type {WorkspaceSummary,WorkspaceWork} from '../../src/contracts';
import type {Route} from './route';
import type {CreatedWork} from './workObservations';

export function globalWorkRoute(route:Route,projectId:string,kind:'goal'|'run',id:string,stageId?:string):Route {
  return{surface:'workbench',role:'',projectFilter:route.projectFilter,contextProjectId:projectId,...(kind==='goal'?{intakeId:id}:{runId:id,stageId})};
}

export function observeWorkspace(previous:WorkspaceSummary|null,incoming:WorkspaceSummary):WorkspaceSummary {
  if(previous&&(incoming.sequence<previous.sequence||incoming.projects.some(project=>project.revision<(previous.projects.find(item=>item.id===project.id)?.revision??0))))return previous;
  return incoming;
}

export function unobservedWorkspaceReceipts(summary:WorkspaceSummary,pending:readonly CreatedWork[]):CreatedWork[]{
  return pending.filter(receipt=>{
    const current=summary.work.find(item=>item.projectId===receipt.value.projectId&&item.kind===(receipt.kind==='run'?'run':'goal')&&item.id===receipt.value.id);
    if(!current)return true;
    if(receipt.kind!=='continued-intake')return false;
    if(current.routerRunId===receipt.value.routerRunId||(current.controlRevision??0)>(receipt.previous.controlRevision??0))return false;
    if(current.routerRunId===receipt.previous.routerRunId||receipt.value.supervisorRunIds?.includes(current.routerRunId??''))return true;
    return Date.parse(current.updatedAt)<=Date.parse(receipt.value.updatedAt);
  });
}

export function nextWorkspaceInteraction(previous:{stamp:string;generation:number},stamp:string){return previous.stamp===stamp?previous:{stamp,generation:previous.generation+1};}

export function knownWorkspace(summary:WorkspaceSummary|null,projects:WorkspaceSummary['projects'],pending:readonly CreatedWork[]):WorkspaceSummary|null {
  if(!summary&&!pending.length)return null;
  return workspaceWithReceipts(summary??{projects,work:[],decisions:[],sequence:0,observedAt:''},pending);
}

/** Keep acknowledged work visible even when the global read has not observed its creation. */
export function workspaceWithReceipts(summary:WorkspaceSummary,pending:readonly CreatedWork[]):WorkspaceSummary {
  const work=[...summary.work],projects=new Set(summary.projects.map(project=>project.id)),answeredQuestions=new Set<string>();
  for(const receipt of pending){
    if(!projects.has(receipt.value.projectId))continue;
    const kind=receipt.kind==='run'?'run':'goal',index=work.findIndex(item=>item.projectId===receipt.value.projectId&&item.kind===kind&&item.id===receipt.value.id);
    if(index>=0&&!(receipt.kind==='continued-intake'&&work[index].status===receipt.previous.status&&Date.parse(work[index].updatedAt)<=Date.parse(receipt.previous.updatedAt)))continue;
    if(receipt.kind==='continued-intake'&&receipt.value.status!=='clarification')answeredQuestions.add(JSON.stringify([receipt.value.projectId,receipt.value.id]));
    const item:WorkspaceWork={id:receipt.value.id,projectId:receipt.value.projectId,kind,title:receipt.kind==='run'?receipt.value.goal:receipt.value.request,status:receipt.value.status,updatedAt:receipt.value.updatedAt,...(receipt.kind!=='run'?{routerRunId:receipt.value.routerRunId,controlRevision:receipt.value.controlRevision,...(receipt.value.resultKind?{resultKind:receipt.value.resultKind}:{})}:{})};
    if(index<0)work.unshift(item);else work[index]=item;
  }
  return{...summary,work,decisions:summary.decisions.filter(item=>!item.intakeId||!answeredQuestions.has(JSON.stringify([item.projectId,item.intakeId])))};
}
