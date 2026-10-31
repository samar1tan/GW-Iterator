import type {AllowanceAssessment} from './account-allowance-types.ts';
import type {ExecutionRef, IntakeConversation, IntakeDecision, IntakeRound, KnowledgeEntry, Pipeline, Project, TaskOutput, Usage, WorkStatus} from './contracts.ts';
import type {AdapterEvent} from './adapters/types.ts';
import type {KnowledgeContextPlan,KnowledgeReadAccess} from './knowledge-context-types.ts';
import {demand, isObject, text} from './validation.ts';
import {CONVERSATION_DATA_RULE} from './intake-context.ts';
import type {GoalAttachment} from './attachment-types.ts';

export type GoalPlannerObservation = {
  id: string; status: WorkStatus; goal: string; stopReason?: string;
  stages: {id: string; status: WorkStatus; output?: TaskOutput; error?: string;attemptCount?:number}[];
  resourceMode?:'account'|'tokens';
  limits?:{tokenBudget?:number;usedTokens:number;remainingTokens?:number;maxAttempts?:number};
};
export type GoalPlannerInput = {
  attachments?:GoalAttachment[];
  resourceMode?:'account'|'tokens';account?:AllowanceAssessment;
  project: Project; pipelines: Pipeline[]; knowledge: KnowledgeEntry[];
  request: string; baseline: string; rounds: IntakeRound[]; observations: GoalPlannerObservation[];
  conversation?:IntakeConversation;
  continuation?:{note:string;reason:string;question?:string};
  /** Legacy caller metadata; never forwarded as an execution quota. */
  remaining?: {tokens?: number; seconds?: number; rounds?: number};
  signal: AbortSignal; onEvent: (event: AdapterEvent) => void; executionId: string;
  contextPlan?:KnowledgeContextPlan;knowledgeAccess?:KnowledgeReadAccess;
};
export type GoalPlannerExecution = {
  ref: ExecutionRef;
  /** Settle only when the referenced task has authoritatively ended, including confirmed cancellation. */
  completion: Promise<{decision: IntakeDecision; usage?: Usage}>;
};

/** One bounded metadata envelope; account observations are never token estimates. */
export function plannerExecutionContext(input:Pick<GoalPlannerInput,'project'|'pipelines'|'account'|'resourceMode'|'remaining'|'continuation'>):Record<string,unknown>{
  const account=input.account?{status:input.account.status,code:input.account.code,action:input.account.action,windows:input.account.account.windows,observedAt:input.account.account.observedAt,expiresAt:input.account.account.expiresAt,trend:input.account.trend,activeExecutions:input.account.activeExecutions}:undefined;
  return{resourceMode:'account',execution:'supervised-without-quotas',...(account?{account}:{}),conversationRule:CONVERSATION_DATA_RULE,...(input.continuation?{continuation:input.continuation}:{}),roles:input.project.roles.filter(role=>!role.retired).map(role=>({id:role.id,sandbox:role.sandbox})),workflows:input.pipelines.map(flow=>({id:flow.id,name:flow.name,owner:flow.roleId,description:flow.description,stages:flow.stages.map(stage=>({id:stage.id,name:stage.name,role:stage.roleId,executor:stage.executor,checks:stage.checks,review:stage.review,dependsOn:stage.dependsOn,...(stage.condition?{condition:stage.condition}:{}),...(stage.reworkTo?{reworkTo:stage.reworkTo}:{})}))}))};
}

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
  demand(value.tasks.every(task => isObject(task) && text(task.pipelineId, 160) && text(task.goal, 16000)),
    'INVALID_DECISION', 'Use workflow tasks with stable pipeline identifiers.');
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
