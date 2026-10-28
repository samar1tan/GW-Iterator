import {createHash,randomUUID} from 'node:crypto';
import {CONTROL_TOOLS,DEFAULT_EFFORT,EFFORTS,EXECUTORS} from './contracts.ts';
import type {Actor,Pipeline,Project,RoleProfile,Stage} from './contracts.ts';
import type {Engine} from './engine.ts';
import {defaultPipeline,defaultRoles} from './defaults.ts';
import {AppError,demand,isObject,text,validatePipeline,validateProject} from './validation.ts';
import type {ApplyTemplateInput,CreateTemplateInput,PipelineTemplateDefinition,PreviewTemplateInput,ProjectTemplateBinding,RetireTemplateInput,ReviseTemplateInput,RoleTemplateDefinition,TemplateChange,TemplateChangePreview,TemplateChangeReceipt,TemplateDefinition,TemplateHead,TemplateKind,TemplateMappings,TemplateRef,TemplateRequirements,TemplateRevision,TemplateRoleWriter} from './template-types.ts';

const at=()=>new Date().toISOString();
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>isObject(item)?Object.fromEntries(Object.keys(item).sort().filter(key=>item[key]!==undefined).map(key=>[key,item[key]])):item);
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const owner=(actor:Actor)=>demand(!actor.projectId&&actor.kind==='human','OWNER_REQUIRED','Reusable template changes require the local owner.',403);
const clone=<T>(value:T):T=>structuredClone(value);
const recordId=(id:string,revision:number)=>`${id}@${revision}`;
const ref=(value:TemplateRevision):TemplateRef=>({id:value.templateId,revision:value.revision,hash:value.hash});
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
const contractList=(value:unknown)=>value===undefined||Array.isArray(value)&&value.length<=40&&value.every(item=>text(item,2000));

function requirements(value:unknown):void{
  demand(value===undefined||isObject(value)&&keys(value,['sandbox','tools'])&&(value.sandbox===undefined||['read-only','workspace-write'].includes(String(value.sandbox)))&&(value.tools===undefined||Array.isArray(value.tools)&&value.tools.every(tool=>CONTROL_TOOLS.includes(tool))),'INVALID_TEMPLATE_REQUIREMENTS','Declare supported capability requirements without native bindings.');
}

export function portableRole(role:RoleProfile):RoleTemplateDefinition{
  return{kind:'role',name:role.name,description:role.description,instructions:role.instructions,...(role.inputs?{inputs:clone(role.inputs)}:{}),...(role.outputs?{outputs:clone(role.outputs)}:{}),...(role.checks?{checks:clone(role.checks)}:{}),model:role.model,effort:role.effort,requirements:{sandbox:role.sandbox,tools:clone(role.tools)}};
}

export function portablePipeline(pipeline:Pipeline,project:Project):PipelineTemplateDefinition{
  const ids=[...new Set([pipeline.roleId,...pipeline.stages.map(stage=>stage.roleId)])];
  return{kind:'pipeline',name:pipeline.name,description:pipeline.description,ownerRoleSlot:pipeline.roleId,roleSlots:ids.map(id=>{const role=project.roles.find(item=>item.id===id);return{id,name:role?.name??id,requirements:role?{sandbox:role.sandbox,tools:clone(role.tools)}:undefined}}),stages:pipeline.stages.map(({roleId,options,position,...stage})=>({...clone(stage),roleSlot:roleId,...(stage.executor==='github'?{githubMode:options?.mode??'observe'}:{}),...(['pipeline','github'].includes(stage.executor)?{bindingSlot:stage.id}:{})})),bindingSlots:pipeline.stages.flatMap(stage=>stage.executor==='pipeline'||stage.executor==='github'?[{id:stage.id,kind:stage.executor}]:[]),policy:{}};
}

export function validateTemplateDefinition(value:unknown):asserts value is TemplateDefinition{
  demand(isObject(value)&&['role','pipeline'].includes(String(value.kind))&&text(value.name,160)&&typeof value.description==='string'&&value.description.length<=10000,'INVALID_TEMPLATE','Provide a named portable role or workflow.');
  if(value.kind==='role'){
    demand(keys(value,['kind','name','description','instructions','inputs','outputs','checks','model','effort','requirements'])&&typeof value.instructions==='string'&&value.instructions.length<=40000&&[value.inputs,value.outputs,value.checks].every(contractList)&&(value.model===undefined||value.model===null||text(value.model,160))&&(value.effort===undefined||EFFORTS.includes(value.effort as never)),'INVALID_TEMPLATE','Use portable role content and optional model defaults only.');requirements(value.requirements);return;
  }
  demand(keys(value,['kind','name','description','ownerRoleSlot','roleSlots','stages','bindingSlots','policy'])&&Array.isArray(value.roleSlots)&&value.roleSlots.length>0&&value.roleSlots.length<=32&&Array.isArray(value.stages)&&value.stages.length>0&&value.stages.length<=40&&Array.isArray(value.bindingSlots)&&isObject(value.policy),'INVALID_TEMPLATE','Provide bounded workflow slots, stages and policy.');
  const roles=value.roleSlots as Record<string,unknown>[],stages=value.stages as Record<string,unknown>[],slots=value.bindingSlots as Record<string,unknown>[];
  demand(roles.every(role=>isObject(role)&&keys(role,['id','name','requirements'])&&identifier(role.id)&&text(role.name,160))&&new Set(roles.map(role=>role.id)).size===roles.length&&roles.some(role=>role.id===value.ownerRoleSlot),'INVALID_TEMPLATE','Workflow roles need stable logical slots.');roles.forEach(role=>requirements(role.requirements));
  demand(slots.every(slot=>isObject(slot)&&keys(slot,['id','kind'])&&identifier(slot.id)&&['pipeline','github'].includes(String(slot.kind)))&&new Set(slots.map(slot=>slot.id)).size===slots.length,'INVALID_TEMPLATE','External actions need logical target slots.');
  demand(stages.every(stage=>isObject(stage)&&keys(stage,['id','name','executor','dependsOn','prompt','review','executionPurpose','ownerGate','reworkTo','inputs','outputs','checks','condition','roleSlot','bindingSlot','githubMode'])&&roles.some(role=>role.id===stage.roleSlot)&&EXECUTORS.includes(stage.executor as never)&&(stage.githubMode===undefined||stage.executor==='github'&&['observe','dispatch'].includes(String(stage.githubMode)))&&(!['pipeline','github'].includes(String(stage.executor))||slots.some(slot=>slot.id===stage.bindingSlot&&slot.kind===stage.executor))),'INVALID_TEMPLATE','Use logical roles and external targets instead of project bindings.');
  const project:Project={id:'template-validation',name:'Template validation',description:'',workspace:'/',repository:'',roles:roles.map(role=>({id:String(role.id),name:String(role.name),description:'',instructions:'',model:null,effort:DEFAULT_EFFORT,sandbox:'read-only',skills:[],tools:[]})),knowledgeSources:[],revision:1,createdAt:at(),updatedAt:at()};
  const children:Pipeline[]=slots.filter(slot=>slot.kind==='pipeline').map(slot=>({id:'child-'+String(slot.id).slice(0,80),projectId:project.id,revision:1,name:'Validation target',description:'',roleId:project.roles[0].id,stages:[{id:'work',name:'Work',roleId:project.roles[0].id,executor:'manual',dependsOn:[],prompt:'',review:false}],policy:value.policy as Pipeline['policy'],updatedAt:at()}));
  const pipeline:Pipeline={id:'template-validation',projectId:project.id,revision:1,name:String(value.name),description:String(value.description),roleId:String(value.ownerRoleSlot),stages:stages.map(({roleSlot,bindingSlot,githubMode,...stage})=>({...stage,roleId:String(roleSlot),...(stage.executor==='pipeline'?{options:{pipelineId:'child-'+String(bindingSlot).slice(0,80)}}:{})}) as Stage),policy:value.policy as Pipeline['policy'],updatedAt:at()};
  validatePipeline(pipeline,project,children);
}

function content(definition:TemplateDefinition):Record<string,unknown>{
  if(definition.kind==='role'){const{kind,requirements,...value}=definition;return clone(value);}
  const{kind,roleSlots,bindingSlots,policy,...value}=definition;return clone(value);
}

function owned(path:string,paths:string[]):boolean{return paths.some(value=>path===value||path.startsWith(value+'/'));}

/** Merge executable fields; arrays are atomic except stable-ID workflow stages. */
export function mergeTemplateContent(base:unknown,project:unknown,upstream:unknown,projectOwnedPaths:string[]=[],resolutions:Record<string,'project'|'template'>={}){
  const changes:TemplateChange[]=[];
  const merge=(old:unknown,local:unknown,next:unknown,path:string):unknown=>{
    if((path==='/model'||path==='/effort')&&next===undefined)return local;
    if(same(local,next))return clone(local);
    if(path==='/stages'&&[old,local,next].every(value=>value===undefined||Array.isArray(value))){
      const map=(value:unknown)=>new Map((value as {id:string}[]??[]).map(item=>[item.id,item]));const a=map(old),b=map(local),c=map(next),ids=[...new Set([...c.keys(),...b.keys(),...a.keys()])];
      return ids.map(id=>merge(a.get(id),b.get(id),c.get(id),path+'/'+id)).filter(value=>value!==undefined);
    }
    if(isObject(old)&&isObject(local)&&isObject(next)||old===undefined&&isObject(local)&&isObject(next)){
      const a=isObject(old)?old:{},b=local as Record<string,unknown>,c=next as Record<string,unknown>;
      return Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b),...Object.keys(c)])].map(key=>[key,merge(a[key],b[key],c[key],path+'/'+key)]).filter(([,value])=>value!==undefined));
    }
    const localChanged=!same(old,local),upstreamChanged=!same(old,next),conflict=localChanged&&upstreamChanged&&!(owned(path,projectOwnedPaths)&&(path==='/model'||path==='/effort'));
    let resolution:TemplateChange['resolution']=resolutions[path]??(conflict?'unresolved':owned(path,projectOwnedPaths)||localChanged?'project':'template');
    if(!upstreamChanged)resolution='project';
    changes.push({path,kind:next===undefined?'remove':old===undefined?'add':'change',base:clone(old),project:clone(local),template:clone(next),resolution,conflict});
    return clone(resolution==='template'?next:local);
  };
  return{value:merge(base,project,upstream,'') as Record<string,unknown>,changes};
}

function changedPaths(before:unknown,after:unknown,path=''):string[]{
  if(same(before,after))return[];
  if(path==='/stages'&&Array.isArray(before)&&Array.isArray(after)){const a=new Map(before.map(item=>[item.id,item])),b=new Map(after.map(item=>[item.id,item]));return[...new Set([...a.keys(),...b.keys()])].flatMap(id=>changedPaths(a.get(id),b.get(id),path+'/'+id));}
  if(isObject(before)&&isObject(after))return[...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>changedPaths(before[key],after[key],path+'/'+key));
  return[path];
}

export class TemplateService{
  readonly engine:Engine;private options:{saveRole?:TemplateRoleWriter};
  constructor(engine:Engine,options:{saveRole?:TemplateRoleWriter}={}){
    this.engine=engine;this.options=options;
    const prior=engine.definitionChanged;
    engine.definitionChanged=(projectId,kind,previous,next,managed)=>{prior?.(projectId,kind,previous,next,managed);if(!previous||managed||!next.templateBindingId)return;const binding=engine.store.get<ProjectTemplateBinding>('template-binding',next.templateBindingId);if(!binding||binding.projectId!==projectId||binding.target.id!==next.id)return;const project=engine.project(projectId),a=this.localContent(kind,previous,project,binding.mappings,binding.baseline),b=this.localContent(kind,next,project,binding.mappings,binding.baseline),paths=changedPaths(a,b),external=kind==='pipeline'?this.currentExternal(next as Pipeline,binding.baseline,binding.mappings.external):binding.mappings.external;if(paths.length||!same(external,binding.mappings.external))engine.store.put('template-binding',{...binding,revision:binding.revision+1,mappings:{...binding.mappings,external},projectOwnedPaths:[...new Set([...binding.projectOwnedPaths,...paths])]});};
    this.seedBuiltins();
  }
  private seedBuiltins(){
    const project:Project={id:'builtin-project',revision:1,name:'Built-in',description:'',workspace:'/',repository:'',roles:defaultRoles(),knowledgeSources:[],createdAt:at(),updatedAt:at()};
    const values:TemplateDefinition[]=[...project.roles.map(portableRole),...(['focused','product','operations','knowledge'] as const).map(key=>portablePipeline(defaultPipeline(project,key==='focused'?'development':key==='operations'?'operations':'lead',key),project))];
    const ids=[...project.roles.map(role=>'builtin-role-'+role.id),'builtin-pipeline-focused','builtin-pipeline-product','builtin-pipeline-operations','builtin-pipeline-knowledge'];
    this.engine.store.transaction(()=>values.forEach((definition,index)=>{if(this.engine.store.get('template-head',ids[index]))return;const createdAt=at(),document:TemplateRevision={id:recordId(ids[index],1),templateId:ids[index],revision:1,hash:hash(definition),kind:definition.kind,definition,purpose:definition.description,changeSummary:'Built-in starting contract.',origin:{kind:'builtin',key:ids[index],revision:1},createdAt};this.engine.store.put('template-revision',document);this.engine.store.put<TemplateHead>('template-head',{id:ids[index],kind:definition.kind,name:definition.name,purpose:definition.description,latestRevision:1,recordRevision:1,status:'active',updatedAt:createdAt});}));
  }
  private scope(projectId:string,actor:Actor){demand(!actor.projectId||actor.projectId===projectId,'PROJECT_SCOPE','Use the current project.',403);this.engine.project(projectId);}
  list(actor:Actor):TemplateHead[]{const allowed=actor.projectId?new Set(this.bindings(actor.projectId,actor).map(item=>item.template.id)):undefined;return this.engine.store.list<TemplateHead>('template-head').filter(item=>!allowed||allowed.has(item.id));}
  bindings(projectId:string,actor:Actor):ProjectTemplateBinding[]{this.scope(projectId,actor);return this.engine.store.list<ProjectTemplateBinding>('template-binding').filter(item=>item.projectId===projectId);}
  revision(id:string,revision:number,actor:Actor):TemplateRevision{
    if(actor.projectId)demand(this.bindings(actor.projectId,actor).some(item=>item.template.id===id),'PROJECT_SCOPE','This template is not bound to the project.',403);
    const value=this.engine.store.get<TemplateRevision>('template-revision',recordId(id,revision));demand(value,'TEMPLATE_NOT_FOUND','Template revision not found.',404);
    return actor.projectId?{...value,origin:{kind:'template',template:ref(value)}}:value;
  }
  private request<T>(kind:string,key:string,input:unknown,operation:()=>T):T{
    demand(text(key,160),'IDEMPOTENCY_REQUIRED','Keep one identity for this template change.');const id=hash([kind,key]),requestHash=hash(input),prior=this.engine.store.get<{id:string;requestHash:string;result:T}>('template-request',id);if(prior){demand(prior.requestHash===requestHash,'IDEMPOTENCY_CONFLICT','This key identifies a different template change.',409);return prior.result;}
    return this.engine.store.transaction(()=>{const result=operation();this.engine.store.put('template-request',{id,requestHash,result});return result;});
  }
  create(input:CreateTemplateInput,actor:Actor):{template:TemplateHead;revision:TemplateRevision}{
    owner(actor);demand(isObject(input)&&isObject(input.source),'INVALID_TEMPLATE','Choose an exact project definition.');
    return this.request('create',input.idempotencyKey,input,()=>{
      const source=input.source,project=this.engine.project(source.projectId);demand(project.revision===source.expectedProjectRevision,'REVISION_CONFLICT','The source project changed.',409);
      const object=source.kind==='role'?project.roles.find(role=>role.id===source.id):this.engine.pipeline(source.id);demand(object,'TEMPLATE_SOURCE_MISSING','Choose an existing role or workflow.',404);if(source.kind==='pipeline')demand((object as Pipeline).projectId===project.id&&(object as Pipeline).revision===source.expectedPipelineRevision,'REVISION_CONFLICT','The source workflow changed.',409);
      const definition=clone(input.definition??(source.kind==='role'?portableRole(object as RoleProfile):portablePipeline(object as Pipeline,project)));validateTemplateDefinition(definition);demand(definition.kind===source.kind,'INVALID_TEMPLATE','Keep the source definition kind.');
      return this.publish(randomUUID(),definition,{purpose:input.purpose??definition.description,useWhen:input.useWhen,avoidWhen:input.avoidWhen,changeSummary:input.changeSummary??('Saved from '+object.name+'.')}, {kind:'copy',projectId:project.id,objectId:source.id,revision:source.kind==='role'?project.revision:(object as Pipeline).revision});
    });
  }
  revise(id:string,input:ReviseTemplateInput,actor:Actor):{template:TemplateHead;revision:TemplateRevision}{
    owner(actor);return this.request('revise:'+id,input.idempotencyKey,input,()=>{const head=this.head(id);demand(head.recordRevision===input.expectedRecordRevision,'REVISION_CONFLICT','The template changed.',409);demand(head.status==='active','TEMPLATE_RETIRED','Restore the template before publishing another revision.',409);validateTemplateDefinition(input.definition);demand(input.definition.kind===head.kind,'INVALID_TEMPLATE','Keep the template kind.');demand(text(input.changeSummary,4000),'CHANGE_SUMMARY_REQUIRED','Describe the useful change.');return this.publish(id,clone(input.definition),{purpose:input.purpose??head.purpose,useWhen:input.useWhen,avoidWhen:input.avoidWhen,changeSummary:input.changeSummary},{kind:'template',template:ref(this.revision(id,head.latestRevision,actor))},head);});
  }
  retire(id:string,input:RetireTemplateInput,actor:Actor):TemplateHead{owner(actor);const head=this.head(id);demand(head.recordRevision===input.expectedRecordRevision&&typeof input.retired==='boolean','REVISION_CONFLICT','Refresh the template before changing its availability.',409);const next={...head,status:input.retired?'retired' as const:'active' as const,recordRevision:head.recordRevision+1,updatedAt:at()};this.engine.store.put('template-head',next);return next;}
  private head(id:string){const value=this.engine.store.get<TemplateHead>('template-head',id);demand(value,'TEMPLATE_NOT_FOUND','Template not found.',404);return value;}
  private publish(id:string,definition:TemplateDefinition,copy:{purpose:string;useWhen?:string;avoidWhen?:string;changeSummary:string},origin:TemplateRevision['origin'],head?:TemplateHead){
    demand(typeof copy.purpose==='string'&&copy.purpose.length<=10000&&[copy.useWhen,copy.avoidWhen].every(value=>value===undefined||typeof value==='string'&&value.length<=4000),'INVALID_TEMPLATE','Keep template guidance concise.');const createdAt=at(),revision:TemplateRevision={id:recordId(id,(head?.latestRevision??0)+1),templateId:id,revision:(head?.latestRevision??0)+1,hash:hash(definition),kind:definition.kind,definition,...copy,origin,createdAt},template:TemplateHead={id,kind:definition.kind,name:definition.name,purpose:copy.purpose,useWhen:copy.useWhen,avoidWhen:copy.avoidWhen,latestRevision:revision.revision,recordRevision:(head?.recordRevision??0)+1,status:'active',updatedAt:createdAt};const savedRevision=JSON.parse(canonical(revision)) as TemplateRevision,savedTemplate=JSON.parse(canonical(template)) as TemplateHead;this.engine.store.put('template-revision',savedRevision);this.engine.store.put('template-head',savedTemplate);return{template:savedTemplate,revision:savedRevision};
  }
  private currentExternal(pipeline:Pipeline,baseline:TemplateDefinition,previous:TemplateMappings['external']):TemplateMappings['external']{
    if(baseline.kind!=='pipeline')return clone(previous);const values=new Map<string,NonNullable<Stage['options']>[]>();
    for(const stage of pipeline.stages){const slot=baseline.stages.find(item=>item.id===stage.id)?.bindingSlot;if(slot&&stage.options)values.set(slot,[...(values.get(slot)??[]),clone(stage.options)]);}
    const next={...clone(previous)};for(const[slot,options]of values)if(options.every(value=>same(value,options[0])))next[slot]=options[0];return next;
  }
  private localContent(kind:TemplateKind,object:RoleProfile|Pipeline,project:Project,mappings:TemplateMappings,baseline?:TemplateDefinition){
    if(kind==='role')return content(portableRole(object as RoleProfile));
    const pipeline=object as Pipeline,value=portablePipeline(pipeline,project),base=baseline?.kind==='pipeline'?baseline:undefined;const slotFor=(roleId:string,original?:string)=>{if(original&&mappings.roles[original]===roleId)return original;const matches=Object.entries(mappings.roles).filter(([,id])=>id===roleId);return matches.length===1?matches[0][0]:roleId;};value.ownerRoleSlot=slotFor(pipeline.roleId,base?.ownerRoleSlot);value.stages=value.stages.map((stage,index)=>{const original=base?.stages.find(item=>item.id===stage.id);return{...stage,roleSlot:slotFor(pipeline.stages[index].roleId,original?.roleSlot),...(original?.bindingSlot&&original.executor===stage.executor?{bindingSlot:original.bindingSlot}:{})};});return content(value);
  }
  preview(projectId:string,input:PreviewTemplateInput,actor:Actor):TemplateChangePreview{
    this.scope(projectId,actor);demand(isObject(input)&&isObject(input.template),'INVALID_TEMPLATE','Choose an exact template revision.');const project=this.engine.project(projectId);demand(project.revision===input.expectedProjectRevision,'REVISION_CONFLICT','The project changed. Refresh before preparing the update.',409);
    const revision=this.revision(input.template.id,input.template.revision,actor),head=this.head(revision.templateId);demand(head.status==='active','TEMPLATE_RETIRED','Retired templates cannot be installed or used for an update.',409);
    const target=input.target??{kind:revision.kind,id:randomUUID()};demand(target.kind===revision.kind&&identifier(target.id),'INVALID_TEMPLATE_TARGET','Choose a compatible project target.');
    const existing=target.kind==='role'?project.roles.find(role=>role.id===target.id):this.engine.store.get<Pipeline>('pipeline',target.id);if(existing&&target.kind==='pipeline')demand((existing as Pipeline).projectId===projectId,'PROJECT_SCOPE','Choose a workflow in this project.',403);
    if(existing&&target.kind==='pipeline')demand((existing as Pipeline).revision===input.expectedPipelineRevision,'REVISION_CONFLICT','The workflow changed.',409);
    const previous=existing?.templateBindingId?this.engine.store.get<ProjectTemplateBinding>('template-binding',existing.templateBindingId):null;
    if(actor.projectId)demand(actor.tools?.includes('pipeline.propose')&&previous?.projectId===projectId&&previous.template.id===revision.templateId,'TOOL_NOT_ALLOWED','This role can only propose changes to its bound project definition.',403);
    const bound=previous?.template.id===revision.templateId?previous:null,mappings:TemplateMappings={roles:{...(bound?.mappings.roles??{}),...(input.mappings?.roles??{})},external:{...(bound?.mappings.external??{})}};
    const definition=revision.definition;
    if(definition.kind==='pipeline'){
      for(const slot of definition.roleSlots)if(!mappings.roles[slot.id]&&project.roles.some(role=>role.id===slot.id&&!role.retired))mappings.roles[slot.id]=slot.id;
      if(existing&&bound)mappings.external=this.currentExternal(existing as Pipeline,bound.baseline,mappings.external);else if(existing)for(const stage of (existing as Pipeline).stages)if(stage.options&&definition.bindingSlots.some(slot=>slot.id===stage.id))mappings.external[stage.id]=clone(stage.options);mappings.external={...mappings.external,...input.mappings?.external};
    }
    const local=existing?this.localContent(target.kind,existing,project,bound?.mappings??mappings,bound?.baseline):undefined,baseline=bound?content(bound.baseline):local;
    const released=input.releaseOwnedPaths??[];demand(Array.isArray(released)&&released.every(path=>typeof path==='string')&&isObject(input.resolutions??{})&&Object.values(input.resolutions??{}).every(value=>value==='project'||value==='template'),'INVALID_TEMPLATE_RESOLUTION','Choose a listed project or template value.');
    const availableOwnedPaths=[...new Set([...(bound?.projectOwnedPaths??[]),...(!bound&&existing&&target.kind==='role'?['/model','/effort']:[]),...(bound&&local?changedPaths(baseline,local):[])])],projectOwnedPaths=availableOwnedPaths.filter(path=>!released.includes(path));
    const merged=mergeTemplateContent(baseline,local,content(definition),projectOwnedPaths,{...input.resolutions,...Object.fromEntries(released.map(path=>[path,'template' as const]))}),checks:TemplateChangePreview['checks']=[];
    demand(Object.keys(input.resolutions??{}).every(path=>merged.changes.some(change=>change.path===path&&change.conflict)),'INVALID_TEMPLATE_RESOLUTION','Resolve only the listed conflicts.');demand(released.every(path=>availableOwnedPaths.includes(path)),'INVALID_TEMPLATE_RESOLUTION','Release only an explicitly project-owned field.');
    const requireRole=(role:RoleProfile|undefined,needs:TemplateRequirements|undefined,slot?:string)=>{if(!role||role.retired){checks.push({code:'ROLE_MAPPING_REQUIRED',status:'blocked',slot});return;}if(needs?.sandbox==='workspace-write'&&role.sandbox!=='workspace-write'||needs?.tools?.some(tool=>!role.tools.includes(tool)))checks.push({code:'CAPABILITY_REQUIREMENT',status:'blocked',slot});};
    let candidate:RoleProfile|Pipeline;
    if(definition.kind==='role'){
      const current=existing as RoleProfile|undefined;candidate={id:target.id,name:definition.name,description:definition.description,instructions:definition.instructions,model:null,effort:DEFAULT_EFFORT,sandbox:'read-only',skills:[],tools:['context.read','knowledge.search','pipeline.read','run.read'],...clone(current),...merged.value};requireRole(candidate,definition.requirements);
    }else{
      for(const slot of definition.roleSlots)requireRole(project.roles.find(role=>role.id===mappings.roles[slot.id]),slot.requirements,slot.id);

      const value=merged.value as unknown as Omit<PipelineTemplateDefinition,'kind'|'roleSlots'|'bindingSlots'>;
      candidate={id:target.id,projectId,revision:existing?(existing as Pipeline).revision:1,name:value.name,description:value.description,roleId:mappings.roles[value.ownerRoleSlot]??value.ownerRoleSlot,policy:existing?clone((existing as Pipeline).policy):{},updatedAt:at(),stages:value.stages.map(({roleSlot,bindingSlot,githubMode,...stage})=>({...stage,roleId:mappings.roles[roleSlot]??roleSlot,...(bindingSlot?{options:{...clone(existing&&bound&&bound.baseline.kind==='pipeline'&&bound.baseline.stages.find(item=>item.id===stage.id)?.bindingSlot===bindingSlot&&!Object.hasOwn(input.mappings?.external??{},bindingSlot)?(existing as Pipeline).stages.find(item=>item.id===stage.id)?.options:mappings.external[bindingSlot]),...(stage.executor==='github'?{mode:githubMode??'observe'}:{})}}:{}),...((existing as Pipeline|undefined)?.stages.find(item=>item.id===stage.id)?.position?{position:clone((existing as Pipeline).stages.find(item=>item.id===stage.id)!.position)}:{})}))};
    }
    if(target.kind==='pipeline'){const pipeline=candidate as Pipeline;for(const id of new Set([pipeline.roleId,...pipeline.stages.map(stage=>stage.roleId)]))requireRole(project.roles.find(role=>role.id===id),undefined);for(const stage of pipeline.stages){const value=stage.options;if(stage.executor==='pipeline'&&!this.engine.store.list<Pipeline>('pipeline').some(item=>item.projectId===projectId&&item.id===value?.pipelineId)||stage.executor==='github'&&(!value||value.repository!==project.repository||(value.mode==='dispatch'?!text(value.workflow,500)||!text(value.ref,500):!Number.isSafeInteger(value.runId)||(value.runId??0)<=0)))checks.push({code:'TARGET_MAPPING_REQUIRED',status:'blocked',slot:stage.id});const old=(existing as Pipeline|undefined)?.stages.find(item=>item.id===stage.id);if(old&&['pipeline','github'].includes(stage.executor)&&!same(old.options,stage.options))merged.changes.push({path:'/stages/'+stage.id+'/target',kind:'change',project:clone(old.options),template:clone(stage.options),resolution:'template',conflict:false});}if(bound)for(const[slot,id]of Object.entries(mappings.roles))if(bound.mappings.roles[slot]!==id)merged.changes.push({path:'/bindings/roles/'+slot,kind:'change',project:bound.mappings.roles[slot],template:id,resolution:'template',conflict:false});}
    try{if(target.kind==='role')validateProject({...project,roles:existing?project.roles.map(role=>role.id===target.id?candidate as RoleProfile:role):[...project.roles,candidate as RoleProfile]});else validatePipeline(candidate as Pipeline,project,this.engine.store.list('pipeline'));}catch(error){checks.push({code:error instanceof AppError?error.code:'INVALID_TEMPLATE_RESULT',status:'blocked'});}
    const unresolved=merged.changes.some(change=>change.conflict&&change.resolution==='unresolved'),binding:ProjectTemplateBinding={id:bound?.id??randomUUID(),revision:(bound?.revision??0)+1,projectId,target,template:ref(revision),baseline:clone(definition),mappings,projectOwnedPaths:[...new Set([...projectOwnedPaths,...merged.changes.filter(change=>change.resolution==='project').map(change=>change.path)])],appliedAt:at()};
    const preview:TemplateChangePreview={id:randomUUID(),projectId,key:'',state:checks.some(check=>check.status==='blocked')?'blocked':unresolved?'conflicts':'ready',target,template:ref(revision),expectedProjectRevision:project.revision,...(existing&&target.kind==='pipeline'?{expectedPipelineRevision:(existing as Pipeline).revision}:{}),...(bound?{expectedBindingRevision:bound.revision}:{}),candidate,binding,changes:merged.changes,checks,input:clone(input),createdAt:at()};preview.key=hash({...preview,id:undefined,key:undefined,createdAt:undefined});this.engine.store.put('template-preview',preview);return preview;
  }
  async apply(projectId:string,previewId:string,input:ApplyTemplateInput,actor:Actor):Promise<TemplateChangeReceipt>{
    owner(actor);this.scope(projectId,actor);demand(text(input.idempotencyKey,160)&&text(input.previewKey,100),'IDEMPOTENCY_REQUIRED','Keep the reviewed update identity.');
    const requestId=hash(['apply',projectId,input.idempotencyKey]),prior=this.engine.store.get<{id:string;previewId:string;key:string;receipt:TemplateChangeReceipt}>('template-apply',requestId);if(prior){demand(prior.previewId===previewId&&prior.key===input.previewKey,'IDEMPOTENCY_CONFLICT','This key identifies another update.',409);return prior.receipt;}
    const already=this.engine.store.get<{id:string;receipt:TemplateChangeReceipt}>('template-preview-receipt',previewId);if(already){demand(already.receipt.projectId===projectId,'PROJECT_SCOPE','Choose the current project.',403);return already.receipt;}
    const preview=this.engine.store.get<TemplateChangePreview>('template-preview',previewId);demand(preview&&preview.projectId===projectId,'TEMPLATE_PREVIEW_NOT_FOUND','Review this project update first.',404);demand(preview.key===input.previewKey&&preview.state==='ready','TEMPLATE_PREVIEW_BLOCKED','Resolve the listed changes before applying.',409);
    const project=this.engine.project(projectId),extra=()=>{demand(this.head(preview.template.id).status==='active','TEMPLATE_RETIRED','The selected template was retired.',409);demand(this.revision(preview.template.id,preview.template.revision,actor).hash===preview.template.hash,'TEMPLATE_PREVIEW_STALE','Template content changed.',409);const binding=this.engine.store.get<ProjectTemplateBinding>('template-binding',preview.binding.id);demand((binding?.revision??undefined)===preview.expectedBindingRevision,'TEMPLATE_PREVIEW_STALE','The project binding changed.',409);};
    demand(project.revision===preview.expectedProjectRevision,'TEMPLATE_PREVIEW_STALE','The project changed. Regenerate the preview.',409);extra();
    let receipt:TemplateChangeReceipt|undefined;
    const commit=(saved:Project,pipeline?:Pipeline)=>{extra();const binding={...preview.binding,appliedAt:at()},value:TemplateChangeReceipt={id:randomUUID(),projectId,previewId,target:preview.target,template:preview.template,binding,project:saved,...(pipeline?{pipeline}:{}),appliedAt:at()};this.engine.store.put('template-binding',binding);this.engine.store.put('template-preview-receipt',{id:previewId,receipt:value});this.engine.store.put('template-apply',{id:requestId,previewId,key:input.previewKey,receipt:value});this.engine.store.event({projectId,runId:null,stageId:null,type:'template.applied',actor:actor.name,message:'Reviewed template revision applied to future work.',data:{previewId,target:preview.target,template:preview.template}});receipt=value;};
    try{
      if(preview.target.kind==='role'){
        const role=clone(preview.candidate as RoleProfile),existing=project.roles.some(value=>value.id===role.id),mutation={origin:existing?undefined:{kind:'template' as const,template:preview.template},bindingId:preview.binding.id,managed:true};
        if(this.options.saveRole)await this.options.saveRole(projectId,project.revision,role,actor,existing?role.id:undefined,saved=>commit(saved),mutation);
        else await this.engine.updateProject(projectId,project.revision,{...project,roles:existing?project.roles.map(value=>value.id===role.id?role:value):[...project.roles,role]},actor,saved=>commit(saved),{roleOrigins:mutation.origin?{[role.id]:mutation.origin}:undefined,roleBindingIds:{[role.id]:preview.binding.id},managed:true});
      }else this.engine.store.transaction(()=>{
        demand(this.engine.project(projectId).revision===preview.expectedProjectRevision,'TEMPLATE_PREVIEW_STALE','The project changed.',409);extra();const pipeline=clone(preview.candidate as Pipeline),existing=this.engine.store.get<Pipeline>('pipeline',pipeline.id),mutation={origin:existing?undefined:{kind:'template' as const,template:preview.template},bindingId:preview.binding.id,managed:true};
        if(existing){demand(existing.revision===preview.expectedPipelineRevision,'TEMPLATE_PREVIEW_STALE','The workflow changed.',409);this.engine.updatePipeline(existing.id,existing.revision,pipeline,actor,saved=>commit(this.engine.project(projectId),saved),mutation);}else this.engine.createPipeline({projectId,roleId:pipeline.roleId},actor,saved=>commit(this.engine.project(projectId),saved),mutation,pipeline);
      });
    }catch(error){const saved=this.engine.store.get<{id:string;receipt:TemplateChangeReceipt}>('template-preview-receipt',previewId);if(saved)return saved.receipt;throw error;}
    demand(receipt,'TEMPLATE_APPLY_FAILED','No update receipt was recorded.');return receipt;
  }
}
