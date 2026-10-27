import {DEFAULT_EFFORT, EFFORTS} from './contracts.ts';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {readFile,writeFile,mkdir,realpath,lstat,access,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {Actor,Project,RoleProfile} from './contracts.ts';
import {Engine} from './engine.ts';
import {createMulticaClient,type MulticaConnection,type MulticaClient,type MulticaAgent,type MulticaAgentInput,type MulticaSkillInput,type MulticaProject,type MulticaRuntime} from './adapters/multica.ts';
import {AppError,demand,isObject,validateProject} from './validation.ts';
import {Workspaces,type VerificationWorkspace} from './workspaces.ts';

type Binding={id:string;projectId:string;providerProjectId:string};
export type DaemonIdentity={healthUrl:string;pid:number;profile:string;daemonId:string;cliCommit:string;startedAt:string};
type Profile={runtimeId?:string;daemonId?:string;defaultModel?:string;permissionProfiles?:string[];permissions?:{readOnly?:{name:string;verified?:boolean;network?:string};workspaceWrite?:{name:string;verified?:boolean;network?:string}};verified?:boolean;permissionEvidence?:string;authorizedRootsFile?:string;guardBinary?:string;scratchHome?:string;daemon?:DaemonIdentity;[key:string]:unknown};
export type VerificationScopeProof={checkedAt:string;profile:'gwi-workspace';copyWrite:true;executionWriteDenied:true;projectWriteDenied:true;siblingWriteDenied:true;approvalPolicy:'never';modelTurnStarted:false;readIsolation:false;network:'enabled'|'unknown';networkDomainRestriction:false};
export type VerificationProbeInput={guardBinary:string;scratchHome:string;workspace:string;executionFile:string;projectFile:string;siblingFile:string;network:'enabled'|'unknown'};
export type VerificationProbe=(input:VerificationProbeInput)=>Promise<VerificationScopeProof>;
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";

/** Run only native command RPCs; no thread, model turn, account or auth read. */
export async function probeVerificationScope(input:VerificationProbeInput):Promise<VerificationScopeProof>{
  const child=spawn(input.guardBinary,['app-server','--listen','stdio://','-c','default_permissions="gwi-workspace"','-c','approval_policy="never"'],{cwd:input.workspace,env:{...process.env,CODEX_HOME:input.scratchHome,MULTICA_TASK_ID:'gwi-verification-probe-'+randomUUID()},stdio:['pipe','pipe','pipe']});
  const ended=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.once('error',()=>resolve());});
  type Pending={resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
  const pending=new Map<number,Pending>();let sequence=0,buffer='',closed=false;
  const failure=()=>new AppError('VERIFICATION_PROBE_FAILED','The protected verification runner could not prove source protection. Assign these checks to a capable runner or the owner delivery gate.',409);
  const stop=()=>{closed=true;for(const request of pending.values()){clearTimeout(request.timer);request.reject(failure());}pending.clear();};
  child.once('error',stop);child.once('exit',stop);child.stderr.on('data',()=>{});child.stdin.on('error',stop);
  child.stdout.setEncoding('utf8');child.stdout.on('data',(value:string)=>{buffer+=value;if(buffer.length>1024*1024){stop();child.kill('SIGTERM');return;}while(buffer.includes('\n')){
    const cut=buffer.indexOf('\n'),line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);let message:unknown;try{message=JSON.parse(line);}catch{continue;}
    if(!isObject(message))continue;
    if(typeof message.method==='string'&&/approval/i.test(message.method)){stop();child.kill('SIGTERM');return;}
    if(typeof message.id!=='number')continue;const request=pending.get(message.id);if(!request)continue;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(failure());else request.resolve(message.result);
  }});
  const rpc=(method:string,params:unknown)=>new Promise<unknown>((resolve,reject)=>{if(closed){reject(failure());return;}const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(failure());},10000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  const probeFile=path.join(input.workspace,'.gwi-verification-probe-'+randomUUID());
  try{
    await rpc('initialize',{clientInfo:{name:'gwi_verification_scope_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
    const command=async(script:string)=>{const result=await rpc('command/exec',{command:['/bin/sh','-c',script],cwd:input.workspace,permissionProfile:'gwi-workspace',timeoutMs:5000});demand(isObject(result)&&Number.isInteger(result.exitCode),'VERIFICATION_PROBE_FAILED','The native runner did not report a command result.',409);return result.exitCode as number;};
    demand(await command('printf gwi-scope-probe > '+quote(probeFile))===0&&await readFile(probeFile,'utf8')==='gwi-scope-probe','VERIFICATION_PROBE_FAILED','The native runner could not write task-scoped scratch in the verification copy.',409);
    // Opening existing files for zero-byte append tests write permission without changing source bytes.
    for(const filename of [input.executionFile,input.projectFile,input.siblingFile])demand(await command(': >> '+quote(filename))!==0,'VERIFICATION_SCOPE_UNSAFE','The verification runner can write outside its copy. No model task was started; use a capable configured runner or owner verification.',409);
    return{checkedAt:new Date().toISOString(),profile:'gwi-workspace',copyWrite:true,executionWriteDenied:true,projectWriteDenied:true,siblingWriteDenied:true,approvalPolicy:'never',modelTurnStarted:false,readIsolation:false,network:input.network,networkDomainRestriction:false};
  }finally{child.stdin.end();child.kill('SIGTERM');stop();const exited=await new Promise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),3000);ended.then(()=>{clearTimeout(timer);resolve(true);});});if(!exited)child.kill('SIGKILL');await rm(probeFile,{force:true});demand(exited,'VERIFICATION_PROBE_CLEANUP_UNCONFIRMED','The permission probe did not confirm its native process ended. Inspect it before running verification.',409);}
}
/** Native configuration may contain credentials; keep it write-only to the UI. */
export function presentAgent(agent:MulticaAgent){const {mcp_config,runtime_config,custom_args,...visible}=agent;return{...visible,description:visible.description?.replace(/^\[GWI [^\n]+\]\n?/,''),mcpConfigured:!!mcp_config,runtimeConfigured:!!runtime_config,permissionManaged:true};}
export class Platform {
  readonly client:MulticaClient; readonly workspaces:Workspaces;
  private pending=new Map<string,Promise<unknown>>();
  readonly engine:Engine; readonly dataDirectory:string; private defaultModel?:string; private profile:Profile;private scope:string;private verificationProbe:VerificationProbe;
  constructor(engine:Engine,connection:MulticaConnection,dataDirectory:string,defaultModel?:string,profile:Profile={},client?:MulticaClient,verificationProbe:VerificationProbe=probeVerificationScope){
    this.engine=engine;this.dataDirectory=dataDirectory;this.defaultModel=defaultModel??profile.defaultModel??(typeof profile.model==='string'?profile.model:undefined);this.profile=profile;this.verificationProbe=verificationProbe;
    this.scope=createHash('sha256').update(connection.baseUrl+'\n'+connection.workspaceId).digest('hex').slice(0,16);
    this.client=client??createMulticaClient(connection);this.workspaces=new Workspaces(engine.store,path.join(dataDirectory,'executions'));
  }
  private owner(actor:Actor,projectId:string):Project{const project=this.engine.detail(projectId,actor).project;demand(!actor.projectId,'OWNER_REQUIRED','Team and capability changes require the project owner.',403);return project;}
  private async one<T>(key:string,action:()=>Promise<T>):Promise<T>{const pending=this.pending.get(key);if(pending)return pending as Promise<T>;const result=action().finally(()=>this.pending.delete(key));this.pending.set(key,result);return result;}
  async connection(){const info=await this.client.info();return{...info,connected:info.available&&info.authenticated};}
  executionLimits(){return{maxTaskSeconds:null,nativeTaskLimit:'unknown' as const,timeoutEnforcement:'observer-cancellation' as const};}
  verificationCapability(){
    const available=this.profile.verified===true&&!!this.profile.runtimeId&&!!this.profile.daemonId&&!!this.profile.permissionEvidence&&this.profile.permissions?.workspaceWrite?.verified===true&&this.profile.permissions.workspaceWrite.name==='gwi-workspace'&&this.profile.permissions?.readOnly?.verified===true&&this.profile.permissions.readOnly.name==='gwi-readonly'&&typeof this.profile.guardBinary==='string'&&path.isAbsolute(this.profile.guardBinary)&&typeof this.profile.scratchHome==='string'&&path.isAbsolute(this.profile.scratchHome)&&typeof this.profile.authorizedRootsFile==='string'&&path.isAbsolute(this.profile.authorizedRootsFile);
    return{requested:'review' as const,mode:available?'disposable-copy' as const:'unavailable' as const,available,requiresProbe:true as const,sourceProtection:available?'probe-required' as const:'unavailable' as const,scratchWrite:available?'probe-required' as const:'unavailable' as const,readIsolation:false as const,network:this.profile.permissions?.workspaceWrite?.network==='enabled'?'enabled' as const:'unknown' as const,networkDomainRestriction:false as const,...(!available?{reason:'The protected verification runner is unavailable. Use a capable configured runner or record pending checks for owner delivery.'}:{})};
  }
  async verifyReviewScope(copy:VerificationWorkspace,role:RoleProfile){
    const capability=this.verificationCapability();demand(capability.available,'VERIFICATION_CAPABILITY_UNAVAILABLE',capability.reason??'A protected verification runner is required.',409);await this.runtime(role,true);
    const guard=this.profile.guardBinary!,scratchHome=this.profile.scratchHome!;demand((await lstat(guard).catch(()=>undefined))?.isFile(),'VERIFICATION_CAPABILITY_UNAVAILABLE','The protected verification guard is unavailable. Use a configured verifier or owner delivery.',409);await access(guard,constants.X_OK);
    const sourceFile=async(root:string)=>{for(const entry of copy.manifest.entries.filter(entry=>entry.kind==='file')){const filename=path.join(root,entry.path),file=await lstat(filename).catch(()=>undefined);if(!file?.isFile())continue;const actual=await realpath(filename);if(!actual.startsWith(root+path.sep))continue;try{await access(filename,constants.W_OK);return filename;}catch{}}throw new AppError('VERIFICATION_PROBE_UNAVAILABLE','No ordinary writable source file is available for a safe protection probe. Assign verification to a capable configured runner or owner delivery.',409);};
    const executionFile=await sourceFile(copy.executionPath),projectFile=await sourceFile(copy.projectPath),sibling=await mkdtemp(path.join(path.dirname(copy.path),'.gwi-scope-sibling-')),siblingFile=path.join(sibling,'probe.txt');
    try{await writeFile(siblingFile,'GWI disposable permission probe.\n',{mode:0o600});const proof=await this.verificationProbe({guardBinary:guard,scratchHome,workspace:copy.path,executionFile,projectFile,siblingFile,network:capability.network});demand(proof.profile==='gwi-workspace'&&proof.copyWrite===true&&proof.executionWriteDenied===true&&proof.projectWriteDenied===true&&proof.siblingWriteDenied===true&&proof.approvalPolicy==='never'&&proof.modelTurnStarted===false,'VERIFICATION_SCOPE_UNSAFE','The verification runner did not prove the required source protection.',409);this.engine.store.put('verification-proof',{id:copy.id,...proof});return proof;}finally{await rm(sibling,{recursive:true,force:true});}
  }
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
  async effectiveRoleModel(_project:Project,role:RoleProfile):Promise<string|null>{
    const selected=role.model??this.defaultModel??this.profile.defaultModel;
    if(selected)return selected;
    const template=role.multica?.agentId?await this.client.getAgent(role.multica.agentId):undefined;
    return template?.model??null;
  }
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
    return{roles,agents:agents.map(presentAgent),projectAgentIds:agents.filter(agent=>this.owns(project.id,agent)).map(agent=>agent.id),immutableAgentIds:agents.filter(agent=>this.revisionAgent(agent)).map(agent=>agent.id),skills,runtimes:runtimes.map(({metadata,...runtime})=>runtime),mcpServers,connection,revision:project.revision,capabilities:{steer:true,pauseDispatch:true,verification:this.verificationCapability(),execution:this.executionLimits()}};
  }
  async saveRole(projectId:string,expectedRevision:number,value:Partial<RoleProfile>,actor:Actor,roleId?:string){
    const project=this.owner(actor,projectId);demand(project.revision===expectedRevision,'REVISION_CONFLICT','Project configuration changed. Refresh before saving.',409);
    const previous=project.roles.find(item=>item.id===roleId);if(roleId)demand(previous,'ROLE_NOT_FOUND','Role not found.',404);
    demand(isObject(value),'INVALID_ROLE','Provide the role contract.');const role:RoleProfile={name:'Role',description:'',instructions:'',model:null,effort:DEFAULT_EFFORT,sandbox:'read-only',skills:[],tools:['context.read','knowledge.search','pipeline.read','run.read'],...previous,...value,id:roleId??value.id??randomUUID()};
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
    if(input.thinking_level!==undefined)demand(EFFORTS.some(effort=>effort===input.thinking_level),'INVALID_EFFORT','Choose a supported native reasoning effort.');if(!id&&input.thinking_level===undefined)input.thinking_level=DEFAULT_EFFORT;
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
