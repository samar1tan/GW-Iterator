import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultPipeline,defaultRoles} from '../src/defaults.ts';
import type {Project} from '../src/contracts.ts';
import {AppError,validatePipeline} from '../src/validation.ts';

const project:Project={id:'synthetic-project',revision:1,name:'Synthetic project',description:'Authored policy regression',workspace:'/synthetic',repository:'',roles:defaultRoles(),knowledgeSources:[],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};

test('every starter defines work without numeric execution quotas',()=>{
  for(const template of ['focused','product','operations','knowledge','role']){
    const pipeline=defaultPipeline(project,'lead',template);
    assert.deepEqual(pipeline.policy,{});assert.doesNotThrow(()=>validatePipeline(pipeline,project));
    assert.ok(pipeline.stages.every(stage=>project.roles.some(role=>role.id===stage.roleId)));
  }
});

test('legacy quota metadata remains readable outside former ranges but malformed values are rejected',()=>{
  const pipeline=defaultPipeline(project,'lead','focused');
  pipeline.policy={concurrency:12,maxAttempts:25,maxIterations:20,timeoutSeconds:7200,tokenBudget:2000000};
  assert.doesNotThrow(()=>validatePipeline(pipeline,project));
  for(const tokenBudget of [0,-1,Infinity,NaN,1.5])assert.throws(()=>validatePipeline({...pipeline,policy:{tokenBudget}},project),error=>error instanceof AppError&&error.code==='INVALID_POLICY');
  const cyclic=structuredClone(pipeline);cyclic.stages[0].dependsOn=['verify'];
  assert.throws(()=>validatePipeline(cyclic,project),error=>error instanceof AppError&&error.code==='PIPELINE_CYCLE');
});
