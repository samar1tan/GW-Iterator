import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {KnowledgeEntry,ProjectDetail} from '../src/contracts.ts';
import {knowledgeSourceRunRoute,readRoute,writeRoute} from '../web/platform/route.ts';
import type {Route} from '../web/platform/route.ts';

test('knowledge filters and selected identity survive URL encoding and reload',()=>{
  const route:Route={projectId:'synthetic project/one',surface:'knowledge',role:'synthetic-review',entryId:'synthetic-entry',query:'river & 港口? + = #',kind:'document'};
  const hash=writeRoute(route),restored=readRoute(hash);
  for(const key of ['projectId','surface','role','entryId','query','kind'] as const)assert.equal(restored[key],route[key]);
  assert.ok(hash.includes('q=river+%26+'));
  assert.equal(new URLSearchParams(hash.split('?')[1]).get('kind'),'document');
});

test('knowledge source execution keeps its return context and clears unrelated object selection',()=>{
  const origin:Route={projectId:'synthetic-project',surface:'knowledge',role:'synthetic-review',entryId:'selected-lesson',query:'verified synthetic finding',kind:'lesson',pipelineId:'stale-pipeline',stageId:'stale-stage',intakeId:'stale-goal',adoptionId:'stale-adoption',editing:true};
  const opened=knowledgeSourceRunRoute(origin,'source-run'),restored=readRoute(writeRoute(opened));
  assert.equal(restored.surface,'knowledge');assert.equal(restored.runId,'source-run');
  assert.equal(restored.entryId,'selected-lesson');assert.equal(restored.query,origin.query);assert.equal(restored.kind,'lesson');assert.equal(restored.role,origin.role);
  for(const key of ['pipelineId','stageId','intakeId','adoptionId'] as const)assert.equal(restored[key],undefined);
  assert.equal(restored.editing,false);
  const returned=readRoute(writeRoute({...opened,runId:undefined,stageId:undefined}));
  assert.equal(returned.runId,undefined);assert.equal(returned.surface,'knowledge');assert.equal(returned.entryId,'selected-lesson');assert.equal(returned.query,origin.query);assert.equal(returned.kind,'lesson');
  assert.equal(origin.stageId,'stale-stage','Opening the source execution must not mutate its originating route.');
});

test('archived lesson filtering remains explicit through source-execution return and URL reload',()=>{
  const route:Route={projectId:'synthetic-project',surface:'knowledge',role:'qa',kind:'lesson',knowledgeStatus:'archived',query:'retained evidence',entryId:'synthetic-archived-lesson'};
  const restored=readRoute(writeRoute(route));assert.equal(restored.knowledgeStatus,'archived');assert.equal(restored.kind,'lesson');assert.equal(restored.entryId,route.entryId);
  const opened=knowledgeSourceRunRoute(restored,'synthetic-source-run'),returned=readRoute(writeRoute({...opened,runId:undefined}));
  for(const key of ['knowledgeStatus','role','kind','query','entryId'] as const)assert.equal(returned[key],route[key]);
  assert.equal(readRoute('#/projects/synthetic-project/knowledge?status=unsupported').knowledgeStatus,undefined);
});

test('lesson lifecycle receipts survive failed and stale observation without repeating the confirmed mutation',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{submitLessonLifecycle,knowledgeEntriesWithLessonReceipt,lessonLifecycleObserved,unobservedLessonReceipt}=await vite.ssrLoadModule('/web/KnowledgeView.tsx'),{api}=await vite.ssrLoadModule('/web/api.ts');
  const entry:KnowledgeEntry={id:'synthetic-lesson',projectId:'synthetic-project',sourceId:'run-lessons',kind:'lesson',roles:[],title:'Synthetic retained evidence',content:'Keep the acknowledged write.',hash:'synthetic-hash',revision:1,syncedAt:'2026-01-01T00:00:00Z',status:'current',originRunId:'synthetic-source-run'},archived:KnowledgeEntry={...entry,status:'archived',lifecycleRevision:1};
  let receipt:KnowledgeEntry|undefined,writes=0,reads=0,observationErrors=0;
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async(input,init)=>{
    if(init?.method==='PATCH'){writes++;assert.equal(input,`/api/projects/${entry.projectId}/knowledge/lessons/${entry.id}`);assert.deepEqual(JSON.parse(String(init.body)),{expectedRevision:1,expectedLifecycleRevision:0,archived:true});return Response.json(archived);}
    reads++;assert.equal(receipt?.lifecycleRevision,1,'Consume the write before observing surrounding metadata.');
    if(reads===1)return Response.json({error:{code:'SYNTHETIC_UNAVAILABLE',message:'Synthetic observation unavailable.'}},{status:503});
    return Response.json({entries:reads===2?[entry]:[archived]});
  };
  const observe=()=>api(`/api/projects/${entry.projectId}/knowledge?status=archived`).then(()=>{});
  await submitLessonLifecycle(entry,true,(value:KnowledgeEntry)=>{receipt=value;},observe,()=>{observationErrors++;});
  assert.equal(writes,1);assert.equal(reads,1);assert.equal(observationErrors,1);assert.deepEqual(receipt,archived);assert.equal(lessonLifecycleObserved(entry,receipt),false);
  const route:Route={projectId:entry.projectId,surface:'knowledge',role:'qa',kind:'lesson',knowledgeStatus:'archived',query:'retained'};
  const stale=await api(`/api/projects/${entry.projectId}/knowledge?status=archived`);
  assert.deepEqual(knowledgeEntriesWithLessonReceipt(stale.entries,route,receipt),[archived]);
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([entry],{...route,knowledgeStatus:undefined},receipt),[],'The same stale GET cannot reintroduce an archived lesson into the current view.');
  const current=await api(`/api/projects/${entry.projectId}/knowledge?status=archived`);assert.equal(lessonLifecycleObserved(current.entries[0],receipt),true);assert.equal(writes,1,'Observation recovery must only perform GETs.');
  const restored:KnowledgeEntry={...entry,lifecycleRevision:2};
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([restored],route,receipt),[],'A later restore must supersede an older archive receipt.');
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([restored],{...route,knowledgeStatus:undefined},receipt),[restored]);
  assert.equal(unobservedLessonReceipt(receipt,[],[restored]),undefined,'A newer detail observation acknowledges an archive even when the archived GET correctly omits it.');
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([],route,receipt,[restored]),[],'A filtered absence plus a newer restore cannot reinject the old archive receipt.');
  assert.equal(unobservedLessonReceipt(receipt,[entry],[entry]),receipt,'Stale props must not clear an unobserved receipt.');
  const archivedAgain:KnowledgeEntry={...archived,lifecycleRevision:3},currentRoute={...route,knowledgeStatus:undefined};
  assert.equal(unobservedLessonReceipt(restored,[],[archivedAgain]),undefined);
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([],currentRoute,restored,[archivedAgain]),[],'The reverse archive supersedes a restore receipt despite a current-only GET absence.');
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([archived],route,undefined,[restored]),[],'Newer full-detail lifecycle state also defeats an older filtered row after the receipt is cleared.');
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([restored],currentRoute,undefined,[archivedAgain]),[]);
  assert.equal(lessonLifecycleObserved({...archived,projectId:'synthetic-other-project'},receipt),false);
  assert.deepEqual(knowledgeEntriesWithLessonReceipt([],{...route,projectId:'synthetic-other-project'},receipt),[]);
});

test('knowledge shows reversible lesson actions and archived text in both locales without exposing lifecycle numbers',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const{KnowledgeView}=await vite.ssrLoadModule('/web/KnowledgeView.tsx'),{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const entry:KnowledgeEntry={id:'synthetic-lesson',projectId:'synthetic-project',sourceId:'run-lessons',kind:'lesson',roles:[],title:'Synthetic durable evidence',content:'**Retained lesson text.**',hash:'synthetic-hash',revision:1,syncedAt:'2026-01-01T00:00:00Z',status:'current',originRunId:'synthetic-source-run'},archived:KnowledgeEntry={...entry,id:'synthetic-archived',title:'Archived synthetic evidence',status:'archived',lifecycleRevision:1},source:KnowledgeEntry={...entry,id:'synthetic-source',kind:'document'};
  const detail:ProjectDetail={project:{id:entry.projectId,name:'Synthetic knowledge project',description:'Independent lifecycle UI fixture.',workspace:'/synthetic/workspace',repository:'',revision:1,roles:[],knowledgeSources:[],createdAt:entry.syncedAt,updatedAt:entry.syncedAt},pipelines:[],runs:[],knowledge:[entry,archived,source],proposals:[],events:[],intakes:[]};
  for(const locale of ['en','zh-CN']){
    const render=(route:Route)=>renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(KnowledgeView,{detail,route,navigate(){},onChanged:async()=>{}})));
    const current=render({projectId:entry.projectId,surface:'knowledge',role:'',entryId:entry.id});
    assert.ok(current.includes(locale==='en'?'Archive lesson':'归档经验'));assert.ok(!current.includes(archived.title));assert.ok(!current.includes('lifecycleRevision'));
    const retained=render({projectId:entry.projectId,surface:'knowledge',role:'',entryId:archived.id,kind:'lesson',knowledgeStatus:'archived'});
    assert.ok(retained.includes(locale==='en'?'Restore lesson':'恢复经验'));assert.ok(retained.includes('<strong>Retained lesson text.</strong>'));assert.ok(retained.includes(locale==='en'?'Excluded from new work.':'不再用于新工作'));
    assert.ok(retained.includes(locale==='en'?'Open source execution':'查看来源执行'));assert.ok(!retained.includes('lifecycleRevision'));
    const document=render({projectId:entry.projectId,surface:'knowledge',role:'',entryId:source.id});
    assert.ok(!document.includes(locale==='en'?'Archive lesson':'归档经验'));assert.ok(!document.includes(locale==='en'?'Restore lesson':'恢复经验'));
  }
});

test('knowledge back and forward distinguish filter states without inventing a selected entry',()=>{
  const before='#/projects/synthetic-project/knowledge?role=qa&entry=synthetic-document&q=harbor&kind=document';
  const first=readRoute(before),secondHash=writeRoute({...first,query:'trail',kind:'artifact',entryId:undefined}),second=readRoute(secondHash);
  assert.equal(second.entryId,undefined);assert.equal(second.query,'trail');assert.equal(second.kind,'artifact');
  const returned=readRoute(before);assert.equal(returned.entryId,'synthetic-document');assert.equal(returned.query,'harbor');assert.equal(returned.kind,'document');
});

test('invalid selected entry IDs remain explicit for the view to report as unavailable',()=>{
  const route=readRoute('#/projects/synthetic-project/knowledge?entry=missing-entry&q=source&kind=memory');
  assert.equal(route.entryId,'missing-entry');
  assert.equal(readRoute(writeRoute(route)).entryId,'missing-entry');
  assert.equal(route.query,'source');assert.equal(route.kind,'memory');
});

test('existing settings aliases and legacy goal links keep their canonical destinations',()=>{
  const settings=readRoute('#/projects/synthetic-project/configuration?role=qa');
  assert.equal(settings.surface,'settings');assert.equal(settings.role,'qa');assert.ok(writeRoute(settings).includes('/settings?'));
  const legacy=readRoute('#/projects/synthetic-project/workbench?intake=synthetic-goal');
  assert.equal(legacy.intakeId,'synthetic-goal');assert.ok(writeRoute(legacy).includes('goal=synthetic-goal'));
});

test('an invalid knowledge deep link renders its unavailable state instead of another entry body',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const {KnowledgeView}=await vite.ssrLoadModule('/web/KnowledgeView.tsx'),{I18nContext,makeI18n}=await vite.ssrLoadModule('/web/i18n.tsx');
  const detail:ProjectDetail={
    project:{id:'synthetic-project',revision:1,name:'Synthetic navigation project',description:'Independently authored fixture.',workspace:'/synthetic/workspace',repository:'',roles:[],knowledgeSources:[],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'},
    knowledge:[{id:'present-entry',projectId:'synthetic-project',sourceId:'synthetic-source',kind:'document',roles:[],title:'Available synthetic entry',content:'Synthetic unrelated body must not replace a missing selection.',hash:'synthetic-hash',revision:1,syncedAt:'2026-01-01T00:00:00Z',status:'current'}],
    pipelines:[],runs:[],proposals:[],events:[],intakes:[],
  };
  const markup=renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n('en')},createElement(KnowledgeView,{detail,route:{projectId:detail.project.id,surface:'knowledge',role:'',entryId:'missing-entry'},navigate:()=>{},onChanged:async()=>{}})));
  assert.ok(markup.includes('This item is unavailable'));
  assert.ok(markup.includes('Available synthetic entry'),'Matching entries remain available in the navigation list.');
  assert.equal(markup.includes(detail.knowledge[0].content),false);
});

test('confirmed knowledge writes survive refresh errors and retry only observation',async t=>{
  const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});t.after(()=>vite.close());
  const {submitKnowledgeChange}=await vite.ssrLoadModule('/web/KnowledgeView.tsx');
  for(const operation of ['source registration','lesson creation'])await t.test(operation,async()=>{
    let confirmed=false,writes=0,refreshes=0,receipts=0;
    const saved={id:'synthetic-receipt',revision:2},trace:string[]=[];
    let basis={revision:1};
    const write=async()=>{writes++;trace.push(operation==='source registration'?'PUT':'POST');return saved;};
    const receive=(receipt:typeof saved)=>{receipts++;confirmed=true;basis=receipt;trace.push('receipt');};
    await assert.rejects(submitKnowledgeChange(confirmed,write,receive,async()=>{refreshes++;trace.push('refresh');assert.equal(confirmed,true);throw new Error('Synthetic refresh failed after the server confirmed saving.');}),/Synthetic refresh failed/);
    assert.equal(confirmed,true);assert.equal(basis.revision,2);assert.equal(writes,1);assert.equal(receipts,1);
    await submitKnowledgeChange(confirmed,write,receive,async()=>{refreshes++;trace.push('refresh');});
    assert.equal(writes,1,'A refresh retry must not resend the confirmed PUT/POST.');
    assert.equal(receipts,1);assert.equal(refreshes,2);
    assert.deepEqual(trace,[operation==='source registration'?'PUT':'POST','receipt','refresh','refresh']);
  });
  await t.test('a rejected write stays editable and does not claim a receipt',async()=>{
    let confirmed=false,attempts=0,receipts=0,refreshes=0;
    const receive=()=>{receipts++;confirmed=true;};
    const refresh=async()=>{refreshes++;};
    await assert.rejects(submitKnowledgeChange(confirmed,async()=>{attempts++;throw new Error('Synthetic validation rejected the write.');},receive,refresh),/Synthetic validation rejected/);
    assert.equal(confirmed,false);assert.equal(receipts,0);assert.equal(refreshes,0);
    await submitKnowledgeChange(confirmed,async()=>{attempts++;return{id:'synthetic-repaired-receipt'};},receive,refresh);
    assert.equal(attempts,2);assert.equal(receipts,1);assert.equal(refreshes,1);assert.equal(confirmed,true);
  });
});

test('knowledge source entry resolves relative input against the project while preserving native absolute paths',async()=>{
  const {knowledgePath}=await import('../web/platform/knowledgePath.ts');
  assert.equal(knowledgePath('/synthetic/project',' docs '),'/synthetic/project/docs');
  assert.equal(knowledgePath('/synthetic/project/','./notes.md'),'/synthetic/project/./notes.md');
  assert.equal(knowledgePath('/synthetic/project','/synthetic/selected.md'),'/synthetic/selected.md');
  assert.equal(knowledgePath('C:\\synthetic\\project','docs\\notes.md'),'C:\\synthetic\\project\\docs\\notes.md');
  assert.equal(knowledgePath('C:/synthetic/project/','D:\\selected\\notes.md'),'D:\\selected\\notes.md');
  assert.equal(knowledgePath('\\\\server\\share\\project','notes.md'),'\\\\server\\share\\project\\notes.md');
  assert.equal(knowledgePath('/','notes.md'),'/notes.md');
  assert.equal(knowledgePath('/synthetic/project',' '),'');
});
