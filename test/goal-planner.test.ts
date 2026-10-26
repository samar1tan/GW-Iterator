import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePlannerDecision} from '../src/goal-planner.ts';
import {AppError} from '../src/validation.ts';

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
