import type {AllowanceAssessment} from './account-allowance-types.ts';
import type {ExecutionRef, IntakeConversation, IntakeDecision, IntakeRound, KnowledgeEntry, Pipeline, Project, TaskOutput, Usage, WorkStatus} from './contracts.ts';
import type {AdapterEvent} from './adapters/types.ts';
import {demand, isObject, text} from './validation.ts';

export type GoalPlannerObservation = {
  id: string; status: WorkStatus; goal: string; stopReason?: string;
  stages: {id: string; status: WorkStatus; output?: TaskOutput; error?: string;attemptCount?:number}[];
  resourceMode?:'account'|'tokens';
  limits?:{tokenBudget:number;usedTokens:number;remainingTokens:number;maxAttempts:number};
};
export type GoalPlannerInput = {
  resourceMode?:'account'|'tokens';account?:AllowanceAssessment;
  project: Project; pipelines: Pipeline[]; knowledge: KnowledgeEntry[];
  request: string; baseline: string; rounds: IntakeRound[]; observations: GoalPlannerObservation[];
  conversation?:IntakeConversation;
  continuation?:{note:string;reason:string;question?:string};
  remaining: {tokens: number; seconds: number; rounds: number};
  signal: AbortSignal; onEvent: (event: AdapterEvent) => void; executionId: string;
};
export type GoalPlannerExecution = {
  ref: ExecutionRef;
  /** Settle only when the referenced task has authoritatively ended, including confirmed cancellation. */
  completion: Promise<{decision: IntakeDecision; usage?: Usage}>;
};

/** Execute one decision. Waiting for delegated work belongs to Intake, not the model. */
export interface GoalPlanner {
  start(input: GoalPlannerInput): Promise<GoalPlannerExecution>;
}

/** Validate provider output before project-scoped routing applies authoritative state checks. */
export function validatePlannerDecision(value: unknown): IntakeDecision {
  demand(isObject(value) && ['dispatch', 'retry', 'complete', 'answer', 'clarify', 'stop'].includes(String(value.action))
    && text(value.rationale, 4000) && text(value.expectedGain, 2000) && Array.isArray(value.tasks),
  'INVALID_DECISION', 'Record an action, concise reason, expected benefit and tasks.');
  const action = value.action as IntakeDecision['action'];
  demand(value.tasks.length <= 2 && value.tasks.every(task => isObject(task) && text(task.pipelineId, 160) && text(task.goal, 16000)),
    'INVALID_DECISION', 'Use bounded workflow tasks with stable pipeline identifiers.');
  demand(action === 'dispatch' ? value.tasks.length > 0 : value.tasks.length === 0,
    'INVALID_DECISION', 'Only dispatch decisions may supply workflow tasks.');
  if (action === 'clarify') demand(text(value.question, 2000), 'QUESTION_REQUIRED', 'Ask one concrete question.');
  if (action === 'answer') demand(text(value.response, 16000), 'ANSWER_REQUIRED', 'Provide a read-only answer within 16,000 characters.');
  if (action === 'retry') demand(isObject(value.retry) && text(value.retry.runId, 160) && text(value.retry.stageId, 160) && text(value.retry.note, 2000),
    'INVALID_DECISION', 'Identify the failed owned stage and the reason to retry it.');
  return {
    action, rationale: value.rationale, expectedGain: value.expectedGain,
    tasks: value.tasks.map(task => ({pipelineId: task.pipelineId as string, goal: task.goal as string})),
    ...(action === 'answer' ? {response: value.response as string} : {}),
    ...(action === 'clarify' ? {question: value.question as string} : {}),
    ...(action === 'retry' ? {retry: {runId: (value.retry as Record<string, string>).runId!, stageId: (value.retry as Record<string, string>).stageId!, note: (value.retry as Record<string, string>).note!}} : {}),
  };
}
