import {createHash} from 'node:crypto';
import type {Actor,Artifact,Pipeline,Run,TaskOutput} from './contracts.ts';
import type {Engine} from './engine.ts';
import type {BrowserObservation} from './browser-runtime.ts';
import type {ExecutionRecord} from './platform-execution.ts';
import {AppError,demand,isObject,text} from './validation.ts';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>isObject(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex');
const ended=(run:Pick<Run,'status'>)=>['completed','failed','interrupted','cancelled'].includes(run.status);
export {DELIVERY_PREPARATION_TOOLS as deliveryTools} from './contracts.ts';
export const deliveryPreparationPrompt='Prepare a concise delivery review from the actual candidate and recorded upstream evidence. Explain the requested result, changed behavior, actual checks, available preview/screenshots, unresolved checks and publication state. Cite actual source/artifact locations. Treat agent reports as reports; do not invent passed checks, URLs, CI or publication. Keep the candidate source unchanged. Do not implement, rerun accepted QA, publish, accept for the owner, or wait/poll for human or CI decisions. Return done when the review material is organized, with missing evidence stated explicitly.';
export type DeliveryChanges={sourceCommit:string;preparedCommit?:string;manifestHash:string;status:string;diff:string;untracked:{path:string;kind:string;content?:string;previewUnavailable?:boolean}[]};
export type DeliveryPublication={url:string;status:'observed'|'reported'|'unavailable';headSha?:string;state?:string;checks?:{name:string;status:string;conclusion?:string;url?:string}[]};
export type DeliveryBundle={
  key:string;runId:string;stageId:string;attemptId?:string;controlRevision:number;observedAt:string;request:string;stageName:string;ownerGate:boolean;status:Run['status'];stageStatus:Run['status'];
  upstream:{stageId:string;name:string;status:string;attemptId?:string;output?:TaskOutput}[];
  subject?:{stageId:string;name:string;status:string;attemptId?:string;output?:TaskOutput};
  source:{status:'observed';value:DeliveryChanges}|{status:'unavailable';code:string};sourceRequired:boolean;
  screenshots:{attemptId:string;stageId:string;url:string;observedAt:string;screenshotAt?:string;candidate:'matched'|'earlier'|'unbound'}[];publications:DeliveryPublication[];artifacts:Artifact[];
  preparations:{id:string;status:Run['status'];current:boolean;cleanupConfirmed:boolean;output?:TaskOutput}[];gaps:string[];
};
export type DeliveryRequest={idempotencyKey:string;bundleKey:string;attemptId:string;controlRevision:number;note?:string};
type PreparationReceipt={id:string;inputHash:string;runId:string};
type DecisionReceipt={id:string;inputHash:string;run:Run;bundle:DeliveryBundle;actor:Actor;decision:'accept'|'revise'};
type Options={changes?:(runId:string)=>Promise<DeliveryChanges>;publication?:(repository:string,url:string)=>Promise<DeliveryPublication>};

/** Assemble evidence without model work; paid preparation is a separate explicit action. */
export class DeliveryReviewService {
  private engine:Engine;private options:Options;
  private publications=new Map<string,{at:number;value:Promise<DeliveryPublication>}>();
  private pending=new Map<string,{identity:string;promise:Promise<Run>}>();
  constructor(engine:Engine,options:Options={}){this.engine=engine;this.options=options;}
  private target(runId:string,stageId:string,actor:Actor){
    const run=this.engine.run(runId);this.engine.detail(run.projectId,actor);
    const stage=run.snapshot.pipeline.stages.find(stage=>stage.id===stageId),state=run.stages.find(stage=>stage.stageId===stageId);
    demand(stage&&state&&(stage.executor==='manual'||stage.review),'INVALID_REVIEW_TARGET','Choose a manual handoff or review stage.',409);
    return{run,stage,state};
  }
  private current(runId:string,stageId:string,input:DeliveryRequest,actor:Actor){
    const value=this.target(runId,stageId,actor),{run,state,stage}=value,goal=this.engine.intake?.allowance?.(runId);
    demand(!run.cancelRequested&&!ended(run)&&!['stopped','completed'].includes(goal?.status??''),'REVIEW_CLOSED','This delivery is no longer awaiting a decision.',409);
    demand((stage.executor==='manual'&&state.status==='waiting'&&!state.allowanceHold)||state.status==='review','INVALID_REVIEW_TARGET','This stage is not awaiting delivery review.',409);
    demand(state.attempts.at(-1)?.id===input.attemptId&&(run.controlRevision??0)===input.controlRevision,'REVIEW_CONFLICT','The delivery attempt or control revision changed. Refresh its evidence.',409);
    return value;
  }
  private validate(input:DeliveryRequest){
    demand(isObject(input)&&text(input.idempotencyKey,160)&&text(input.bundleKey,160)&&text(input.attemptId,160)&&Number.isSafeInteger(input.controlRevision)&&input.controlRevision>=0&&(input.note===undefined||typeof input.note==='string'&&input.note.length<=2000),'INVALID_REVIEW_REQUEST','Choose the current evidence and a stable request identity.');
  }
  private once(runId:string,stageId:string,action:string,input:DeliveryRequest,operation:()=>Promise<Run>):Promise<Run>{
    const key=digest([runId,stageId]),identity=digest([action,input]),previous=this.pending.get(key);
    if(previous){demand(previous.identity===identity,'REVIEW_CONFLICT','Another decision or preparation is in progress. Observe its result before changing the request.',409);return previous.promise;}
    const promise=operation().finally(()=>{if(this.pending.get(key)?.promise===promise)this.pending.delete(key);});this.pending.set(key,{identity,promise});return promise;
  }
  async prepare(runId:string,stageId:string,input:DeliveryRequest,actor:Actor):Promise<Run>{
    this.validate(input);this.target(runId,stageId,actor);demand(actor.kind==='human'&&!actor.projectId,'OWNER_REQUIRED','Only the local owner may request a delivery preparation execution.',403);
    return this.once(runId,stageId,'prepare',input,()=>this.prepareOnce(runId,stageId,input,actor));
  }
  async decide(runId:string,stageId:string,input:DeliveryRequest&{decision:'accept'|'revise'},actor:Actor):Promise<Run>{
    this.validate(input);const {stage}=this.target(runId,stageId,actor);if(stage.ownerGate)demand(actor.kind==='human'&&!actor.projectId,'OWNER_REQUIRED','Only the local owner may accept this delivery.',403);
    return this.once(runId,stageId,'decide',input,()=>this.decideOnce(runId,stageId,input,actor));
  }
  async bundle(runId:string,stageId:string,actor:Actor):Promise<DeliveryBundle>{
    const {run,stage,state}=this.target(runId,stageId,actor),ids=new Set<string>();
    const visit=(id:string)=>{if(ids.has(id))return;ids.add(id);for(const parent of run.snapshot.pipeline.stages.find(stage=>stage.id===id)?.dependsOn??[])visit(parent);};
    for(const id of stage.dependsOn)visit(id);
    const upstream=run.snapshot.pipeline.stages.filter(stage=>ids.has(stage.id)).map(definition=>{const current=run.stages.find(stage=>stage.stageId===definition.id)!,attempt=current.attempts.at(-1);return{stageId:definition.id,name:definition.name,status:current.status,attemptId:attempt?.id,...(attempt?.output?{output:attempt.output}:{})};});
    const subject=state.status==='review'?{stageId:stage.id,name:stage.name,status:state.status,attemptId:state.attempts.at(-1)?.id,output:state.attempts.at(-1)?.output}:undefined,evidence=[...upstream,...(subject?[subject]:[])];
    let source:DeliveryBundle['source'];try{demand(this.options.changes,'EXECUTION_WORKSPACE_UNAVAILABLE','This execution has no prepared source observation.',409);source={status:'observed',value:await this.options.changes(runId)};}catch(error){source={status:'unavailable',code:error instanceof AppError?error.code:'REVIEW_SOURCE_UNAVAILABLE'};}
    const support=this.engine.store.list<Run>('run').filter(child=>child.reviewSupport?.runId===runId&&child.reviewSupport.stageId===stageId);
    const preparations=support.map(child=>({id:child.id,status:child.status,cleanupConfirmed:this.engine.executionSettled(child.id),current:child.reviewSupport!.attemptId===state.attempts.at(-1)?.id&&child.reviewSupport!.controlRevision===(run.controlRevision??0)&&source.status==='observed'&&child.reviewSupport!.sourceManifestHash===source.value.manifestHash,...(child.stages[0]?.attempts.at(-1)?.output?{output:child.stages[0].attempts.at(-1)!.output}:{})}));
    const acceptedAttempts=new Set(evidence.map(item=>item.attemptId));for(const child of support)if(preparations.find(item=>item.id===child.id)?.current)acceptedAttempts.add(child.stages[0]?.attempts.at(-1)?.id);
    const screenshots=this.engine.store.list<BrowserObservation>('browser-session').filter(row=>row.projectId===run.projectId&&acceptedAttempts.has(row.id)&&!!row.screenshot).map(row=>{const execution=this.engine.store.get<ExecutionRecord>('multica-execution',row.id),hash=execution?.projectId===run.projectId&&execution.runId===row.runId?execution.verification?.manifestHash:undefined;return{attemptId:row.id,stageId:row.stageId,url:`/api/runs/${encodeURIComponent(row.runId)}/browser-evidence/${encodeURIComponent(row.id)}`,observedAt:row.updatedAt,...(row.screenshotAt?{screenshotAt:row.screenshotAt}:{}),candidate:!hash||source.status!=='observed'||!execution?.verification?.check?.unchanged?'unbound' as const:hash===source.value.manifestHash?'matched' as const:'earlier' as const};});
    const artifacts=[...new Map([...evidence.flatMap(item=>item.output?.artifacts??[]),...preparations.filter(item=>item.current).flatMap(item=>item.output?.artifacts??[])].map(artifact=>[JSON.stringify(artifact),artifact])).values()];
    const publications:DeliveryPublication[]=[];
    for(const url of [...new Set(artifacts.map(artifact=>artifact.url).filter((value):value is string=>!!value))]){
      let parsed:URL;try{parsed=new URL(url);}catch{continue;}
      if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||!/^\/[^/]+\/[^/]+\/(pull\/\d+|actions\/runs\/\d+)\/?$/.test(parsed.pathname))continue;
      const key=run.snapshot.project.repository+' '+url;let cached=this.publications.get(key);
      if(!cached||Date.now()-cached.at>30000){const value=this.options.publication?this.options.publication(run.snapshot.project.repository,url).catch(()=>({url,status:'unavailable' as const})):Promise.resolve({url,status:'reported' as const});cached={at:Date.now(),value};this.publications.set(key,cached);}
      publications.push(await cached.value);
    }
    const gaps=[...(source.status==='unavailable'?['source']:[]),...(!evidence.some(item=>{const stage=run.snapshot.pipeline.stages.find(stage=>stage.id===item.stageId);return stage?.roleId==='qa'||stage?.executionPurpose==='review'&&!stage.deliveryPreparation;})?['independent-check']:[]),...(!screenshots.length&&!artifacts.some(artifact=>artifact.url&&!artifact.url.includes('github.com'))?['preview']:[]),...(!publications.length?['publication']:[])];
    if(publications.length&&source.status==='observed'){const latest=await this.options.changes!(runId);demand(latest.manifestHash===source.value.manifestHash,'REVIEW_CONFLICT','The candidate changed during publication observation. Refresh its evidence.',409);}
    const basis={runId,stageId,attemptId:state.attempts.at(-1)?.id,controlRevision:run.controlRevision??0,request:run.goal,stageName:stage.name,ownerGate:stage.ownerGate===true,status:run.status,stageStatus:state.status,upstream,...(subject?{subject}:{}),source,sourceRequired:stage.executor==='codex'||upstream.some(item=>run.snapshot.pipeline.stages.find(stage=>stage.id===item.stageId)?.executor==='codex'),screenshots,publications,artifacts,preparations,gaps};
    const fresh=this.target(runId,stageId,actor);demand((fresh.run.controlRevision??0)===(run.controlRevision??0)&&fresh.state.status===state.status&&digest(fresh.run.stages)===digest(run.stages),'REVIEW_CONFLICT','The delivery changed while its evidence was inspected.',409);
    return{...basis,key:digest({...basis,screenshots:screenshots.map(({observedAt,...value})=>value)}),observedAt:new Date().toISOString()};
  }
  private async prepareOnce(runId:string,stageId:string,input:DeliveryRequest,actor:Actor):Promise<Run>{
    this.validate(input);const {run}=this.target(runId,stageId,actor);demand(actor.kind==='human'&&!actor.projectId,'OWNER_REQUIRED','Only the local owner may request a delivery preparation execution.',403);
    const id=digest([runId,stageId,input.idempotencyKey]),inputHash=digest(input),saved=this.engine.store.get<PreparationReceipt>('delivery-preparation',id);
    if(saved){demand(saved.inputHash===inputHash,'IDEMPOTENCY_CONFLICT','This preparation identity already records different instructions.',409);return this.engine.run(saved.runId);}
    demand(this.engine.agentExecutor,'VERIFICATION_CAPABILITY_UNAVAILABLE','Connect the protected execution service before preparing review material.',409);
    const initial=this.current(runId,stageId,input,actor);demand(!initial.run.pausedAt&&initial.run.status!=='paused','RUN_PAUSED','Resume the parent delivery before preparing new material.',409);const {stage}=initial,bundle=await this.bundle(runId,stageId,actor);
    demand(bundle.key===input.bundleKey,'REVIEW_CONFLICT','The review evidence changed. Refresh before preparing more material.',409);
    demand(bundle.source.status==='observed','REVIEW_SOURCE_UNAVAILABLE','Restore the original prepared checkout before requesting review material.',409);
    const sourceManifestHash=bundle.source.value.manifestHash,note=input.note?.trim()??'',inputs=[...bundle.upstream,...(bundle.subject?[bundle.subject]:[])],basisKey=digest([runId,stageId,input.attemptId,input.controlRevision,sourceManifestHash,inputs,bundle.publications,note]);
    const existing=this.engine.store.list<Run>('run').find(child=>child.projectId===run.projectId&&child.idempotencyKey==='review-material:'+basisKey);
    const active=this.engine.store.list<Run>('run').find(child=>child.reviewSupport?.runId===runId&&child.reviewSupport.stageId===stageId&&(!ended(child)||!this.engine.executionSettled(child.id)));
    demand(!active||active.id===existing?.id,'REVIEW_PREPARATION_ACTIVE','The linked preparation is running or its termination is unconfirmed. Inspect it before another request.',409);
    const role=run.snapshot.project.roles.find(role=>role.id===stage.roleId)!;
    const pipeline:Pipeline={id:'review-material-'+basisKey.slice(0,32),projectId:run.projectId,revision:1,name:'Prepare delivery review material',description:'Organize retained evidence without advancing its human decision.',roleId:role.id,policy:{},updatedAt:new Date().toISOString(),stages:[{id:'prepare-review',name:'Prepare review material',roleId:role.id,executor:'codex',executionPurpose:'review',deliveryPreparation:true,dependsOn:[],review:false,prompt:deliveryPreparationPrompt+(note?'\nAdditional owner instructions:\n'+note:'')}]};
    let child:Run;
    this.engine.store.transaction(()=>{
      const current=this.current(runId,stageId,input,actor);demand(!current.run.pausedAt&&current.run.status!=='paused','RUN_PAUSED','Resume the parent delivery before preparing new material.',409);
      child=existing??this.engine.startRun({projectId:run.projectId,pipelineId:pipeline.id,goal:('Prepare review material for the retained delivery: '+run.goal).slice(0,20000),baseline:run.baseline,idempotencyKey:'review-material:'+basisKey,parentRunId:runId,parentStageId:stageId},actor,{...run.snapshot,pipeline,pipelines:[...run.snapshot.pipelines,pipeline]},undefined,undefined,undefined,{deferDispatch:true,reviewSupport:{runId,stageId,attemptId:input.attemptId,controlRevision:input.controlRevision,sourceManifestHash,upstream:inputs.map(({status,...value})=>value)}});
      this.engine.store.put('delivery-preparation',{id,inputHash,runId:child!.id} satisfies PreparationReceipt);
    });
    void this.engine.tick();return child!;
  }
  private async decideOnce(runId:string,stageId:string,input:DeliveryRequest&{decision:'accept'|'revise'},actor:Actor):Promise<Run>{
    this.validate(input);demand(['accept','revise'].includes(input.decision)&& (input.decision!=='revise'||text(input.note?.trim(),2000)),'REVIEW_FINDING_REQUIRED','Request changes with a concrete finding.');
    const {run}=this.target(runId,stageId,actor),id=digest([runId,stageId,input.idempotencyKey]),inputHash=digest(input),saved=this.engine.store.get<DecisionReceipt>('delivery-decision',id);
    if(saved){demand(saved.inputHash===inputHash,'IDEMPOTENCY_CONFLICT','This decision identity already records different instructions.',409);return saved.run;}
    this.current(runId,stageId,input,actor);const bundle=await this.bundle(runId,stageId,actor);demand(bundle.key===input.bundleKey,'REVIEW_CONFLICT','The review evidence changed. Inspect the current material before deciding.',409);
    demand(!bundle.preparations.some(child=>!ended(child)||!child.cleanupConfirmed),'REVIEW_PREPARATION_ACTIVE','Wait for or confirm the linked preparation ended before deciding.',409);
    if(input.decision==='accept'&&bundle.sourceRequired)demand(bundle.source.status==='observed','REVIEW_SOURCE_UNAVAILABLE','Restore the original prepared candidate before accepting its delivery.',409);
    if(bundle.source.status==='observed'){const latest=await this.options.changes!(runId);demand(latest.manifestHash===bundle.source.value.manifestHash,'REVIEW_CONFLICT','The candidate changed before the decision. Refresh its evidence.',409);}
    let receipt:Run;
    this.engine.store.transaction(()=>{const {stage,state}=this.current(runId,stageId,input,actor);
      const note=input.note?.trim()||(input.decision==='accept'?'Accepted the recorded delivery evidence.':'Changes requested.');
      receipt=state.status!=='review'&&stage.executor==='manual'?this.engine.completeManual(runId,stageId,{outcome:input.decision==='accept'?'done':'revise',summary:note,artifacts:bundle.artifacts,observations:bundle.gaps.map(value=>'No independently observed '+value+' evidence is included in this decision.')},actor,{deferDispatch:true}):this.engine.review(runId,stageId,input.decision==='accept'?'accept':'revise',note,actor,{deferDispatch:true});
      this.engine.store.put('delivery-decision',{id,inputHash,run:receipt!,bundle,actor,decision:input.decision} satisfies DecisionReceipt);
    });void this.engine.tick();return receipt!;
  }
}
