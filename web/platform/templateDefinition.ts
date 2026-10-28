import {DEFAULT_EFFORT} from '../../src/contracts';
import type {Pipeline,Project,RoleProfile} from '../../src/contracts';
import type {PipelineTemplateDefinition,RoleTemplateDefinition,TemplateDefinition} from '../../src/template-types';
import type {TeamData} from './types';

export function roleTemplateDraft(role:RoleProfile,model=true,effort=true):RoleTemplateDefinition{
  return{kind:'role',name:role.name,description:role.description,instructions:role.instructions,inputs:role.inputs,outputs:role.outputs,checks:role.checks,...(model?{model:role.model}:{}),...(effort?{effort:role.effort}:{}),requirements:{sandbox:role.sandbox,tools:role.tools}};
}
export function pipelineTemplateDraft(pipeline:Pipeline,project:Project):PipelineTemplateDefinition{
  const ids=[...new Set([pipeline.roleId,...pipeline.stages.map(stage=>stage.roleId)])];
  return{kind:'pipeline',name:pipeline.name,description:pipeline.description,ownerRoleSlot:pipeline.roleId,roleSlots:ids.map(id=>{const role=project.roles.find(value=>value.id===id);return{id,name:role?.name??id,requirements:role?{sandbox:role.sandbox,tools:role.tools}:undefined}}),stages:pipeline.stages.map(({roleId,options,position,...stage})=>({...stage,roleSlot:roleId,...(stage.executor==='github'?{githubMode:options?.mode??'observe'}:{}),...(stage.executor==='github'||stage.executor==='pipeline'?{bindingSlot:stage.id}:{})})),bindingSlots:pipeline.stages.flatMap(stage=>stage.executor==='github'||stage.executor==='pipeline'?[{id:stage.id,kind:stage.executor}]:[]),policy:pipeline.policy};
}
export function templateEditorObjects(definition:TemplateDefinition){
  const makeRole=(id:string,name:string,requirements?:RoleTemplateDefinition['requirements']):RoleProfile=>({id,name,description:'',instructions:'',model:null,effort:DEFAULT_EFFORT,sandbox:requirements?.sandbox??'read-only',tools:requirements?.tools??[],skills:[]});
  const roles=definition.kind==='role'?[{...makeRole('template-role',definition.name,definition.requirements),...definition,model:definition.model??null,effort:definition.effort??DEFAULT_EFFORT}]:definition.roleSlots.map(slot=>makeRole(slot.id,slot.name,slot.requirements));
  const project:Project={id:'template-editor',revision:1,name:definition.name,description:definition.description,workspace:'/',repository:'',roles,knowledgeSources:[],createdAt:'',updatedAt:''};
  const pipeline:Pipeline|undefined=definition.kind==='pipeline'?{id:'template-pipeline',projectId:project.id,revision:1,name:definition.name,description:definition.description,roleId:definition.ownerRoleSlot,stages:definition.stages.map(({roleSlot,bindingSlot,githubMode,...stage})=>({...stage,roleId:roleSlot,...(stage.executor==='pipeline'?{options:{pipelineId:'template-target'}}:stage.executor==='github'?{options:{mode:githubMode??'observe'}}:{})})),policy:definition.policy,updatedAt:''}:undefined;
  const team:TeamData={roles,agents:[],skills:[],runtimes:[],connection:{connected:false},revision:1};
  return{project,role:roles[0],pipeline,team};
}
