import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePlannerDecision} from '../src/goal-planner.ts';
import {AppError} from '../src/validation.ts';
import {TOOL_DEFINITIONS} from '../src/adapters/codex.ts';

const base = {rationale: 'The inspected evidence supports this action.', expectedGain: 'Resolve the remaining bounded question.', tasks: []};

test('planner decisions retain explicit dispatch/retry/clarification contracts without provider extras', () => {
  const input = {action: 'dispatch', ...base, tasks: [{pipelineId: 'flow-a', goal: 'Inspect one artifact.', privateProviderField: 'ignored'}], projectId: 'untrusted-extra'};
  const decision = validatePlannerDecision(input);
  assert.deepEqual(decision, {action: 'dispatch', ...base, tasks: [{pipelineId: 'flow-a', goal: 'Inspect one artifact.'}]});
  assert.notEqual(decision.tasks, input.tasks);
  assert.deepEqual(validatePlannerDecision({action: 'retry', ...base, retry: {runId: 'owned-run', stageId: 'verify', note: 'Retry only the failed check.'}}).retry,
    {runId: 'owned-run', stageId: 'verify', note: 'Retry only the failed check.'});
  assert.equal(validatePlannerDecision({action: 'clarify', ...base, question: 'Which acceptance target applies?'}).question, 'Which acceptance target applies?');
  for (const action of ['complete', 'stop']) assert.equal(validatePlannerDecision({action, ...base}).action, action);
});

test('planner output must describe one bounded action and required evidence', () => {
  for (const value of [null, {action: 'dispatch', ...base}, {action: 'complete', ...base, tasks: [{pipelineId: 'flow', goal: 'Hidden dispatch.'}]},
    {action: 'retry', ...base}, {action: 'retry', ...base, retry: {runId: 'run', stageId: 'stage', note: ''}},
    {action: 'clarify', ...base}, {action: 'stop', ...base, rationale: ''},
    {action: 'dispatch', ...base, tasks: [1, 2, 3]}, {action: 'dispatch', ...base, tasks: [{pipelineId: '', goal: 'Missing target.'}]}]) {
    assert.throws(() => validatePlannerDecision(value), error => error instanceof AppError);
  }
});

test('read-only answers carry a bounded response and never hide dispatched work in tasks', () => {
  const response = 'The recorded project has no active actions; release acceptance remains unverified.';
  assert.deepEqual(validatePlannerDecision({action: 'answer', ...base, response}), {action: 'answer', ...base, response});
  for (const value of [undefined, '', '   ', 'x'.repeat(16001)]) {
    assert.throws(() => validatePlannerDecision({action: 'answer', ...base, response: value}), error => error instanceof AppError && error.code === 'ANSWER_REQUIRED');
  }
  assert.throws(() => validatePlannerDecision({action: 'answer', ...base, response, tasks: [{pipelineId: 'flow', goal: 'Hidden implementation.'}]}), error => error instanceof AppError && error.code === 'INVALID_DECISION');
});


test('native tool discovery exposes the same answer and retry decision contract', () => {
  const properties=TOOL_DEFINITIONS['intake.route'].properties;
  const action=properties.action as {enum:string[]};
  assert.ok(action.enum.includes('answer'));assert.ok(action.enum.includes('retry'));
  assert.deepEqual(properties.response,{type:'string'});
  assert.ok(properties.retry);
});
