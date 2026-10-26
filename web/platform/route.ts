export type Surface = 'workbench'|'pipelines'|'team'|'knowledge'|'settings'|'configuration';
export type Route = {projectId?:string;surface:Surface;role:string;pipelineId?:string;runId?:string;stageId?:string;entryId?:string;intakeId?:string;adoptionId?:string;tab?:'library'|'executions';editing?:boolean};
export type Navigate = (route:Route)=>void;
export function readRoute():Route {
  const [pathname='',query='']=location.hash.replace(/^#\/?/,'').split('?'), parts=pathname.split('/'), params=new URLSearchParams(query);
  const requested=parts[2]; const surface:Surface=requested==='pipelines'||requested==='team'||requested==='knowledge'||requested==='settings'?requested:requested==='configuration'?'settings':'workbench';
  let projectId:string|undefined;try{projectId=parts[0]==='projects'&&parts[1]?decodeURIComponent(parts[1]):undefined;}catch{projectId=undefined;}
  return{projectId,surface,role:params.get('role')??'',pipelineId:params.get('pipeline')??undefined,runId:params.get('run')??undefined,stageId:params.get('stage')??undefined,entryId:params.get('entry')??undefined,intakeId:params.get('goal')??params.get('intake')??undefined,adoptionId:params.get('adoption')??undefined,tab:params.get('tab')==='executions'?'executions':'library',editing:params.get('edit')==='1'};
}
export function writeRoute(route:Route):string {
  const query=new URLSearchParams();for(const [key,value]of [['role',route.role],['pipeline',route.pipelineId],['run',route.runId],['stage',route.stageId],['entry',route.entryId],['goal',route.intakeId],['adoption',route.adoptionId],['tab',route.tab==='executions'?'executions':undefined],['edit',route.editing?'1':undefined]])if(value)query.set(key!,value);
  return `#/projects${route.projectId?`/${encodeURIComponent(route.projectId)}/${route.surface==='configuration'?'settings':route.surface}`:''}${query.size?'?'+query.toString():''}`;
}
