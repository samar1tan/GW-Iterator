import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {Actor,KnowledgeEntry,Project} from '../src/contracts.ts';
import type {KnowledgeFeedbackInput,KnowledgeRelationshipInput,LessonReviewInput} from '../src/knowledge-context-types.ts';
import {KnowledgeContextService} from '../src/knowledge-context.ts';
import {effectiveKnowledgeRelationships,recordKnowledgeFeedback,recordKnowledgeRelationship,reviewKnowledgeLesson} from '../src/knowledge.ts';
import {Store} from '../src/store.ts';

const at='2026-01-01T00:00:00Z',owner:Actor={name:'Synthetic owner',kind:'human'},worker:Actor={name:'qa',kind:'agent',projectId:'synthetic-project',tools:['knowledge.write']};
const hash=(body:string)=>createHash('sha256').update(body).digest('hex');
function entry(id:string,content:string,extra:Partial<KnowledgeEntry>={}):KnowledgeEntry{return{id,projectId:'synthetic-project',sourceId:'synthetic-source',kind:'lesson',roles:[],title:id,content,hash:hash(content),revision:1,status:'current',syncedAt:at,...extra};}
const ref=(value:KnowledgeEntry)=>({entryId:value.id,revision:value.revision,hash:value.hash});
async function fixture(t:test.TestContext){const directory=await mkdtemp(join(tmpdir(),'gwi-governance-test-')),store=new Store(directory),service=new KnowledgeContextService(store),project={id:'synthetic-project',revision:1,roles:[{id:'qa'}]} as Project;t.after(async()=>{service.close();store.close();await rm(directory,{recursive:true,force:true});});return{store,service,project};}

test('feedback validates exact project evidence and its originating selection without promoting source authority',async t=>{
  const h=await fixture(t),source=entry('evidence','ACK_RECEIPT must survive refresh.'),foreign=entry('foreign','Foreign material.',{projectId:'synthetic-other'});for(const value of [source,foreign])h.store.put('knowledge',value);
  const corpus=h.service.freeze({project:h.project,entries:[source],origin:'registered-live'}),plan=h.service.select({projectId:h.project.id,corpusId:corpus.id,runId:'synthetic-origin',stageId:'verify',attemptId:'synthetic-attempt',roleId:'qa'},{request:'ACK_RECEIPT'}),before=structuredClone(h.store.get('knowledge',source.id));
  const value=recordKnowledgeFeedback(h.store,h.project.id,{kind:'outdated',reference:{...ref(source),corpusId:corpus.id},selectionId:plan.id,note:'A synthetic observation needs owner review.'},worker,{runId:'synthetic-origin',roleId:'qa'});assert.equal(value.status,'recorded');assert.deepEqual(h.store.get('knowledge',source.id),before);assert.equal(h.service.corpus(corpus.id,h.project.id).relationships.length,0);
  assert.throws(()=>recordKnowledgeFeedback(h.store,h.project.id,{kind:'conflict',reference:ref(foreign)},worker),{code:'KNOWLEDGE_REFERENCE_CHANGED'});
  assert.throws(()=>recordKnowledgeFeedback(h.store,h.project.id,{kind:'conflict',reference:ref(source),selectionId:plan.id},worker,{runId:'wrong-origin',roleId:'qa'}),{code:'KNOWLEDGE_SCOPE'});
  assert.throws(()=>recordKnowledgeFeedback(h.store,h.project.id,{kind:'relevant',reference:ref(source),evidence:{bad:true}} as unknown as KnowledgeFeedbackInput,worker),{code:'INVALID_KNOWLEDGE_FEEDBACK'});
  h.store.put('knowledge-corpus',{id:'foreign-manifest',manifest:{projectId:'synthetic-other'},entries:[source]});assert.throws(()=>recordKnowledgeFeedback(h.store,h.project.id,{kind:'relevant',reference:{...ref(source),corpusId:'foreign-manifest'}},worker),{code:'KNOWLEDGE_REFERENCE_CHANGED'});
});

test('owner relationships resolve the latest exact pair without changing earlier captured authority',async t=>{
  const h=await fixture(t),first=entry('rule-one','Keep ACK_RECEIPT.',{purpose:'guidance'}),second=entry('rule-two','Discard ACK_RECEIPT.',{purpose:'guidance'});for(const value of [first,second])h.store.put('knowledge',value);
  const input:KnowledgeRelationshipInput={kind:'conflicts',from:ref(first),to:ref(second),note:'Two exact synthetic required rules disagree.'};assert.throws(()=>recordKnowledgeRelationship(h.store,h.project.id,input,worker),{code:'OWNER_REQUIRED'});
  const conflict=recordKnowledgeRelationship(h.store,h.project.id,input,owner),frozen=h.service.freeze({project:h.project,entries:[first,second],origin:'registered-live'}),scope={projectId:h.project.id,corpusId:frozen.id,runId:'synthetic-run',stageId:'verify',attemptId:'synthetic-attempt',roleId:'qa'};assert.equal(h.service.select(scope,{request:'ACK_RECEIPT'}).status,'blocked');
  const resolved=recordKnowledgeRelationship(h.store,h.project.id,{kind:'conflicts',from:ref(second),to:ref(first),resolved:true,note:'Owner resolved this exact pair after evidence review.'},owner);assert.equal(resolved.revision,conflict.revision+1);assert.deepEqual(effectiveKnowledgeRelationships(h.store.list('knowledge-relationship')),[resolved]);
  const fresh=h.service.freeze({project:h.project,entries:[first,second],origin:'registered-live'});assert.equal(h.service.select({...scope,corpusId:fresh.id},{request:'ACK_RECEIPT'}).status,'ready');assert.equal(h.service.select(scope,{request:'ACK_RECEIPT'}).status,'blocked');
  assert.throws(()=>recordKnowledgeRelationship(h.store,h.project.id,{...input,evidence:'invalid'} as unknown as KnowledgeRelationshipInput,owner),{code:'INVALID_KNOWLEDGE_RELATIONSHIP'});assert.equal(h.store.list('knowledge-relationship').length,2);
});

test('proposal reviews keep original content and origin, require current lifecycle CAS and reject malformed evidence',async t=>{
  const h=await fixture(t),original=entry('proposal','Original agent claim.',{status:'proposed',originRunId:'synthetic-origin'});original.proposal={status:'pending',at,actor:'qa',permission:'knowledge.write',roleId:'qa',originRunId:'synthetic-origin',original:{title:original.title,content:original.content,roles:original.roles,hash:original.hash}};h.store.put('knowledge',original);
  const input:LessonReviewInput={expectedRevision:1,expectedLifecycleRevision:0,decision:'retain'};assert.throws(()=>reviewKnowledgeLesson(h.store,h.project,original.id,{...input,expectedLifecycleRevision:1},owner),{code:'REVISION_CONFLICT'});assert.throws(()=>reviewKnowledgeLesson(h.store,h.project,original.id,{...input,evidence:{}} as unknown as LessonReviewInput,owner),{code:'INVALID_LESSON_REVIEW'});assert.deepEqual(h.store.get('knowledge',original.id),original);
  const retained=reviewKnowledgeLesson(h.store,h.project,original.id,{...input,content:'Owner revised the claim against synthetic evidence.',roles:['qa'],note:'Source evidence is retained.'},owner);assert.equal(retained.status,'current');assert.equal(retained.revision,2);assert.equal(retained.lifecycleRevision,1);assert.equal(retained.originRunId,original.originRunId);assert.deepEqual(retained.proposal!.original,original.proposal.original);assert.equal(retained.proposal!.review!.actor,owner.name);
  const unchanged=entry('unchanged','Retain this exact original.',{status:'proposed'});unchanged.proposal={...original.proposal,original:{title:unchanged.title,content:unchanged.content,roles:unchanged.roles,hash:unchanged.hash}};h.store.put('knowledge',unchanged);const accepted=reviewKnowledgeLesson(h.store,h.project,unchanged.id,input,owner);assert.equal(accepted.hash,unchanged.hash);assert.equal(accepted.revision,1);assert.equal(accepted.lifecycleRevision,1);
});
