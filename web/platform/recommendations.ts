import type {Pipeline,RoleProfile,Run} from '../../src/contracts';

export function recommendPipelines(pipelines:Pipeline[],runs:Run[],roles:RoleProfile[],limit=4){
 const activeRoles=new Set(roles.filter(role=>!role.retired).map(role=>role.id));
 const lastUses=new Map<string,{at:string;time:number}>();
 for(const run of runs){
  const time=Date.parse(run.createdAt);
  if(Number.isFinite(time)&&time>(lastUses.get(run.pipelineId)?.time??0))lastUses.set(run.pipelineId,{at:run.createdAt,time});
 }
 return pipelines.flatMap((pipeline,index)=>{
  if(pipeline.stages.length<2||!activeRoles.has(pipeline.roleId)||pipeline.stages.some(stage=>!activeRoles.has(stage.roleId)))return [];
  const roleCount=new Set(pipeline.stages.map(stage=>stage.roleId)).size;
  const structure=Number(roleCount>1)+Number(pipeline.stages.some(stage=>stage.review))+Number(pipeline.stages.some(stage=>stage.executor==='pipeline'))+Number(pipeline.stages.some(stage=>stage.condition||stage.reworkTo));
  return [{pipeline,roleCount,structure,index,lastUse:lastUses.get(pipeline.id)}];
 }).sort((a,b)=>(b.lastUse?.time??0)-(a.lastUse?.time??0)||Number(b.roleCount>1)-Number(a.roleCount>1)||a.pipeline.stages.length-b.pipeline.stages.length||b.structure-a.structure||a.index-b.index).slice(0,limit);
}
