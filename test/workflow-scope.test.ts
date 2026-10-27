import assert from 'node:assert/strict';
import test from 'node:test';
import type {Pipeline} from '../src/contracts.ts';
import {workflowScope} from '../web/platform/workflowScope.ts';
import {recommendPipelines} from '../web/platform/recommendations.ts';
import {defaultRoles} from '../src/defaults.ts';

function flow(id:string,executors:('manual'|'codex'|'pipeline'|'github')[]):Pipeline {
  return {id,projectId:'synthetic-project',revision:1,name:'Synthetic workflow',description:'Synthetic scope regression',roleId:'development',updatedAt:'2026-01-01T00:00:00Z',policy:{concurrency:1,maxAttempts:2,maxIterations:1,timeoutSeconds:300,tokenBudget:20000},stages:executors.map((executor,index)=>({id:`step-${index}`,name:`Step ${index}`,roleId:index?'qa':'development',executor,prompt:'Synthetic instruction',dependsOn:index?[`step-${index-1}`]:[],review:false}))};
}
test('known nested human work has no model admission and unknown/cyclic children stay conservative',()=>{
  const human=flow('human',['manual','manual']),wrapper=flow('wrapper',['pipeline']);wrapper.stages[0].options={pipelineId:human.id};
  const scope=workflowScope(wrapper,[human,wrapper]);
  assert.equal(scope.requiresAccount,false);assert.equal(scope.manualOnly,true);assert.deepEqual([...scope.modelRoles],[]);
  assert.equal(workflowScope(wrapper,[]).requiresAccount,true);
  human.stages[0]={...human.stages[0],executor:'pipeline',options:{pipelineId:wrapper.id}};
  assert.equal(workflowScope(wrapper,[human,wrapper]).requiresAccount,true);
});
test('actual child workers contribute inherited model roles; CI-only work has no model admission',()=>{
  const child=flow('child',['codex','manual']),wrapper=flow('wrapper',['pipeline']);wrapper.stages[0].options={pipelineId:child.id};
  const scope=workflowScope(wrapper,[child]);assert.equal(scope.requiresAccount,true);assert.equal(scope.manualOnly,false);assert.deepEqual([...scope.modelRoles],['development']);
  assert.equal(workflowScope(flow('ci',['github'])).requiresAccount,false);assert.equal(workflowScope(flow('ci',['github'])).manualOnly,false);
});
test('new project recommendations favor short cross-role work while retaining recent use',()=>{
  const focused=flow('focused',['codex','codex','manual']),long=flow('long',['codex','codex','codex','codex','manual']);long.stages[2].review=true;long.stages[3].reworkTo='step-0';
  assert.equal(recommendPipelines([long,focused],[],defaultRoles())[0].pipeline.id,'focused');
  const history=[{pipelineId:'long',createdAt:'2026-01-02T00:00:00Z'}] as Parameters<typeof recommendPipelines>[1];
  assert.equal(recommendPipelines([long,focused],history,defaultRoles())[0].pipeline.id,'long');
});

test('changing an action clears hidden contracts that no longer apply',async()=>{
  const {switchStageExecutor}=await import('../web/platform/workflowScope.ts');
  const review={...flow('review',['codex']).stages[0],executionPurpose:'review' as const};
  const human=switchStageExecutor(review,'manual');assert.equal(human.executionPurpose,undefined);assert.equal(review.executionPurpose,'review');
  const gate={...flow('gate',['manual']).stages[0],ownerGate:true};
  assert.equal(switchStageExecutor(gate,'codex').ownerGate,undefined);
  assert.equal(switchStageExecutor(gate,'manual').ownerGate,true);
});

test('delegated request headings keep the user outcome while full input stays unchanged',async()=>{
  const {requestSummary}=await import('../web/platform/requestSummary.ts');
  const request='Original goal: Inspect the recorded human handoff. Keep the source unchanged.\n\nDelegated action: Run the selected manual workflow.';
  assert.equal(requestSummary(request),'Inspect the recorded human handoff.');
  assert.ok(request.includes('Delegated action:'));
  assert.equal(requestSummary('Keep the source unchanged。Inspect the result。'),'Keep the source unchanged。');
});
