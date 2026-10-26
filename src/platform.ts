import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import type {Actor,Project,RoleProfile} from './contracts.ts';
import {Engine} from './engine.ts';
import {createMulticaClient,type MulticaConnection,type MulticaClient,type MulticaAgent,type MulticaAgentInput,type MulticaSkillInput,type MulticaProject,type MulticaRuntime} from './adapters/multica.ts';
import {AppError,demand,isObject,validateProject} from './validation.ts';
import {Workspaces} from './workspaces.ts';

type Binding={id:string;projectId:string;providerProjectId:string};
export type DaemonIdentity={healthUrl:string;pid:number;profile:string;daemonId:string;cliCommit:string;startedAt:string};
type Profile={runtimeId?:string;daemonId?:string;defaultModel?:string;permissionProfiles?:string[];permissions?:{readOnly?:{name:string;verified?:boolean};workspaceWrite?:{name:string;verified?:boolean}};verified?:boolean;permissionEvidence?:string;authorizedRootsFile?:string;daemon?:DaemonIdentity;[key:string]:unknown};
/** Native configuration may contain credentials; keep it write-only to the UI. */
export function presentAgent(agent:MulticaAgent){const {mcp_config,runtime_config,custom_args,...visible}=agent;return{...visible,description:visible.description?.replace(/^\[GWI [^\n]+\]\n?/,''),mcpConfigured:!!mcp_config,runtimeConfigured:!!runtime_config,permissionManaged:true};}
export class Platform {
  readonly client:MulticaClient; readonly workspaces:Workspaces;
  private pending=new Map<string,Promise<unknown>>();
  readonly engine:Engine; readonly dataDirectory:string; private defaultModel?:string; private profile:Profile;private scope:string;
  constructor(engine:Engine,connection:MulticaConnection,dataDirectory:string,defaultModel?:string,profile:Profile={},client?:MulticaClient){
    this.engine=engine;this.dataDirectory=dataDirectory;this.defaultModel=defaultModel??profile.defaultModel??(typeof profile.model==='string'?profile.model:undefined);this.profile=profile;
    this.scope=createHash('sha256').update(connection.baseUrl+'\n'+connection.workspaceId).digest('hex').slice(0,16);
    this.client=client??createMulticaClient(connection);this.workspaces=new Workspaces(engine.store,path.join(dataDirectory,'executions'));
  }
  private owner(actor:Actor,projectId:string):Project{const project=this.engine.detail(projectId,actor).project;demand(!actor.projectId,'OWNER_REQUIRED','Team and capability changes require the project owner.',403);return project;}
  private async one<T>(key:string,action:()=>Promise<T>):Promise<T>{const pending=this.pending.get(key);if(pending)return pending as Promise<T>;const result=action().finally(()=>this.pending.delete(key));this.pending.set(key,result);return result;}
  async connection(){const info=await this.client.info();return{...info,connected:info.available&&info.authenticated};}
  executionIdentity(){return this.profile.daemon?{...this.profile.daemon}:undefined;}
  async confirmDaemonIdle(identity:DaemonIdentity|undefined){
    if(!identity||JSON.stringify(identity)!==JSON.stringify(this.profile.daemon))return false;
    try{
      const url=new URL(identity.healthUrl);if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname))return false;
      process.kill(identity.pid,0);const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)return false;
      const value:unknown=await response.json();return isObject(value)&&value.status==='running'&&value.pid===identity.pid&&value.profile===identity.profile&&value.daemon_id===identity.daemonId&&value.cli_commit===identity.cliCommit&&value.active_task_count===0&&value.pending_terminal_report_count===0;
    }catch{return false;}
  }
  private key(id:string){return this.scope+'/'+id;}
  private owns(projectId:string,agent:MulticaAgent){return agent.description?.startsWith('[GWI '+projectId+'/')??false;}
  private revisionAgent(agent:MulticaAgent){return /^\[GWI [^/\n]+\/[^@\n]+@[a-f0-9]{20}\]/.test(agent.description??'');}
  async ownedAgent(projectId:string,id:string,actor:Actor){this.owner(actor,projectId);const agent=await this.client.getAgent(id);demand(this.owns(projectId,agent),'AGENT_PROJECT_SCOPE','Create a project copy before editing a shared or another project agent.',403);demand(!this.revisionAgent(agent),'ROLE_REVISION_IMMUTABLE','Edit the project role to create a new agent revision. Existing run configurations are immutable.',409);return agent;}
  async runtime(role?:RoleProfile,forExecution=false):Promise<MulticaRuntime>{
    const all=await this.client.listRuntimes(),selected=role?.multica?.runtimeId??this.profile.runtimeId;
    const runtime=all.find(item=>selected?item.id===selected:item.status==='online');
    demand(runtime&&runtime.status==='online','RUNTIME_UNAVAILABLE','The selected execution runtime is offline. Connect it before starting agent work.',409);
    if(forExecution)demand(runtime.id===this.profile.runtimeId&&runtime.daemon_id===this.profile.daemonId&&!!this.profile.permissionEvidence&&this.profile.verified===true&&this.profile.permissions?.readOnly?.verified===true&&this.profile.permissions?.workspaceWrite?.verified===true,'RUNTIME_VERIFICATION_REQUIRED','Run the protected Multica setup/check before assigning project work to this runtime.',409);return runtime;
  }
  async authorizeExecutionRoot(){
    demand(this.profile.authorizedRootsFile&&path.isAbsolute(this.profile.authorizedRootsFile),'RUNTIME_VERIFICATION_REQUIRED','The runtime has no execution-directory policy.',409);
    const root=path.join(this.dataDirectory,'executions');await mkdir(root,{recursive:true,mode:0o700});const actual=await realpath(root),filename=this.profile.authorizedRootsFile;
    await this.one('authorize-executions',async()=>{const policy:unknown=JSON.parse(await readFile(filename,'utf8'));demand(isObject(policy)&&Array.isArray(policy.roots)&&policy.roots.every(value=>typeof value==='string'&&path.isAbsolute(value)),'INVALID_RUNTIME_POLICY','Invalid runtime execution roots.');if(!policy.roots.includes(actual))await writeFile(filename,JSON.stringify({...policy,roots:[...policy.roots,actual]})+'\n',{mode:0o600});});
  }
  async project(project:Project):Promise<MulticaProject>{return this.one('project:'+project.id,async()=>{
    const key=this.key(project.id),binding=this.engine.store.get<Binding>('multica-project',key);if(binding)return this.client.getProject(binding.providerProjectId);
    const marker='[GWI project '+project.id+']',existing=(await this.client.listProjects()).find(item=>item.description?.includes(marker));
    const remote=existing??await this.client.createProject({title:project.name,description:marker+'\n'+project.description});
    this.engine.store.put('multica-project',{id:key,projectId:project.id,providerProjectId:remote.id});return remote;
  });}
  async agent(project:Project,role:RoleProfile,bind=true):Promise<MulticaAgent>{return this.one('agent:'+project.id+':'+JSON.stringify(role),async()=>{
    demand(!role.retired,'ROLE_RETIRED','Choose an active role for new work.');const runtime=await this.runtime(role);
    const template=role.multica?.agentId?await this.client.getAgent(role.multica.agentId):undefined;
    const roleBasis={...role,executionContract:'gwi-structured-result-v2',multica:{...role.multica,agentId:undefined},effectiveRuntimeId:runtime.id,effectiveModel:role.model??this.defaultModel??this.profile.defaultModel,template:template&&!this.revisionAgent(template)?{id:template.id,updatedAt:template.updated_at}:undefined};
    const hash=createHash('sha256').update(JSON.stringify(roleBasis)).digest('hex').slice(0,20);
    const marker='[GWI '+project.id+'/'+role.id+'@'+hash+']';const listed=await this.client.listAgents();
    const existing=listed.find(item=>item.description?.startsWith(marker));
    const model=role.model??this.defaultModel??this.profile.defaultModel??template?.model;
    const agentInput:MulticaAgentInput={name:(project.name+' · '+role.name).slice(0,80)+' · '+hash.slice(0,8),runtime_id:runtime.id,description:marker+'\n'+role.description,instructions:'GWI owns coordination and result delivery. Complete only the assigned bounded action, then return the requested final JSON directly; GWI persists it automatically. Do not create Multica comments, reporting files, nested agents or polling loops for delivery. Your own sandbox applies only to this action, not to other roles.\n'+role.instructions+'\nInputs: '+JSON.stringify(role.inputs??[])+'\nOutputs: '+JSON.stringify(role.outputs??[])+'\nAcceptance: '+JSON.stringify(role.checks??[]),thinking_level:role.effort,service_tier:'default',max_concurrent_tasks:1,visibility:'private',permission_mode:'private',custom_args:['-c','default_permissions="'+(role.sandbox==='read-only'?'gwi-readonly':'gwi-workspace')+'"','-c','approval_policy="never"'],skill_ids:role.multica?.skillIds??template?.skills?.map(item=>item.id)??[],...(model?{model}:{}),...(isObject(template?.mcp_config)?{mcp_config:template.mcp_config}:{})};
    let remote=existing??await this.client.createAgent(agentInput);
    if(!existing){const inherited=role.multica?.skillIds??(template?(await this.client.listAgentSkills(template.id)).map(skill=>skill.id):[]);const skills=await this.client.setAgentSkills(remote.id,inherited);remote={...remote,skills};}else remote={...remote,skills:await this.client.listAgentSkills(remote.id)};
    if(!existing){const serverIds=role.multica?.mcpServerIds??(template?(await this.client.listAgentMcpServers(template.id)).filter(server=>server.enabled!==false).map(server=>server.id):[]);for(const serverId of serverIds)await this.client.addAgentMcpServer(remote.id,serverId);}
    if(bind)this.engine.store.put('multica-role',{id:this.key(project.id+'/'+role.id),projectId:project.id,roleId:role.id,agentId:remote.id,runtimeId:runtime.id});return remote;
  });}
  async team(projectId:string,actor:Actor){
    const project=this.engine.detail(projectId,actor).project;
    const [connection,agents,skills,runtimes,mcpServers]=await Promise.all([this.connection(),this.client.listAgents(),this.client.listSkills(),this.client.listRuntimes(),this.client.listMcpServers()]);
    const roles=project.roles.map(role=>{const binding=this.engine.store.get<{id:string;agentId:string;runtimeId:string}>('multica-role',this.key(project.id+'/'+role.id));return binding?{...role,multica:{...role.multica,agentId:binding.agentId,runtimeId:binding.runtimeId}}:role;});
    return{roles,agents:agents.map(presentAgent),projectAgentIds:agents.filter(agent=>this.owns(project.id,agent)).map(agent=>agent.id),immutableAgentIds:agents.filter(agent=>this.revisionAgent(agent)).map(agent=>agent.id),skills,runtimes:runtimes.map(({metadata,...runtime})=>runtime),mcpServers,connection,revision:project.revision,capabilities:{steer:true,pauseDispatch:true}};
  }
  async saveRole(projectId:string,expectedRevision:number,value:Partial<RoleProfile>,actor:Actor,roleId?:string){
    const project=this.owner(actor,projectId);demand(project.revision===expectedRevision,'REVISION_CONFLICT','Project configuration changed. Refresh before saving.',409);
    const previous=project.roles.find(item=>item.id===roleId);if(roleId)demand(previous,'ROLE_NOT_FOUND','Role not found.',404);
    demand(isObject(value),'INVALID_ROLE','Provide the role contract.');const role:RoleProfile={name:'Role',description:'',instructions:'',model:null,effort:'low',sandbox:'read-only',skills:[],tools:['context.read','knowledge.search','pipeline.read','run.read'],...previous,...value,id:roleId??value.id??randomUUID()};
    const candidate={...project,roles:previous?project.roles.map(item=>item.id===roleId?role:item):[...project.roles,role]};validateProject(candidate);
    if(!role.retired){const agent=await this.agent(candidate,role,false);role.multica={...role.multica,agentId:agent.id,runtimeId:agent.runtime_id};}
    const saved=await this.engine.updateProject(projectId,expectedRevision,{...candidate,roles:candidate.roles.map(item=>item.id===role.id?role:item)},actor);
    if(role.multica?.agentId)this.engine.store.put('multica-role',{id:this.key(projectId+'/'+role.id),projectId,roleId:role.id,agentId:role.multica.agentId,runtimeId:role.multica.runtimeId});return saved;
  }
  async duplicateRole(projectId:string,roleId:string,expectedRevision:number,actor:Actor){const project=this.owner(actor,projectId),role=project.roles.find(item=>item.id===roleId);demand(role,'ROLE_NOT_FOUND','Role not found.',404);return this.saveRole(projectId,expectedRevision,{...role,id:randomUUID(),name:role.name+' copy',retired:false,multica:{skillIds:role.multica?.skillIds??[]}},actor);}
  async retireRole(projectId:string,roleId:string,expectedRevision:number,actor:Actor){const project=this.owner(actor,projectId),role=project.roles.find(item=>item.id===roleId);demand(role,'ROLE_NOT_FOUND','Role not found.',404);demand(project.roles.filter(item=>!item.retired).length>1,'LAST_ACTIVE_ROLE','Keep at least one active project role.');return this.engine.updateProject(projectId,expectedRevision,{...project,roles:project.roles.map(item=>item.id===roleId?{...item,retired:true}:item)},actor);}
  async saveAgent(projectId:string,body:unknown,actor:Actor,id?:string){
    this.owner(actor,projectId);demand(isObject(body),'INVALID_AGENT','Provide an agent configuration.');demand(!['custom_args','runtime_config'].some(key=>key in body),'MANAGED_RUNTIME_POLICY','Change permissions through the role contract.');
    const previous=id?await this.ownedAgent(projectId,id,actor):undefined,allowed=['name','runtime_id','instructions','model','thinking_level','skill_ids','mcp_config'];const input=Object.fromEntries(Object.entries(body).filter(([key])=>allowed.includes(key))) as MulticaAgentInput;
    const marker=previous?.description?.split('\n')[0]??'[GWI '+projectId+'/custom@'+randomUUID()+']';
    input.description=typeof body.description==='string'?marker+'\n'+body.description:previous?.description??marker;if(!id){input.visibility='private';input.permission_mode='private';input.custom_args=['-c','default_permissions="gwi-readonly"','-c','approval_policy="never"'];}
    let remote=id?await this.client.updateAgent(id,input):await this.client.createAgent(input);if(input.skill_ids){const skills=await this.client.setAgentSkills(remote.id,input.skill_ids);remote={...remote,skills};}return presentAgent(remote);
  }
  async setAgentSkills(projectId:string,id:string,body:unknown,actor:Actor){await this.ownedAgent(projectId,id,actor);demand(isObject(body)&&Array.isArray(body.skillIds)&&body.skillIds.every(value=>typeof value==='string'),'INVALID_SKILLS','Choose connected skills.');return this.client.setAgentSkills(id,body.skillIds);}
  async agentMcp(projectId:string,id:string,actor:Actor){this.engine.detail(projectId,actor);return this.client.listAgentMcpServers(id);}
  async setAgentMcp(projectId:string,id:string,serverId:string,action:'add'|'remove'|'enable',enabled:boolean,actor:Actor){await this.ownedAgent(projectId,id,actor);return action==='add'?this.client.addAgentMcpServer(id,serverId):action==='remove'?this.client.removeAgentMcpServer(id,serverId):this.client.setAgentMcpServerEnabled(id,serverId,enabled);}
  async saveMcp(projectId:string,body:unknown,actor:Actor,id?:string){this.owner(actor,projectId);demand(isObject(body)&&typeof body.name==='string'&&isObject(body.config),'INVALID_MCP','Provide a named MCP connection.');return id?this.client.updateMcpServer(id,{name:body.name,config:body.config}):this.client.createMcpServer({name:body.name,config:body.config});}
  async skill(projectId:string,id:string,actor:Actor){this.engine.detail(projectId,actor);return this.client.getSkill(id);}
  async saveSkill(projectId:string,body:unknown,actor:Actor,id?:string){this.owner(actor,projectId);demand(isObject(body),'INVALID_SKILL','Provide the selected skill content.');return id?this.client.updateSkill(id,body as MulticaSkillInput):this.client.createSkill(body as MulticaSkillInput);}
  async prepareTeam(projectId:string,actor:Actor){const project=this.owner(actor,projectId);await this.project(project);for(const role of project.roles.filter(item=>!item.retired))await this.agent(project,role);return this.team(projectId,actor);}
}

export async function loadPlatform(engine:Engine,dataDirectory:string,connectionFile:string,defaultModel?:string):Promise<Platform|undefined>{
  let connection:unknown;try{connection=JSON.parse(await readFile(connectionFile,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
  demand(isObject(connection)&&typeof connection.baseUrl==='string'&&typeof connection.workspaceId==='string'&&typeof connection.token==='string','INVALID_MULTICA_CONNECTION','Check the private Multica connection.');
  let profile:Profile={};try{profile=JSON.parse(await readFile(path.join(path.dirname(connectionFile),'execution-profile.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return new Platform(engine,connection as MulticaConnection,dataDirectory,defaultModel,profile);
}
