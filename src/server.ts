import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from './store.ts';
import {Engine} from './engine.ts';
import {AccountAllowanceService} from './account-allowance.ts';
import type {AllowanceTarget} from './account-allowance-types.ts';
import {IntakeService} from './intake.ts';
import {workspaceSummary} from './workspace.ts';
import {AdoptionService,type AdoptionInput} from './adoption.ts';
import {TemplateService} from './templates.ts';
import type {ApplyTemplateInput,CreateTemplateInput,PreviewTemplateInput,RetireTemplateInput,ReviseTemplateInput} from './template-types.ts';
import type {KnowledgeLocator} from './knowledge-context-types.ts';
import {pipelineNeedsModel,projectReadiness} from './project-readiness.ts';
import {requireWorkspaceReady} from './workspaces.ts';
import {createCodexAdapter} from './adapters/codex.ts';
import {createGithubAdapter} from './adapters/github.ts';
import {loadPlatform} from './platform.ts';
import {PlatformExecution} from './platform-execution.ts';
import {ControlMcp} from './control-mcp.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AppError,demand,isObject} from './validation.ts';
import type {Actor,ContinueRunInput,IntegrationInfo,IntakeRetryInput,LessonLifecycleInput,Pipeline,Project,ResolveRunInput,Run,StartRunInput,TaskOutput} from './contracts.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDirectory=path.resolve(process.env.GWI_DATA_DIR??path.join(root,'.local/state'));
for(const name of ['dist','web','src','node_modules','public'])demand(dataDirectory!==path.join(root,name)&&!dataDirectory.startsWith(path.join(root,name)+path.sep),'UNSAFE_DATA_DIRECTORY','Keep private runtime data outside public source and asset directories.');
const port=Number(process.env.GWI_PORT??4318);
demand(Number.isInteger(port)&&port>=1024&&port<65536,'INVALID_PORT','Choose a local port between 1024 and 65535.');
await mkdir(dataDirectory,{recursive:true,mode:0o700});
const tokenFile=path.join(dataDirectory,'token');
let token:string;
try{token=(await readFile(tokenFile,'utf8')).trim();demand(/^[a-f0-9]{64}$/.test(token),'INVALID_TOKEN_FILE','The private runtime token file is invalid.');}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;token=randomBytes(32).toString('hex');await writeFile(tokenFile,token+'\n',{mode:0o600,flag:'wx'});}
let runtime:{codexBinary?:string;defaultModel?:string}={};
try{const parsed:unknown=JSON.parse(await readFile(path.join(dataDirectory,'runtime.json'),'utf8'));demand(isObject(parsed)&&Object.keys(parsed).every(key=>key==='codexBinary'||key==='defaultModel')&&(parsed.codexBinary===undefined||(typeof parsed.codexBinary==='string'&&path.isAbsolute(parsed.codexBinary)&&parsed.codexBinary.length<=4096)),'INVALID_RUNTIME_CONFIG','Check the local runtime executable and default model.');demand(parsed.defaultModel===undefined||(typeof parsed.defaultModel==='string'&&parsed.defaultModel.length>0&&parsed.defaultModel.length<=160),'INVALID_RUNTIME_MODEL','Choose a model ID from the installed Codex catalog.');runtime=parsed;}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const engine=new Engine(new Store(dataDirectory),createCodexAdapter({binary:process.env.GWI_CODEX_BIN??runtime.codexBinary,defaultModel:process.env.GWI_CODEX_MODEL??runtime.defaultModel}),createGithubAdapter());
engine.executionReadiness=requireWorkspaceReady;
engine.accountAllowances=new AccountAllowanceService(engine.store,{readAccountAllowance:()=>engine.codex.readAccountAllowance!()});
const controls=new ControlMcp(`http://127.0.0.1:${port}`);
const platform=process.env.GWI_MULTICA_CONNECTION?await loadPlatform(engine,dataDirectory,process.env.GWI_MULTICA_CONNECTION,process.env.GWI_CODEX_MODEL??runtime.defaultModel):await loadPlatform(engine,dataDirectory,path.join(root,'.local/multica/connection.json'),process.env.GWI_CODEX_MODEL??runtime.defaultModel)??await loadPlatform(engine,dataDirectory,path.join(root,'.local/multica-runtime/connection.json'),process.env.GWI_CODEX_MODEL??runtime.defaultModel);
const execution=platform?new PlatformExecution(platform,controls):undefined;
if(execution){engine.agentExecutor=execution.agent;engine.goalPlanner=execution.planner;engine.reconcileExternal=(runId,stageId,options)=>execution.reconcile(runId,stageId,options);}
engine.accountModelResolver=async(project,role)=>platform?platform.effectiveRoleModel(project,role):role.model??process.env.GWI_CODEX_MODEL??runtime.defaultModel??(await engine.codex.info()).models.find(model=>model.isDefault)?.id??null;
const intakeService=new IntakeService(engine);
const adoptionService=new AdoptionService(engine);adoptionService.recover();
const templateService=new TemplateService(engine,platform?{saveRole:platform.saveRole.bind(platform)}:{});
let integrationCache:{at:number;value:Promise<IntegrationInfo>}|null=null;
function integrations():Promise<IntegrationInfo>{if(!integrationCache||Date.now()-integrationCache.at>30000)integrationCache={at:Date.now(),value:Promise.all([engine.codex.info(),engine.github.info(),platform?.connection()]).then(([codex,github,multica])=>({codex,github,...(multica?{multica}:{})}))};return integrationCache.value;}
const origin=`http://127.0.0.1:${port}`;
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
const sessionCookie=`gwi_session_${port}`;
function secureEqual(candidate:string):boolean{const a=Buffer.from(candidate),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);}
function actorFor(request:IncomingMessage):Actor {
  const authorization=request.headers.authorization;
  if(authorization?.startsWith('Bearer ')&&secureEqual(authorization.slice(7)))return{name:String(request.headers['x-gwi-actor']??'local-agent').slice(0,120),kind:'agent'};
  const cookie=request.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1);
  demand(cookie&&secureEqual(cookie),'UNAUTHENTICATED','Use the local browser session or private agent token.',401);
  demand(request.method==='GET'||request.headers.origin===origin||request.headers.origin===`http://localhost:${port}`,'INVALID_ORIGIN','Private mutations require a same-origin browser or bearer token.',403);
  return{name:'local-human',kind:'human'};
}
async function body(request:IncomingMessage):Promise<Record<string,unknown>>{let length=0;const chunks:Buffer[]=[];for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;demand(length<=2*1024*1024,'BODY_TOO_LARGE','Request exceeds two MiB.',413);chunks.push(bytes);}if(!length)return{};let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('INVALID_JSON','Send a JSON object.');}demand(isObject(value),'INVALID_JSON','Send a JSON object.');return value;}
function json(response:ServerResponse,value:unknown,statusCode=200){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));}
async function accountTarget(input:Record<string,unknown>,actor:Actor):Promise<AllowanceTarget>{
  if(typeof input.runId==='string'){
    const run=engine.run(input.runId);engine.detail(run.projectId,actor);
    if(typeof input.projectId==='string')demand(input.projectId===run.projectId,'PROJECT_SCOPE','Choose the run project.',403);
    return engine.resolvedAllowanceTarget(run,typeof input.stageId==='string'?input.stageId:undefined);
  }
  const projectId=String(input.projectId??'');engine.detail(projectId,actor);
  if(typeof input.intakeId==='string')return intakeService.accountTarget(projectId,input.intakeId,typeof input.model==='string'?input.model:undefined);
  if(typeof input.pipelineId==='string'){
    const project=engine.project(projectId),pipeline=engine.pipeline(input.pipelineId);demand(pipeline.projectId===projectId,'PROJECT_SCOPE','Choose a pipeline in this project.',403);
    const stage=pipeline.stages.find(value=>value.id===input.stageId)??pipeline.stages.find(value=>value.executor==='codex')??pipeline.stages[0],role=project.roles.find(value=>value.id===stage.roleId)!;
    return{projectId,pipelineId:pipeline.id,stageId:stage.id,roleId:role.id,model:role.model??await engine.accountModelResolver!(project,role),effort:role.effort,kind:'stage'};
  }
  return intakeService.accountTarget(projectId);
}
async function api(request:IncomingMessage,response:ServerResponse,url:URL):Promise<void>{
  const method=request.method??'GET',route=url.pathname;
  demand(allowedHosts.has(request.headers.host??''),'INVALID_HOST','This server accepts its local loopback host only.',403);
  demand(!request.headers.origin||request.headers.origin===origin||request.headers.origin===`http://localhost:${port}`,'INVALID_ORIGIN','Unexpected request origin.',403);
  if(route==='/mcp/control'){await controls.handle(request,response);return;}
  if(route==='/api/session'&&method==='GET'){response.setHeader('set-cookie',`${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict`);json(response,{authenticated:true});return;}
  const actor=actorFor(request),input=method==='GET'?{}:await body(request);
  if(route==='/api/account-allowance'&&(method==='GET'||method==='POST')){
    const context=method==='GET'?Object.fromEntries(url.searchParams):input,target=await accountTarget(context,actor);
    json(response,await engine.accountAllowances!.assess(target,{refresh:method==='POST'&&input.refresh===true}));return;
  }
  if(route==='/api/overview'&&method==='GET'){const connection=await integrations();json(response,engine.store.withReadView(()=>({projects:engine.overview(actor),integrations:connection,events:engine.store.events({limit:50})})));return;}
  if(route==='/api/workspace'&&method==='GET'){json(response,engine.store.withReadView(()=>{const projects=engine.overview(actor);return workspaceSummary(projects,engine.store.list<Run>('run'),projects.flatMap(project=>intakeService.list(project.id)),engine.store.events({projectId:actor.projectId,limit:1})[0]?.seq??0);}));return;}
  if(route==='/api/integrations'&&method==='GET'){json(response,await integrations());return;}
  if(route==='/api/platform'&&method==='GET'){json(response,platform?await platform.connection():{connected:false,available:false,authenticated:false,error:{code:'MULTICA_NOT_CONFIGURED',message:'Connect the local Multica service.'}});return;}
  if(route==='/api/adoptions'&&method==='GET'){json(response,{adoptions:adoptionService.list(actor)});return;}
  if(route==='/api/adoptions'&&method==='POST'){json(response,await adoptionService.create(input as AdoptionInput,actor),201);return;}
  const adoption=route.match(/^\/api\/adoptions\/([^/]+)(?:\/(apply))?$/);
  if(adoption){const id=decodeURIComponent(adoption[1]);if(!adoption[2]&&method==='GET'){json(response,adoptionService.get(id,actor));return;}if(adoption[2]==='apply'&&method==='POST'){json(response,await adoptionService.apply(id,Number(input.expectedRevision),actor));return;}}
  if(route==='/api/projects'&&method==='POST'){json(response,await engine.createProject(input as {name:string;workspace:string;description?:string;repository?:string},actor),201);return;}
  if(route==='/api/templates'&&method==='GET'){json(response,{templates:templateService.list(actor)});return;}
  if(route==='/api/templates'&&method==='POST'){json(response,templateService.create(input as CreateTemplateInput,actor),201);return;}
  const template=route.match(/^\/api\/templates\/([^/]+)(?:\/revisions(?:\/(\d+))?)?$/);
  if(template){const id=decodeURIComponent(template[1]);if(template[2]&&method==='GET'){json(response,templateService.revision(id,Number(template[2]),actor));return;}if(!template[2]&&route.endsWith('/revisions')&&method==='POST'){json(response,templateService.revise(id,input as ReviseTemplateInput,actor),201);return;}if(!template[2]&&method==='PATCH'){json(response,templateService.retire(id,input as RetireTemplateInput,actor));return;}}
  const project=route.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
  if(project){const id=decodeURIComponent(project[1]),resource=project[2];
    if(resource==='template-bindings'&&method==='GET'){json(response,templateService.bindings(id,actor));return;}
    if(resource==='template-previews'&&method==='POST'){json(response,templateService.preview(id,input as PreviewTemplateInput,actor),201);return;}
    const templateApply=resource?.match(/^template-previews\/([^/]+)\/apply$/);if(templateApply&&method==='POST'){json(response,await templateService.apply(id,decodeURIComponent(templateApply[1]),input as ApplyTemplateInput,actor));return;}
    if(resource?.startsWith('team')){
      demand(platform,'MULTICA_NOT_CONFIGURED','Connect the local Multica service before changing the execution team.',503);
      if(resource==='team'&&method==='GET'){json(response,await platform.team(id,actor));return;}
      if(resource==='team/prepare'&&method==='POST'){json(response,await platform.prepareTeam(id,actor));return;}
      if(resource==='team/roles'&&method==='POST'){json(response,await platform.saveRole(id,Number(input.expectedRevision),input.role as never,actor));return;}
      const role=resource.match(/^team\/roles\/([^/]+)(?:\/(duplicate))?$/);
      if(role){const roleId=decodeURIComponent(role[1]);if(role[2]&&method==='POST'){json(response,await platform.duplicateRole(id,roleId,Number(input.expectedRevision),actor));return;}if(method==='PUT'){json(response,await platform.saveRole(id,Number(input.expectedRevision),input.role as never,actor,roleId));return;}if(method==='DELETE'){json(response,await platform.retireRole(id,roleId,Number(input.expectedRevision),actor));return;}}
      if(resource==='team/agents'&&method==='POST'){json(response,await platform.saveAgent(id,input,actor));return;}
      if(resource==='team/mcp-servers'&&method==='POST'){json(response,await platform.saveMcp(id,input,actor));return;}
      const mcp=resource.match(/^team\/mcp-servers\/([^/]+)$/);if(mcp&&method==='PUT'){json(response,await platform.saveMcp(id,input,actor,decodeURIComponent(mcp[1])));return;}
      const agentMcp=resource.match(/^team\/agents\/([^/]+)\/mcp-servers(?:\/([^/]+))?$/);
      if(agentMcp){const agentId=decodeURIComponent(agentMcp[1]),serverId=agentMcp[2]?decodeURIComponent(agentMcp[2]):String(input.serverId??'');if(method==='GET'){json(response,{servers:await platform.agentMcp(id,agentId,actor)});return;}if(method==='POST'||method==='DELETE'||method==='PUT'){json(response,await platform.setAgentMcp(id,agentId,serverId,method==='POST'?'add':method==='DELETE'?'remove':'enable',input.enabled===true,actor));return;}}
      const agent=resource.match(/^team\/agents\/([^/]+)(?:\/(skills))?$/);
      if(agent){const agentId=decodeURIComponent(agent[1]);if(agent[2]&&method==='GET'){engine.detail(id,actor);json(response,{skills:await platform.client.listAgentSkills(agentId)});return;}if(agent[2]&&method==='PUT'){json(response,await platform.setAgentSkills(id,agentId,input,actor));return;}if(method==='PUT'){json(response,await platform.saveAgent(id,input,actor,agentId));return;}}
      if(resource==='team/skills'&&method==='POST'){json(response,await platform.saveSkill(id,input,actor));return;}
      const skill=resource.match(/^team\/skills\/([^/]+)$/);
      if(skill){const skillId=decodeURIComponent(skill[1]);if(method==='GET'){json(response,await platform.skill(id,skillId,actor));return;}if(method==='PUT'){json(response,await platform.saveSkill(id,input,actor,skillId));return;}}
    }
    if(!resource&&method==='GET'){json(response,engine.store.withReadView(()=>({...engine.detail(id,actor),intakes:intakeService.list(id)})));return;}
    if(!resource&&method==='PUT'){json(response,await engine.updateProject(id,Number(input.expectedRevision),input.project as Project,actor));return;}
    if(resource==='readiness'&&method==='GET'){engine.detail(id,actor);json(response,await projectReadiness(engine.project(id),engine.store));return;}
    if(resource==='bindings'&&method==='PATCH'){demand(Object.keys(input).every(key=>key==='expectedRevision'||key==='bindings'),'INVALID_PROJECT_BINDINGS','Send the project revision and bindings only.');json(response,await engine.updateBindings(id,Number(input.expectedRevision),input.bindings as never,actor));return;}
    if(resource==='skills'&&method==='GET'){json(response,{skills:await engine.codex.skills(engine.project(id).workspace)});return;}
    if(resource==='knowledge/sync'&&method==='POST'){json(response,await engine.sync(id,actor));return;}
    if(resource==='knowledge'&&method==='GET'){engine.detail(id,actor);const status=url.searchParams.get('status')??'current';demand(['current','archived','proposed','declined'].includes(status),'INVALID_KNOWLEDGE_STATUS','Choose current knowledge or archived lessons.');if(status!=='current')demand(!actor.projectId,'OWNER_REQUIRED','Archived lesson management requires the local owner token.',403);json(response,{entries:engine.search(id,url.searchParams.get('q')??'',url.searchParams.get('role')??undefined,url.searchParams.get('kind')??undefined,status as 'current'|'archived'|'proposed'|'declined')});return;}
    if(resource==='knowledge/lessons'&&method==='POST'){json(response,engine.lesson(id,input as {title:string;content:string;roles?:string[];runId?:string},actor),201);return;}
    if(resource==='knowledge/governance'&&method==='GET'){json(response,engine.knowledgeGovernance(id,actor));return;}
    if(resource==='knowledge/feedback'&&method==='POST'){json(response,engine.knowledgeFeedback(id,input as Parameters<Engine['knowledgeFeedback']>[1],actor),201);return;}
    if(resource==='knowledge/relationships'&&method==='POST'){json(response,engine.knowledgeRelationship(id,input as Parameters<Engine['knowledgeRelationship']>[1],actor),201);return;}
    const lessonReview=resource?.match(/^knowledge\/lessons\/([^/]+)\/review$/);if(lessonReview&&method==='POST'){json(response,engine.reviewLesson(id,decodeURIComponent(lessonReview[1]),input as Parameters<Engine['reviewLesson']>[2],actor));return;}
    const lessonLifecycle=resource.match(/^knowledge\/lessons\/([^/]+)$/);if(lessonLifecycle&&method==='PATCH'){json(response,engine.setLessonLifecycle(id,decodeURIComponent(lessonLifecycle[1]),input as LessonLifecycleInput,actor));return;}
    if(resource==='revisions'&&method==='GET'){engine.project(id);json(response,{project:engine.store.list<{id:string;projectId:string}>('project-revision').filter(item=>item.projectId===id),pipelines:engine.store.list<{id:string;projectId:string}>('pipeline-revision').filter(item=>item.projectId===id)});return;}
    if(resource==='intakes'&&method==='GET'){json(response,engine.store.withReadView(()=>({intakes:intakeService.list(id)})));return;}
    if(resource==='intakes'&&method==='POST'){engine.detail(id,actor);await engine.ensureExecutionReady(engine.project(id));json(response,await intakeService.createWithAccount(id,input as Parameters<IntakeService['create']>[1],actor),201);return;}
  }
  if(route==='/api/pipelines'&&method==='POST'){json(response,engine.createPipeline(input as {projectId:string;roleId:string;name?:string;description?:string;template?:string},actor),201);return;}
  const pipeline=route.match(/^\/api\/pipelines\/([^/]+)(?:\/(proposals))?$/);
  if(pipeline){const id=decodeURIComponent(pipeline[1]);if(!pipeline[2]&&method==='PUT'){json(response,engine.updatePipeline(id,Number(input.expectedRevision),input.definition as Pipeline,actor));return;}if(pipeline[2]&&method==='POST'){json(response,engine.propose(id,Number(input.expectedRevision),input.definition as Pipeline,String(input.rationale??''),actor,typeof input.runId==='string'?input.runId:undefined),201);return;}}
  const proposal=route.match(/^\/api\/proposals\/([^/]+)\/apply$/);if(proposal&&method==='POST'){json(response,engine.applyProposal(proposal[1],actor));return;}
  if(route==='/api/runs'&&method==='POST'){
    const project=engine.detail(String(input.projectId),actor).project;
    const selected=engine.pipeline(String(input.pipelineId));demand(selected.projectId===project.id,'PROJECT_SCOPE','Choose a pipeline in this project.',403);
    if(pipelineNeedsModel(selected,engine.detail(project.id,actor).pipelines))await engine.ensureExecutionReady(project);
    if(typeof input.baseline!=='string'||!input.baseline.trim()){
      let revision='';try{revision=(await promisify(execFile)('git',['-C',project.workspace,'rev-parse','HEAD'],{timeout:5000})).stdout.trim();}catch{}
      input.baseline=revision?`${project.repository||project.name} @ ${revision}`:`${project.name} · configuration ${project.revision}`;
    }
    const approval=input.approveAccountStep===true?await engine.approveAccountStep(await accountTarget({projectId:project.id,pipelineId:String(input.pipelineId)},actor),typeof input.accountAssessmentKey==='string'?input.accountAssessmentKey:undefined,actor):undefined;
    json(response,await engine.startRunWithContext(input as StartRunInput,actor,approval),201);return;
  }
  const intake=route.match(/^\/api\/intakes\/([^/]+)\/(cancel|retry|resume)$/);
  if(intake&&method==='POST'){const id=decodeURIComponent(intake[1]);json(response,intake[2]==='resume'?intakeService.continueWork(id,actor,typeof input.note==='string'?{note:input.note}:{}):intake[2]==='retry'?await intakeService.retry(id,input as IntakeRetryInput,actor):intakeService.cancel(id,String(input.note??''),actor));return;}
  const run=route.match(/^\/api\/runs\/([^/]+)(?:\/(.*))?$/);
  if(run&&run[2]==='context'&&method==='GET'){const id=decodeURIComponent(run[1]);engine.detail(engine.run(id).projectId,actor);const stageId=url.searchParams.get('stage')??engine.run(id).snapshot.pipeline.stages[0]?.id??'';json(response,{context:engine.contextRecord(id,stageId,url.searchParams.get('attempt')??undefined)});return;}
  if(run&&run[2]==='context/read'&&method==='POST'){const id=decodeURIComponent(run[1]);engine.detail(engine.run(id).projectId,actor);json(response,await engine.contextRead(id,String(input.stageId??''),typeof input.attemptId==='string'?input.attemptId:undefined,input.locator as KnowledgeLocator));return;}
  if(run&&run[2]==='recovery'&&method==='GET'){const id=decodeURIComponent(run[1]);engine.detail(engine.run(id).projectId,actor);json(response,await engine.recoveryWithAccount(id,url.searchParams.get('stageId')??undefined,actor,url.searchParams.get('resourceMode')==='account'));return;}
  if(run&&run[2]==='continue'&&method==='POST'){const id=decodeURIComponent(run[1]);engine.detail(engine.run(id).projectId,actor);json(response,await engine.continueWithAccount(id,input as ContinueRunInput,actor));return;}
  if(run&&run[2]==='resolve'&&method==='POST'){const id=decodeURIComponent(run[1]);engine.detail(engine.run(id).projectId,actor);json(response,await engine.resolveWaiting(id,input as ResolveRunInput,actor));return;}
  if(run){const id=decodeURIComponent(run[1]),resource=run[2];engine.detail(engine.run(id).projectId,actor);if(resource==='changes'&&method==='GET'){demand(platform,'MULTICA_NOT_CONFIGURED','Connect the local execution service.',503);json(response,await platform.workspaces.changes(id));return;}if(resource==='artifacts'&&method==='GET'){demand(platform,'MULTICA_NOT_CONFIGURED','Connect the local execution service.',503);json(response,await platform.workspaces.artifact(id,url.searchParams.get('path')??''));return;}if(!resource&&method==='GET'){json(response,{run:engine.run(id),events:engine.store.events({runId:id,limit:300})});return;}if(resource==='cancel'&&method==='POST'){json(response,await engine.cancel(id,String(input.note??''),actor,{declineRetry:input.declineRetry===true}));return;}if(resource==='pause'&&method==='POST'){json(response,engine.pause(id,String(input.note??''),actor));return;}if(resource==='resume'&&method==='POST'){json(response,engine.resume(id,actor));return;}
    if(resource==='limits'&&method==='POST'){demand(isObject(input.limits),'INVALID_RUN_LIMITS','Provide historical execution policy metadata.');json(response,engine.changeLimits(id,Number(input.expectedRevision),input.limits,String(input.note??''),actor));return;}
    if(resource==='executions'&&method==='GET'){json(response,{executions:execution?.records(id)??[]});return;}
    const reconcile=resource?.match(/^stages\/([^/]+)\/reconcile$/);if(reconcile&&method==='POST'){demand(execution,'MULTICA_NOT_CONFIGURED','Connect the local execution service.',503);json(response,await execution.reconcile(id,decodeURIComponent(reconcile[1])));return;}
    const stage=resource?.match(/^stages\/([^/]+)\/(complete|review|retry|steer)$/);if(stage&&method==='POST'){const stageId=decodeURIComponent(stage[1]),action=stage[2];if(action==='complete')json(response,engine.completeManual(id,stageId,input.output as TaskOutput,actor));else if(action==='review')json(response,engine.review(id,stageId,input.decision as 'accept'|'revise',String(input.note??''),actor));else if(action==='retry')json(response,engine.retry(id,stageId,String(input.note??''),actor));else{const receipt=await engine.steer(id,stageId,String(input.text??''),actor);json(response,{accepted:true,...receipt});}return;}}
  if(route==='/api/events'&&method==='GET'){json(response,{events:engine.store.events({projectId:url.searchParams.get('projectId')??undefined,runId:url.searchParams.get('runId')??undefined,after:Number(url.searchParams.get('after')??0),limit:300})});return;}
  throw new AppError('NOT_FOUND','API route not found.',404);
}

const development=process.argv.includes('--dev');
const brandAsset=path.join(root,'public/brand/gwi-mark.svg');
const vite=development?await(await import('vite')).createServer({root,server:{middlewareMode:true,hmr:false,watch:{ignored:['**/.local/**','**/.git/**']},fs:{strict:true,allow:[path.join(root,'web'),path.join(root,'src/contracts.ts'),path.join(root,'node_modules'),brandAsset],deny:['**/.local/**','**/.git/**','**/private/**','**/runtime/**','**/config/**','**/configs/**','**/.env*','**/*.{crt,pem,key,p12,sqlite,sqlite3,db}',path.join(dataDirectory,'**')]}},appType:'spa'}):null;
async function publicDevelopmentPath(url:URL):Promise<boolean>{
  let decoded=url.pathname;for(let count=0;count<3;count++){try{const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;}catch{return false;}}
  decoded=decoded.replaceAll('\\','/');
  if(decoded==='/'||decoded==='/index.html'||decoded==='/@vite/client')return true;
  const filename=decoded==='/brand/gwi-mark.svg'?brandAsset:decoded.startsWith('/@fs/')?path.resolve(decoded.slice('/@fs/'.length)):path.resolve(root,'.'+decoded);
  const allowed=[path.join(root,'web'),path.join(root,'node_modules')];
  if(filename!==brandAsset&&filename!==path.join(root,'src/contracts.ts')&&!allowed.some(directory=>filename.startsWith(directory+path.sep)))return false;
  const actual=await realpath(filename).catch(()=>filename);
  return actual!==dataDirectory&&!actual.startsWith(dataDirectory+path.sep)&&(actual===brandAsset||actual===path.join(root,'src/contracts.ts')||allowed.some(directory=>actual.startsWith(directory+path.sep)));
}
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
const server=createServer(async(request,response)=>{
  try{
    demand(allowedHosts.has(request.headers.host??''),'INVALID_HOST','Unexpected host.',403);
    const url=new URL(request.url??'/',origin);
    if(url.pathname.startsWith('/api/')||url.pathname==='/mcp/control'){await api(request,response,url);return;}
    if(vite){demand(await publicDevelopmentPath(url),'PRIVATE_PATH','This path is not a public application asset.',403);vite.middlewares(request,response,()=>{if(!response.writableEnded){response.writeHead(404);response.end('Not found');}});return;}
    let filename=path.resolve(root,'dist','.'+decodeURIComponent(url.pathname));
    demand(filename===path.join(root,'dist')||filename.startsWith(path.join(root,'dist')+path.sep),'INVALID_PATH','Invalid asset path.',400);
    demand(filename!==dataDirectory&&!filename.startsWith(dataDirectory+path.sep),'PRIVATE_PATH','Runtime data is private.',403);
    if(url.pathname==='/')filename=path.join(root,'dist/index.html');
    demand((await stat(filename).catch(()=>null))?.isFile(),'NOT_FOUND','Public asset not found.',404);
    const bytes=await readFile(filename);response.writeHead(200,{'content-type':types[path.extname(filename)]??'application/octet-stream','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});response.end(bytes);
  }catch(error){if(response.headersSent){response.end();return;}if(error instanceof AppError)json(response,{error:{code:error.code,message:error.message,details:error.details}},error.status);else json(response,{error:{code:'INTERNAL_ERROR',message:error instanceof Error?error.message.slice(0,500):'Local operation failed.'}},500);}
});
server.listen(port,'127.0.0.1',()=>{engine.start();console.log(`GW-Iterator listening at ${origin}`);});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;server.close();await vite?.close();await adoptionService.close();await engine.close();controls.close();process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
