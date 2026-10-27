import path from 'node:path';
import {CONTROL_TOOLS, EXECUTORS, EFFORTS} from './contracts.ts';
import type {Pipeline,Project,TaskOutput} from './contracts.ts';

export class AppError extends Error {
  code:string; status:number; details?:unknown;
  constructor(code:string,message:string,status=400,details?:unknown){super(message);this.code=code;this.status=status;this.details=details;}
}
export function demand(condition:unknown,code:string,message:string,status=400):asserts condition{if(!condition)throw new AppError(code,message,status);}
export const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export const text=(value:unknown,max=20000):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
const unique=(values:string[])=>new Set(values).size===values.length;
const contractList=(value:unknown)=>value===undefined||(Array.isArray(value)&&value.length<=40&&value.every(item=>text(item,2000)));
export function validateProject(project:Project):void {
  demand(isObject(project)&&id(project.id)&&text(project.name,160)&&typeof project.description==='string'&&text(project.workspace,4096)&&path.isAbsolute(project.workspace),'INVALID_PROJECT','A project needs a name and absolute workspace path.');
  demand(project.repository===''||/^[\w.-]+\/[\w.-]+$/.test(project.repository),'INVALID_REPOSITORY','Use an owner/repository name.');
  demand(Array.isArray(project.roles)&&project.roles.length>0&&project.roles.length<=32&&unique(project.roles.map(role=>role.id)),'INVALID_ROLES','Roles must have unique identifiers.');
  for(const role of project.roles){
    demand(id(role.id)&&text(role.name,160)&&typeof role.instructions==='string'&&role.instructions.length<=40000&&['read-only','workspace-write'].includes(role.sandbox)&&EFFORTS.includes(role.effort),'INVALID_ROLE','Check role identity, instructions and execution policy.');
    demand(Array.isArray(role.tools)&&role.tools.every(tool=>CONTROL_TOOLS.includes(tool))&&Array.isArray(role.skills)&&role.skills.length<=30&&role.skills.every(skill=>text(skill.name,160)&&text(skill.path,4096)&&path.isAbsolute(skill.path)),'INVALID_ROLE_TOOLS','Choose supported tools and installed skill paths.');
    demand(role.model===null||text(role.model,160),'INVALID_MODEL','Choose an available model or inherit Codex default.');
    demand(contractList(role.inputs)&&contractList(role.outputs)&&contractList(role.checks)&&(role.retired===undefined||typeof role.retired==='boolean'),'INVALID_ROLE_CONTRACT','Provide bounded input, output and acceptance descriptions.');
    if(role.multica)demand(isObject(role.multica)&&(!role.multica.agentId||text(role.multica.agentId,160))&&(!role.multica.runtimeId||text(role.multica.runtimeId,160))&&[role.multica.skillIds,role.multica.mcpServerIds].every(ids=>ids===undefined||Array.isArray(ids)&&ids.length<=30&&ids.every(value=>text(value,160))),'INVALID_AGENT_BINDING','Check the connected agent, runtime, skill and MCP identifiers.');
  }
  demand(Array.isArray(project.knowledgeSources)&&project.knowledgeSources.length<=50&&unique(project.knowledgeSources.map(source=>source.id)),'INVALID_SOURCES','Sources must have unique identifiers.');
  for(const source of project.knowledgeSources)demand(id(source.id)&&['document','artifact','memory'].includes(source.kind)&&text(source.path,4096)&&path.isAbsolute(source.path)&&Array.isArray(source.roles)&&source.roles.every(role=>project.roles.some(item=>item.id===role)),'INVALID_SOURCE','Check source path, kind and project roles.');
}
export function validatePipeline(pipeline:Pipeline,project:Project,others:Pipeline[]=[]):void {
  demand(isObject(pipeline)&&id(pipeline.id)&&pipeline.projectId===project.id&&text(pipeline.name,180)&&project.roles.some(role=>role.id===pipeline.roleId),'INVALID_PIPELINE','Check pipeline identity and owner role.');
  demand(Array.isArray(pipeline.stages)&&pipeline.stages.length>0&&pipeline.stages.length<=40&&unique(pipeline.stages.map(stage=>stage.id)),'INVALID_STAGES','Provide one to forty stages with unique identifiers.');
  const stages=new Map(pipeline.stages.map(stage=>[stage.id,stage]));
  for(const stage of pipeline.stages){
    demand(id(stage.id)&&text(stage.name,180)&&project.roles.some(role=>role.id===stage.roleId)&&EXECUTORS.includes(stage.executor)&&typeof stage.prompt==='string'&&stage.prompt.length<=40000&&typeof stage.review==='boolean'&&Array.isArray(stage.dependsOn)&&unique(stage.dependsOn)&&stage.dependsOn.every(dependency=>stages.has(dependency)&&dependency!==stage.id),'INVALID_STAGE','Check stage roles, executors and dependencies.');
    if(stage.executor==='github')demand(!stage.options?.repository||stage.options.repository===project.repository,'PROJECT_SCOPE','GitHub stages must use this project repository.');
    if(stage.executor==='pipeline')demand(text(stage.options?.pipelineId,100)&&stage.options?.pipelineId!==pipeline.id,'INVALID_CHILD_PIPELINE','Choose another pipeline in this project.');
    demand(contractList(stage.inputs)&&contractList(stage.outputs)&&contractList(stage.checks),'INVALID_STAGE_CONTRACT','Provide bounded input, output and acceptance descriptions.');
    if(stage.position)demand(isObject(stage.position)&&Number.isFinite(stage.position.x)&&Number.isFinite(stage.position.y)&&Math.abs(stage.position.x)<100000&&Math.abs(stage.position.y)<100000,'INVALID_STAGE_POSITION','Provide finite stage canvas coordinates.');
    if(stage.condition)demand(isObject(stage.condition)&&text(stage.condition.stageId,100)&&stages.has(stage.condition.stageId)&&stage.condition.stageId!==stage.id&&['done','no_change','revise','blocked'].includes(stage.condition.outcome),'INVALID_STAGE_CONDITION','Choose an upstream stage outcome.');
  }
  const visiting=new Set<string>(),done=new Set<string>();
  function visit(key:string){demand(!visiting.has(key),'PIPELINE_CYCLE','Stage dependencies contain a cycle.');if(done.has(key))return;visiting.add(key);for(const parent of stages.get(key)!.dependsOn)visit(parent);visiting.delete(key);done.add(key);}
  for(const key of stages.keys())visit(key);
  function ancestors(key:string,found=new Set<string>()):Set<string>{for(const parent of stages.get(key)!.dependsOn){found.add(parent);ancestors(parent,found);}return found;}
  for(const stage of stages.values())if(stage.reworkTo)demand(ancestors(stage.id).has(stage.reworkTo),'INVALID_REWORK','Revision work must return to an upstream dependency.');
  for(const stage of stages.values())if(stage.condition)demand(ancestors(stage.id).has(stage.condition.stageId),'INVALID_STAGE_CONDITION','A condition must observe an upstream dependency.');
  const policy=pipeline.policy;
  demand(isObject(policy),'INVALID_POLICY','Provide bounded execution limits.');
  for(const[key,min,max]of [['concurrency',1,4],['maxAttempts',1,5],['maxIterations',1,10],['timeoutSeconds',5,3600],['tokenBudget',100,1000000]] as const)demand(Number.isInteger(policy[key])&&policy[key]>=min&&policy[key]<=max,'INVALID_POLICY',`Check ${key}: ${min}–${max}.`);
  const all=new Map([...others.filter(item=>item.projectId===project.id),pipeline].map(item=>[item.id,item]));
  const stack=new Set<string>(),checked=new Set<string>();
  function childVisit(key:string){demand(!stack.has(key),'PIPELINE_CALL_CYCLE','Linked pipelines contain a cycle.');if(checked.has(key))return;stack.add(key);for(const stage of all.get(key)?.stages??[])if(stage.executor==='pipeline'){const target=stage.options?.pipelineId!;demand(all.has(target),'PIPELINE_NOT_FOUND','A linked pipeline is not in this project.');childVisit(target);}stack.delete(key);checked.add(key);}
  childVisit(pipeline.id);
}
export function validateOutput(output:TaskOutput):void {
  demand(isObject(output)&&['done','revise','blocked','no_change'].includes(output.outcome)&&text(output.summary,40000)&&Array.isArray(output.artifacts)&&output.artifacts.length<=100&&Array.isArray(output.observations)&&output.observations.every(item=>typeof item==='string'),'INVALID_OUTPUT','Provide a result, summary, artifacts and observations.');
  for(const artifact of output.artifacts)demand(isObject(artifact)&&text(artifact.label,300)&&(!artifact.url||/^https?:\/\//.test(artifact.url))&&(!artifact.path||typeof artifact.path==='string'),'INVALID_ARTIFACT','Check artifact labels and links.');
}
