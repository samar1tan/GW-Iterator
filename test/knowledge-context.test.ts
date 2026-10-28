import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {KnowledgeContextService,knowledgeContextSummary,boundedKnowledgeToolReply} from '../src/knowledge-context.ts';
import type {KnowledgeEntry,Project} from '../src/contracts.ts';
import type {KnowledgeContextScope,KnowledgeRelationship} from '../src/knowledge-context-types.ts';

const at='2026-01-01T00:00:00Z',digest=(content:string)=>createHash('sha256').update(content).digest('hex');
function entry(id:string,content:string,values:Partial<KnowledgeEntry>={}):KnowledgeEntry{return{id,projectId:'synthetic-project',sourceId:id,kind:'document',roles:[],title:id,content,hash:digest(content),revision:1,status:'current',syncedAt:at,sourcePath:'/synthetic/docs/'+id+'.md',...values};}
async function fixture(t:test.TestContext){const directory=await mkdtemp(join(tmpdir(),'gwi-context-test-')),store=new Store(directory),service=new KnowledgeContextService(store),project={id:'synthetic-project',revision:1} as Project;t.after(async()=>{service.close();store.close();await rm(directory,{recursive:true,force:true});});return{store,service,project,freeze:(entries:KnowledgeEntry[],origin:'registered-live'|'legacy-frozen'='legacy-frozen')=>service.freeze({project,entries,origin}),scope:(corpusId:string):KnowledgeContextScope=>({projectId:project.id,corpusId,runId:'synthetic-run',stageId:'verify',attemptId:'synthetic-attempt',roleId:'qa'})};}

test('passage retrieval reaches document six and deep evidence with real source lines instead of document heads',async t=>{
  const h=await fixture(t),target=entry('receipt-recovery',Array.from({length:240},()=> 'Seasonal tree observations.').join('\n')+'\n## Receipt restoration\nACK_RECEIPT must survive a failed refresh.',{sourceLineStart:31}),corpus=h.freeze([...Array.from({length:5},(_,i)=>entry('garden-'+i,'Leaves and sunlight.')),target]),scope=h.scope(corpus.id);
  const plan=h.service.select(scope,{request:'Repair ACK_RECEIPT restoration.'}),selected=plan.evidence.find(item=>item.id===target.id)!;
  assert.ok(selected);assert.ok(selected.content.includes('ACK_RECEIPT'));assert.ok(selected.locator.startLine>=271);assert.ok(selected.locator.headingPath.includes('Receipt restoration'));
  const page=await h.service.search(scope,{query:'ACK_RECEIPT'}),read=await h.service.read(scope,page.matches[0].locator);assert.ok(read.passage.content.includes('ACK_RECEIPT'));
  assert.equal(plan.budget.usedChars,plan.context.length);assert.ok(plan.context.length<=plan.budget.limitChars);
  await assert.rejects(h.service.read(scope,{...selected.locator,endLine:999}),{code:'KNOWLEDGE_LOCATION_CHANGED'});
});

test('source order and another project do not change frozen-corpus ranking or turn no match into first documents',async t=>{
  const h=await fixture(t),sources=[entry('alpha','zqx_receipt requires exact reconciliation.'),entry('beta','Botanical notes.'),entry('gamma','zqx_receipt has an owner acceptance check.')],first=h.freeze(sources),second=h.freeze([...sources].reverse());
  const choose=(id:string)=>h.service.select(h.scope(id),{request:'Investigate zqx_receipt.'}).evidence.map(item=>[item.id,item.locator.startLine]);
  const baseline=choose(first.id);assert.deepEqual(choose(second.id),baseline);
  const other={id:'synthetic-other-project',revision:1} as Project;h.service.freeze({project:other,entries:Array.from({length:30},(_,i)=>entry('foreign-'+i,'zqx_receipt '.repeat(100),{projectId:other.id})),origin:'legacy-frozen'});
  assert.deepEqual(choose(first.id),baseline);assert.equal(h.service.select(h.scope(first.id),{request:'unfindablekzqx'}).evidence.length,0);
});

test('complete guidance is never silently cut, while missing guidance only blocks its dispatched role',async t=>{
  const h=await fixture(t),body='FIRST_REQUIRED_RULE\n'+'Keep exact references.\n'.repeat(180)+'LAST_REQUIRED_RULE',guide=entry('owned-guide',body,{purpose:'guidance',purposeOrigin:'owner',roles:['qa']}),missing=entry('developer-guide','',{status:'missing',purpose:'guidance',roles:['development'],error:'Synthetic missing registered guidance.'}),corpus=h.freeze([guide,missing]),scope=h.scope(corpus.id);
  const ready=h.service.select(scope,{request:'Check exact references.'});assert.equal(ready.status,'ready');assert.equal(ready.guidance.map(item=>item.content).join('').replace(/\s/g,''),body.replace(/\s/g,''));
  const blocked=h.service.select(scope,{request:'Check exact references.'},{limitChars:700});assert.equal(blocked.status,'blocked');assert.ok(blocked.gaps.some(gap=>gap.code==='GUIDANCE_OVERFLOW'));assert.ok(blocked.guidance.some(item=>item.content.includes('LAST_REQUIRED_RULE')));
  assert.equal(h.service.select({...scope,roleId:'development'},{request:'Prepare a source change.'}).status,'blocked');
});

test('dependency results and rework have priority over optional lexical evidence and oversized items keep exact read pointers',async t=>{
  const h=await fixture(t),corpus=h.freeze([entry('many-references',('ACK_RECEIPT optional explanation.\n').repeat(300))]),scope=h.scope(corpus.id),summary='ACTUAL_ACCEPTED_RESULT '+('x'.repeat(2500));
  const plan=h.service.select(scope,{request:'Check ACK_RECEIPT.',upstream:[{stage:'prepare',output:{outcome:'done',summary}}],feedback:[{review:{decision:'revise',note:'ACTUAL_REWORK_FINDING'}}]},{limitChars:6000});
  const context=JSON.parse(plan.context);assert.equal(context.upstream[0].output.summary,summary);assert.equal(context.feedback[0].review.note,'ACTUAL_REWORK_FINDING');assert.ok(plan.context.length<=6000);
  const large='FIRST_ACTUAL_FACT '+('long content '.repeat(700))+' FINAL_ACTUAL_FACT',located=h.service.select(scope,{request:'Check ACK_RECEIPT.',upstream:[{stage:'prepare',summary:large}]},{limitChars:1500}),gap=located.gaps.find(item=>item.locator)!;
  assert.ok(gap?.locator);let next=gap.locator,readText='';for(let i=0;i<30;i++){const result=await h.service.read(located.scope,next);readText+=result.passage.content;if(!result.next)break;next=result.next;}
  assert.ok(readText.includes('FIRST_ACTUAL_FACT'));assert.ok(readText.includes('FINAL_ACTUAL_FACT'));assert.equal(h.store.list('knowledge').length,0,'Upstream evidence is not promoted into project knowledge.');
});

test('selection reasons name the actual task, check or upstream facet',async t=>{
  const h=await fixture(t),corpus=h.freeze([entry('task-source','taskomega applies here.'),entry('check-source','checklambda validation evidence.'),entry('upstream-source','upstreamtheta defect evidence.')]),plan=h.service.select(h.scope(corpus.id),{request:'taskomega',stage:{name:'Verify',prompt:'Perform the independent check.',checks:['checklambda']},upstream:[{summary:'upstreamtheta'}]});
  assert.ok(plan.evidence.find(item=>item.id==='task-source')?.reasons.includes('TASK_TEXT'));
  const checked=plan.evidence.find(item=>item.id==='check-source')!;assert.ok(checked.reasons.includes('STAGE_CHECK'));assert.ok(!checked.reasons.includes('TASK_TEXT'));
  const upstream=plan.evidence.find(item=>item.id==='upstream-source')!;assert.ok(upstream.reasons.includes('UPSTREAM_FINDING'));assert.ok(!upstream.reasons.includes('TASK_TEXT'));
});

test('role tags guide default selection while explicit role/all lookup and located reads remain project scoped',async t=>{
  const h=await fixture(t),qa=entry('qa-source','ACK_RECEIPT testing',{roles:['qa']}),development=entry('development-source','ACK_RECEIPT implementation',{roles:['development']}),corpus=h.freeze([qa,development]),scope=h.scope(corpus.id);
  assert.deepEqual(h.service.select(scope,{request:'ACK_RECEIPT'}).evidence.map(item=>item.id),[qa.id]);
  assert.deepEqual((await h.service.search(scope,{query:'ACK_RECEIPT'})).matches.map(item=>item.id),[qa.id]);
  const requested=await h.service.search(scope,{query:'ACK_RECEIPT',role:'development'});assert.equal(requested.matches[0].id,development.id);assert.equal((await h.service.read(scope,requested.matches[0].locator)).passage.id,development.id);
  assert.equal((await h.service.search(scope,{query:'ACK_RECEIPT',role:'all'})).matches.length,2);
  await assert.rejects(h.service.read({...scope,projectId:'synthetic-other-project'},requested.matches[0].locator),{code:'KNOWLEDGE_SCOPE'});
});

test('archived/proposed/declined entries stay out, and legacy snapshots never acquire current governance authority',async t=>{
  const h=await fixture(t),guide=entry('guide','Never erase ACK_RECEIPT.',{purpose:'guidance'}),other=entry('other-guide','Preserve ACK_RECEIPT history.',{purpose:'guidance'}),excluded=[entry('archived','ACK_RECEIPT',{status:'archived'}),entry('proposal','ACK_RECEIPT',{status:'proposed'}),entry('declined','ACK_RECEIPT',{status:'declined'})];
  const reference=(value:KnowledgeEntry)=>({entryId:value.id,revision:value.revision,hash:value.hash}),relation:KnowledgeRelationship={id:'synthetic-relation',projectId:h.project.id,kind:'conflicts',from:reference(guide),to:reference(other),note:'An owner-confirmed unresolved rule conflict.',revision:1,ownerConfirmed:true,at,actor:'Synthetic owner'};h.store.put('knowledge-relationship',relation);
  const current=h.freeze([guide,other,...excluded],'registered-live');assert.equal(h.service.select(h.scope(current.id),{request:'ACK_RECEIPT'}).status,'blocked');assert.equal(current.entries.length,2);
  const legacy=h.freeze([guide,other],'legacy-frozen');assert.equal(legacy.relationships.length,0);assert.equal(h.service.select(h.scope(legacy.id),{request:'ACK_RECEIPT'}).status,'ready');
  h.store.put('knowledge-relationship',{...relation,id:'synthetic-resolved',revision:2,resolved:true});const resolved=h.freeze([guide,other],'registered-live');assert.equal(h.service.select(h.scope(resolved.id),{request:'ACK_RECEIPT'}).status,'ready');assert.equal(h.service.select(h.scope(current.id),{request:'ACK_RECEIPT'}).status,'blocked');
});

test('duplicate text keeps provenance aliases without breaking the serialized bound',async t=>{
  const h=await fixture(t),text='ACK_RECEIPT and all of its durable history must be retained.',corpus=h.freeze(Array.from({length:20},(_,i)=>entry('alias-'+i,text))),plan=h.service.select(h.scope(corpus.id),{request:'ACK_RECEIPT'},{limitChars:1200});
  assert.equal(plan.evidence.length,1);assert.equal(plan.evidence[0].aliases.length,19);assert.ok(plan.context.length<=1200);
});

test('title/path/ancestor headings do not fan out into unrelated paragraphs around deep useful evidence',async t=>{
  const h=await fixture(t),padding=Array.from({length:90},(_,i)=>`Botanical observation ${i}: rain and leaf shapes vary seasonally.`),content=['# Receipt reconciliation',...padding,'## Durable ACK_RECEIPT','The ACK_RECEIPT is consumed before the later metadata refresh.',...padding].join('\n\n'),corpus=h.freeze([entry('receipt-reconciliation',content,{title:'Receipt reconciliation',sourcePath:'/synthetic/docs/receipt-reconciliation.md'})]);
  const plan=h.service.select(h.scope(corpus.id),{request:'Repair ACK_RECEIPT in /synthetic/docs/receipt-reconciliation.md.'});
  assert.ok(plan.evidence.some(item=>item.content.includes('consumed before')));assert.ok(plan.evidence.every(item=>!item.content.includes('Botanical observation')));assert.ok(plan.omissions.some(item=>item.reason==='METADATA_ONLY'&&item.passages>=90));assert.ok(plan.evidence.every(item=>!item.content.startsWith('#')),'A matching heading is not body evidence.');
  assert.ok(plan.context.length<4000,'Do not fill the envelope with a matching document.');
});

test('an exact metadata-only discovery has one bounded anchor and frozen continuation, not fabricated task evidence',async t=>{
  const h=await fixture(t),corpus=h.freeze([entry('orchard-handbook','# Orchard handbook\n\nRainfall varies annually.\n\nDormancy ends with warmer weather.',{title:'Orchard handbook',sourcePath:'/synthetic/guides/orchard-handbook.md'})]),scope=h.scope(corpus.id),query='Read /synthetic/guides/orchard-handbook.md';
  const plan=h.service.select(scope,{request:query});assert.equal(plan.evidence.length,1);assert.ok(plan.evidence[0].reasons.includes('DOCUMENT_DISCOVERY'));assert.ok(!plan.evidence[0].reasons.includes('TASK_TEXT'));assert.ok(plan.gaps.some(gap=>gap.code==='DISCOVERY_ONLY'));assert.equal(JSON.parse(plan.context).coverage.discoveryOnly,true);assert.ok(plan.evidence[0].content.length<=2000);
  const search=await h.service.search(scope,{query});assert.equal(search.coverage,'discovery');assert.equal(search.matches.length,1);const read=await h.service.read(scope,search.matches[0].locator);assert.ok(read.passage.content.includes('Dormancy'));assert.equal(read.complete,true);assert.equal((await h.service.read(scope,read.passage.locator)).passage.content,read.passage.content);
});

test('code and list chunks preserve real source locations without treating fenced hash lines as headings',async t=>{
  const h=await fixture(t),content='# Source guide\n\n- ACK_LIST is checked first.\n- ANOTHER_CHECK follows.\n\n```sh\n# ACK_SCRIPT is a shell comment\nprintf ACK_SCRIPT\n```',corpus=h.freeze([entry('code-guide',content)]),scope=h.scope(corpus.id);
  const code=await h.service.search(scope,{query:'ACK_SCRIPT'});assert.equal(code.matches.length,1);assert.equal(code.matches[0].content,content);assert.deepEqual(code.matches[0].locator.headingPath,['Source guide']);assert.equal(code.matches[0].locator.startLine,1);assert.equal(code.matches[0].locator.endLine,9);assert.ok(code.matches[0].reasons.includes('SECTION_CONTEXT'));
  const list=await h.service.search(scope,{query:'ACK_LIST'});assert.equal(list.matches[0].locator.chunkId,code.matches[0].locator.chunkId);assert.ok(list.matches[0].content.includes('- ANOTHER_CHECK follows.'));
});

test('long body search paginates supported passages and every full tool reply stays bounded',async t=>{
  const h=await fixture(t),corpus=h.freeze([entry('long-code','```txt\n'+('ACK_LONG '+('x'.repeat(130))+'\n').repeat(150)+'```')]),scope=h.scope(corpus.id);let cursor:string|undefined,seen=0;
  do{const page=await h.service.search(scope,{query:'ACK_LONG',cursor});assert.ok(JSON.stringify(page).length<=7000);seen+=page.matches.length;cursor=page.nextCursor;}while(cursor);
  assert.ok(seen>6);const first=(await h.service.search(scope,{query:'ACK_LONG'})).matches[0];assert.ok(JSON.stringify(await h.service.read(scope,first.locator)).length<=7000);
});

test('oversized title or heading metadata cannot make even the first search/read reply unbounded',async t=>{
  const h=await fixture(t);
  for(const kind of ['title','heading'] as const){const title=kind==='title'?'A'.repeat(8500):'Short source',heading=kind==='heading'?'# '+('H'.repeat(8500))+'\n\n':'',corpus=h.freeze([entry('large-'+kind,heading+'ACK_BOUNDED is retained in full.',{title})]),scope=h.scope(corpus.id),plan=h.service.select(scope,{request:'ACK_BOUNDED'},{limitChars:30000});
    const item=plan.evidence.find(item=>item.content.includes('ACK_BOUNDED'));assert.ok(item);await assert.rejects(h.service.search(scope,{query:'ACK_BOUNDED'}),{code:'KNOWLEDGE_METADATA_OVERFLOW'});await assert.rejects(h.service.read(scope,item.locator),{code:'KNOWLEDGE_METADATA_OVERFLOW'});assert.ok(item.content.endsWith('retained in full.'));
  }
});

test('a requested distinguishing identifier wins over weak topic overlap and missing anchors abstain',async t=>{
  const h=await fixture(t),target=entry('generation-rules','ReceiptEpoch.accept checks requestGeneration before accepting an observed refresh.'),weak=entry('cafe-notes','The restaurant receipt refresh view changes its printed table number after a request.'),corpus=h.freeze([weak,target]),scope=h.scope(corpus.id);
  const plan=h.service.select(scope,{request:'Prevent ReceiptEpoch.accept from accepting a stale receipt refresh request.'});assert.ok(plan.evidence.some(item=>item.id===target.id));assert.ok(!plan.evidence.some(item=>item.id===weak.id));assert.ok(plan.omissions.some(item=>item.entryId===weak.id&&item.reason==='WEAK_BODY_MATCH'));
  const unknown=h.service.select(scope,{request:'Repair AbsentGeneration.finish on the receipt refresh request.'});assert.equal(unknown.evidence.length,0);assert.ok(unknown.gaps.some(gap=>gap.code==='NO_RELEVANT_EVIDENCE'));
});

test('selection stops at useful ranked coverage while complete frozen search and bounded reads stay available',async t=>{
  const h=await fixture(t),entries=Array.from({length:14},(_,i)=>entry('receipt-source-'+i,`ACK_DISTINCT requires generation check ${i}.`)),corpus=h.freeze(entries),scope=h.scope(corpus.id),plan=h.service.select(scope,{request:'Inspect ACK_DISTINCT.'});assert.equal(plan.evidence.length,8);assert.ok(plan.omissions.some(item=>item.reason==='LOWER_RANK'));assert.ok(plan.context.length<32000);
  let cursor:string|undefined,count=0;do{const page=await h.service.search(scope,{query:'ACK_DISTINCT',cursor});count+=page.matches.length;cursor=page.nextCursor;}while(cursor);assert.equal(count,14);
  const body=Array.from({length:100},(_,i)=>`Section observation ${i}: winter weather changes the garden canopy.`).join('\n\n')+'\n\nFINAL_BOUNDED_READ_FACT',long=h.freeze([entry('garden-log',body)]),longScope=h.scope(long.id),anchor=(await h.service.search(longScope,{query:'garden-log.md'})).matches[0];let locator=anchor.locator,text='',pages=0;
  while(locator){const result=await h.service.read(longScope,locator);assert.ok(JSON.stringify(result).length<=7000);assert.equal(result.passage.content,body.slice(result.passage.locator.startOffset,result.passage.locator.endOffset));assert.equal((await h.service.read(longScope,result.passage.locator)).passage.content,result.passage.content);text+=result.passage.content;pages++;if(!result.next)break;locator=result.next;}
  assert.ok(text.includes('FINAL_BOUNDED_READ_FACT'));assert.ok(pages<=4,'A short document should not require one tool roundtrip per paragraph.');
});

test('context tools summarize corpus metadata within their reply bound without changing the full owner record',async t=>{
  const h=await fixture(t),corpus=h.freeze(Array.from({length:100},(_,i)=>entry('source-'+i,'ACK_SUMMARY source '+i,{title:'Long metadata '.repeat(100)}))),plan=h.service.select(h.scope(corpus.id),{request:'ACK_SUMMARY'}),record=h.service.record(plan.id)!;
  const summary=knowledgeContextSummary(plan);assert.ok(JSON.stringify(summary).length<=7000);assert.equal(summary.manifest.documentCount,100);assert.equal(record.plan.manifest.documents.length,100);assert.ok(!('documents' in summary.manifest));assert.throws(()=>boundedKnowledgeToolReply({context:'x'.repeat(8000)}),{code:'KNOWLEDGE_CONTEXT_OVERFLOW'});
});

test('path fragments in a document tail do not turn an English or Chinese file-open request into body evidence',async t=>{
  const h=await fixture(t);
  for(const [id,file,request] of [['english','ledger-index.md','Open docs/ledger-index.md.'],['chinese','收据清单.md','打开 docs/收据清单.md']] as const){const body='# Registered source\n\nFIRST_FROZEN_PARAGRAPH explains the source.\n\n'+('General archival observations.\n\n').repeat(100)+'Ledger index 收据清单 ends with a FINAL_FROZEN_PARAGRAPH.',corpus=h.freeze([entry(id,body,{title:'Registered source',sourcePath:'/synthetic/docs/'+file})]),scope=h.scope(corpus.id),plan=h.service.select(scope,{request,stage:{name:'Ordinary read',prompt:request,checks:['Verify the requested function behavior from source evidence.']}});
    assert.equal(plan.evidence.length,1);assert.ok(plan.evidence[0].reasons.includes('DOCUMENT_DISCOVERY'));assert.ok(plan.evidence[0].reasons.includes('EXACT_PATH'));assert.ok(!plan.evidence[0].reasons.includes('TASK_TEXT'));assert.ok(plan.evidence[0].content.includes('FIRST_FROZEN_PARAGRAPH'));assert.ok(plan.evidence[0].locator.startLine<5);assert.equal((await h.service.search(scope,{query:request})).coverage,'discovery');
  }
});

test('a natural hyphenated phase name is not treated as a missing qualified code identifier',async t=>{
  const h=await fixture(t),corpus=h.freeze([entry('acknowledgement-guide','A durable acknowledgement is retained across the pending refresh.')]),plan=h.service.select(h.scope(corpus.id),{request:'Preserve the durable acknowledgement across a pending refresh.',stage:{name:'client-work',prompt:'Implement the requested maintenance.'}});assert.equal(plan.evidence.length,1);assert.ok(plan.evidence[0].reasons.includes('TASK_TEXT'));
});

test('a matched short function contract includes later uniqueness or precedence rules without query terms',async t=>{
  const h=await fixture(t),cases=[{id:'heading-contract',query:'Implement createHeadingIds.',intro:'Implement createHeadingIds(headings) with Unicode NFKC normalization and lowercase spelling.',rules:'Every resulting identifier must be unique in input order, including collisions with an earlier natural numeric suffix. Preserve the original strings and return a fresh array.'},{id:'retry-contract',query:'Implement classifyFailure.',intro:'Implement classifyFailure(input) as a pure classification function with bounded attempts.',rules:'Apply this precedence: explicit cancellation stops; authentication requires owner input; the attempt cap stops; capacity or transient status permits one retry. Only that result includes a finite clamped delay; all other results contain exactly action and reason.'}];
  for(const item of cases){const body='# Function contract\n\n'+item.intro+'\n\n'+item.rules+'\n\n# Separate chapter\n\nUNRELATED_SIBLING_BODY',corpus=h.freeze([entry(item.id,body)]),scope=h.scope(corpus.id),plan=h.service.select(scope,{request:item.query}),chosen=plan.evidence[0];assert.equal(plan.evidence.length,1);assert.ok(chosen.content.includes(item.intro));assert.ok(chosen.content.includes(item.rules));assert.ok(!chosen.content.includes('UNRELATED_SIBLING_BODY'));assert.ok(chosen.reasons.includes('SECTION_CONTEXT'));assert.equal(chosen.locator.startLine,1);assert.equal(chosen.locator.endLine,5);assert.ok(chosen.content.length<=2000);assert.equal(plan.budget.usedChars,plan.context.length);assert.equal(JSON.parse(plan.context).evidence[0].structuralContext,true);
    const search=await h.service.search(scope,{query:item.query});assert.equal(search.matches.length,1);assert.equal(search.matches[0].content,chosen.content);assert.equal((await h.service.read(scope,chosen.locator)).passage.content.includes(item.rules),true);assert.equal(h.service.record(plan.id)!.reads.length,0,'Owner source viewing is not an agent lookup.');
    const tight=h.service.select(scope,{request:item.query},{limitChars:plan.context.length-20});assert.equal(tight.evidence.length,0,'A complete short section is omitted atomically rather than cut back to its first paragraph.');assert.ok(tight.gaps.some(gap=>gap.code==='BUDGET_OMISSION'));assert.ok(tight.context.length<=tight.budget.limitChars);
  }
});

test('short-section materialization never expands a long chapter or a discovery-only metadata match',async t=>{
  const h=await fixture(t),long=h.freeze([entry('long-chapter','# Long chapter\n\nReceiptEpoch.confirm retains one fact.\n\n'+('Seasonal background.\n\n').repeat(150)+'NO_QUERY_WORD_FINAL_RULE')]),scope=h.scope(long.id),plan=h.service.select(scope,{request:'Implement ReceiptEpoch.confirm.'});assert.ok(plan.evidence.length);assert.ok(plan.evidence.every(item=>!item.reasons.includes('SECTION_CONTEXT')&&!item.content.includes('NO_QUERY_WORD_FINAL_RULE')));
  const short=h.freeze([entry('metadata-chapter','# Orchard guide\n\nThe first paragraph is an introduction.\n\nSECOND_PARAGRAPH_FOR_EXPLICIT_READING',{sourcePath:'/synthetic/docs/orchard-guide.md'})]),discovery=h.service.select(h.scope(short.id),{request:'Open docs/orchard-guide.md.'});assert.equal(discovery.evidence.length,1);assert.ok(discovery.evidence[0].reasons.includes('DOCUMENT_DISCOVERY'));assert.ok(!discovery.evidence[0].reasons.includes('SECTION_CONTEXT'));assert.ok(!discovery.evidence[0].content.includes('SECOND_PARAGRAPH_FOR_EXPLICIT_READING'));
});

test('a v4 paragraph locator still reads exactly the same frozen bytes under v5 materialization',async t=>{
  const h=await fixture(t),body='# Frozen receipt contract\n\nReceiptEpoch.confirm persists a receipt.\n\nNever revive a cancelled generation.\n',source=entry('legacy-short-section',body),corpus=h.freeze([source]),scope=h.scope(corpus.id);
  // This paragraph locator was produced by the v4 AST boundary and chunk identity format.
  const locator={corpusId:corpus.id,entryId:source.id,revision:1,hash:source.hash,chunkId:'74400c4e74bf7a005c57aa8d3772',headingPath:['Frozen receipt contract'],startLine:3,endLine:3,startOffset:27,endOffset:67},before=structuredClone(h.service.corpus(corpus.id,h.project.id));
  const plan=h.service.select(scope,{request:'Implement ReceiptEpoch.confirm.'}),read=await h.service.read(scope,locator);assert.ok(plan.evidence[0].reasons.includes('SECTION_CONTEXT'));assert.equal(read.passage.content,'ReceiptEpoch.confirm persists a receipt.\n\nNever revive a cancelled generation.');assert.deepEqual(h.service.corpus(corpus.id,h.project.id),before);assert.equal(h.service.record(plan.id)!.reads.length,0);
});
