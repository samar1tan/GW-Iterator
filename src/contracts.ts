import type {AllowanceAssessment} from './account-allowance-types.ts';
import type {DefinitionOrigin} from './template-types.ts';
import type {KnowledgePurpose,KnowledgePurposeOrigin,LessonProposal} from './knowledge-context-types.ts';
export const EXECUTORS = ['manual', 'codex', 'github', 'pipeline'] as const;
export type Executor = typeof EXECUTORS[number];
export type WorkStatus = 'queued' | 'running' | 'waiting' | 'review' | 'paused' | 'skipped' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export const currentWorkStatuses:ReadonlySet<string>=new Set(['routing','dispatched','retry_wait','clarification','queued','running','waiting','review','paused']);
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = typeof EFFORTS[number];
export const DEFAULT_EFFORT: Effort = 'max';
export const EFFORT_LABELS: Record<Effort, string> = {low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra'};
export type ControlTool = 'context.read' | 'knowledge.search' | 'knowledge.write' | 'pipeline.read' | 'pipeline.propose' | 'pipeline.write' | 'run.read' | 'run.start' | 'intake.route' | 'project.bootstrap' | 'browser.use';
export const CONTROL_TOOLS: ControlTool[] = ['context.read','knowledge.search','knowledge.write','pipeline.read','pipeline.propose','pipeline.write','run.read','run.start','intake.route','project.bootstrap','browser.use'];
export const DELIVERY_PREPARATION_TOOLS:readonly ControlTool[]=['context.read','knowledge.search','pipeline.read','run.read'];
export type RoleProfile = {
  id: string; name: string; description: string; instructions: string;
  model: string | null; effort: Effort; sandbox: 'read-only' | 'workspace-write';
  skills: {name: string; path: string}[]; tools: ControlTool[];
  browser?:{origins:string[]};
  inputs?:string[]; outputs?:string[]; checks?:string[]; retired?:boolean;
  multica?:{agentId?:string;runtimeId?:string;skillIds?:string[];mcpServerIds?:string[]};
  origin?:DefinitionOrigin; templateBindingId?:string;
};
export type KnowledgeSource = {id: string; kind: 'document' | 'artifact' | 'memory'; path: string; roles: string[]; section?: string; purpose?:KnowledgePurpose};
export type Project = {
  id: string; revision: number; name: string; description: string; workspace: string; repository: string;
  roles: RoleProfile[]; knowledgeSources: KnowledgeSource[]; createdAt: string; updatedAt: string;
};
export type ProjectBindings = Pick<Project, 'name' | 'description' | 'workspace' | 'repository'>;
export type WorkspaceReadiness = {
  status: 'ready' | 'blocked' | 'unavailable';
  code: 'READY' | 'WORKSPACE_UNAVAILABLE' | 'GIT_UNAVAILABLE' | 'GIT_REPOSITORY_REQUIRED' | 'GIT_ROOT_MISMATCH' | 'GIT_COMMIT_REQUIRED' | 'GIT_INSPECTION_FAILED';
  sourceCommit?: string;
};
export type ProjectReadiness = {
  projectId: string; projectRevision: number; observedAt: string; workspace: WorkspaceReadiness;
  knowledge: {status: 'not_configured' | 'not_indexed' | 'indexed' | 'issues'; configuredSources: number; indexedSources: number; currentEntries: number; missingEntries: number; errorEntries: number; lastSyncedAt?: string};
};
export type Stage = {
  id: string; name: string; roleId: string; executor: Executor; dependsOn: string[]; prompt: string; review: boolean;
  executionPurpose?: 'review'; ownerGate?: boolean; deliveryPreparation?:boolean;
  reworkTo?: string;
  inputs?:string[]; outputs?:string[]; checks?:string[];
  condition?:{stageId:string;outcome:'done'|'no_change'|'revise'|'blocked'};
  position?:{x:number;y:number};
  options?: {repository?: string; workflow?: string; ref?: string; runId?: number; mode?: 'observe' | 'dispatch'; pipelineId?: string};
};
/** Deprecated execution quotas are retained only as readable historical metadata. */
export type RunPolicy = {concurrency?: number; maxAttempts?: number; maxIterations?: number; timeoutSeconds?: number; tokenBudget?: number};
export type Pipeline = {id: string; projectId: string; revision: number; name: string; description: string; roleId: string; stages: Stage[]; policy: RunPolicy; updatedAt: string; origin?:DefinitionOrigin;templateBindingId?:string};
export type KnowledgeEntry = {
  id: string; projectId: string; sourceId: string; kind: KnowledgeSource['kind'] | 'lesson'; roles: string[];
  title: string; content: string; hash: string; revision: number; sourcePath?: string; sourceRevision?: string;
  syncedAt: string; status: 'current' | 'missing' | 'error' | 'archived' | 'proposed' | 'declined'; error?: string; errorCode?: 'SOURCE_CONFIGURATION_CHANGED'; originRunId?: string;
  lifecycleRevision?: number;
  purpose?:KnowledgePurpose; purposeOrigin?:KnowledgePurposeOrigin; sourceLineStart?:number; proposal?:LessonProposal;
};
export type LessonLifecycleInput = {expectedRevision:number;expectedLifecycleRevision:number;archived:boolean};
export type Artifact = {label: string; path?: string; url?: string};
export type TaskOutput = {outcome: 'done' | 'revise' | 'blocked' | 'no_change'; summary: string; artifacts: Artifact[]; observations: string[]};
export type Usage = {input: number; output: number; total: number; cachedInput?:number};
/** Count newly processed tokens; retain gross and cached diagnostics for inspection. */
export function budgetTokens(usage:Usage):number{return usage.cachedInput===undefined?usage.total:Math.max(0,usage.input-usage.cachedInput)+usage.output;}
export type ExecutionRef = {threadId?: string; turnId?: string; externalId?: string; url?: string; childRunId?: string;provider?:'codex'|'multica'|'github';issueId?:string;agentId?:string;runtimeId?:string};
export type Attempt = {
  id: string; number: number; iteration: number; status: WorkStatus; startedAt: string; endedAt?: string;
  output?: TaskOutput; error?: string; ref?: ExecutionRef; usage?: Usage;
  tokenReservation?: number; failureCode?: string; admissionHeld?:boolean;
  nativeGoal?: {status:string; tokensUsed:number; timeUsedSeconds:number};
  nativeGoalCleared?: boolean;
  nativeCleanupConfirmed?: boolean;
  nativeDispatchState?:'unknown'|'dispatching'|'not_dispatched'|'terminal'; nativeDispatched?:boolean;
  allowanceExecutionId?:string; allowanceFinishedAt?:string; allowanceFinishError?:'ACCOUNT_OBSERVATION_PENDING';
  provider?:'codex'|'multica'|'github'|'manual';
  nativeConfiguration?: {model?:string; modelProvider?:string; reasoningEffort?:string|null; serviceTier?:string|null};
  knowledgeContextId?:string;
  browserContinuationId?:string;
  review?: {decision: 'accept' | 'revise'; note: string; actor: string; at: string};
};
export type StageRun = {stageId: string; status: WorkStatus; attempts: Attempt[];resumeChildRunId?:string;childInputInvalidated?:boolean;allowanceHold?:{code:string;assessmentKey?:string}};
export type Trigger = {kind: 'human' | 'agent' | 'loop' | 'replay'; actor: string};
export type WorkflowSelection={method:'manual'|'owner-api'|'agent-tool'|'coordinator'|'dependency';pipeline:{id:string;revision:number};reason?:string;sourceRunId?:string;intakeId?:string;decisionRound?:number};
export type Run = {
  executionKind?: 'native-goal'|'agent-goal';
  id: string; projectId: string; pipelineId: string; goal: string; baseline: string; trigger: Trigger;
  status: WorkStatus; iteration: number; mode: 'once' | 'loop'; createdAt: string; updatedAt: string; endedAt?: string;
  dependsOnRunIds: string[]; parentRunId?: string; parentStageId?: string; idempotencyKey: string; inputHash: string;
  pausedAt?:string;
  snapshot: {project: Project; pipeline: Pipeline; pipelines: Pipeline[]; knowledge: KnowledgeEntry[]; conversation?: IntakeConversation;knowledgeCorpusId?:string};
  stages: StageRun[]; stopReason?: string; cancelRequested?: boolean;
  continuationDeclined?:{at:string;actor:string;note:string};
  recoveryOfRunId?:string;
  reviewSupport?:{runId:string;stageId:string;attemptId:string;controlRevision:number;sourceManifestHash:string;upstream:{stageId:string;name:string;attemptId?:string;output?:TaskOutput}[]};
  selection?:WorkflowSelection;
  approvedPolicy?: RunPolicy;
  resourceMode?:'account'|'tokens';
  accountApprovals?:AccountStepApproval[];controlRevision?:number;
  browserContinuations?:BrowserContinuation[];
  limitRevisions?:{revision:number;policy:RunPolicy;note:string;actor:string;at:string}[];
};
/** Explicit owner authority for one subsequent attempt; the run snapshot stays frozen. */
export type BrowserContinuation={id:string;stageId:string;roleId:string;afterAttemptId:string;projectRevision:number;browser:{origins:string[]};actor:string;at:string;note:string;revokedAt?:string};
/** An account hold before dispatch does not consume the owner's browser authority. */
export function pendingBrowserContinuation(run:Run,stageId:string):BrowserContinuation|undefined {
  const attempts=run.stages.find(stage=>stage.stageId===stageId)?.attempts??[];
  return run.browserContinuations?.findLast(binding=>{
    if(binding.stageId!==stageId||binding.revokedAt)return false;
    const index=attempts.findIndex(attempt=>attempt.id===binding.afterAttemptId);
    return index>=0&&attempts.slice(index+1).every(attempt=>attempt.browserContinuationId===binding.id&&attempt.admissionHeld===true);
  });
}
export function attemptRole(run:Run,stageId:string,attempt?:Attempt):RoleProfile|undefined {
  const stage=run.snapshot.pipeline.stages.find(value=>value.id===stageId),role=run.snapshot.project.roles.find(value=>value.id===stage?.roleId);
  if(role&&stage?.deliveryPreparation)return{...role,sandbox:'read-only',skills:[],tools:role.tools.filter(tool=>DELIVERY_PREPARATION_TOOLS.includes(tool)),browser:undefined,multica:role.multica?{...role.multica,skillIds:[],mcpServerIds:[]}:undefined};
  const binding=attempt?.browserContinuationId&&run.browserContinuations?.find(value=>value.id===attempt.browserContinuationId&&value.stageId===stageId&&value.roleId===role?.id);
  return role&&binding?{...role,tools:[...role.tools.filter(tool=>tool!=='browser.use'),'browser.use'],browser:structuredClone(binding.browser)}:role;
}
export function runPolicy(run:Run):RunPolicy{return run.limitRevisions?.at(-1)?.policy??run.approvedPolicy??run.snapshot.pipeline.policy;}
export type AccountStepApproval={stageId:string;assessmentKey:string;accountSnapshotId:string;at:string;actor:string;used?:boolean;revoked?:boolean};
export type RunAllowance = {policy:RunPolicy;usedTokens:number;reservedTokens:number;remainingTokens?:number;usageComplete:boolean};
export type GoalAllowance = {id:string;usedTokens:number;reservedTokens:number;remainingTokens?:number;remainingSeconds?:number;remainingRounds?:number;resourceMode?:'account'|'tokens';status?:Intake['status']};
export type RecoveryScope = {kind:'run'|'goal';id:string};
export type RunRecovery = {
  runId:string;stageId?:string;recoveryKey:string;action:'retry'|'approve'|'reconcile'|'wait'|'blocked'|'none';
  account?:AllowanceAssessment;accountAcknowledgementRequired?:boolean;resourceMode?:'account'|'tokens';
  code:string;reason:string;limitRevision:number;allowance:RunAllowance;stageAttempts?:number;scope:RecoveryScope;
  recommendation?:{limits:Partial<RunPolicy>;note:string;basis:{usedTokens:number;reservedTokens:number;previousAttemptTokens?:number;attempts:number;previousPolicy:RunPolicy;purpose:'one-failed-stage'}};goal?:GoalAllowance;
};
export type ContinueRunInput = {stageId:string;recoveryKey:string;note?:string;approveRecommendation?:boolean;resourceMode?:'account'|'tokens';approveAccountStep?:boolean;accountAssessmentKey?:string};
export type ResolveRunInput = Omit<ContinueRunInput,'recoveryKey'> & {
  idempotencyKey:string;attemptId?:string;controlRevision?:number;recoveryKey?:string;
};
export type RunReworkInput = {attemptId:string;controlRevision:number;idempotencyKey:string;note:string};
/** The frozen workflow, never a caller-supplied destination, owns this handoff. */
export function configuredReworkTarget(run:Run,stageId:string):Stage|undefined {
  const source=run.snapshot.pipeline.stages.find(stage=>stage.id===stageId),state=run.stages.find(stage=>stage.stageId===stageId);
  if(run.executionKind||run.cancelRequested||['completed','cancelled'].includes(run.status)||source?.executor!=='codex'||!state||!['failed','interrupted'].includes(state.status)||!source.reworkTo||source.reworkTo===stageId)return;
  const ancestors=new Set(source.dependsOn);let changed=true;
  while(changed){changed=false;for(const stage of run.snapshot.pipeline.stages)if(ancestors.has(stage.id))for(const id of stage.dependsOn)if(!ancestors.has(id)){ancestors.add(id);changed=true;}}
  return ancestors.has(source.reworkTo)?run.snapshot.pipeline.stages.find(stage=>stage.id===source.reworkTo):undefined;
}
export type RunResolution = {status:'continued';run:Run}|{status:'needs_input';recovery:RunRecovery};
export type AuditEvent = {seq: number; at: string; projectId: string | null; runId: string | null; stageId: string | null; type: string; actor: string; message: string; data?: unknown};
export type Proposal = {id: string; projectId: string; pipelineId: string; runId?: string; baseRevision: number; definition: Pipeline; rationale: string; status: 'pending' | 'applied' | 'rejected'; createdAt: string};
export type ModelInfo = {id: string; name: string; efforts: string[]; isDefault?: boolean};
export type CodexInfo = {available: boolean; connected: boolean; authenticated?: boolean; version?: string; models: ModelInfo[]; error?: string; dynamicTools?: boolean};
export type IntegrationInfo = {codex: CodexInfo; github: {available: boolean; authenticated: boolean; error?: string};multica?:{available:boolean;authenticated:boolean;connected:boolean;serverVersion?:string;error?:unknown}};
export type ProjectOverview = Project & {runCount: number; activeRuns: number; waitingRuns: number; knowledgeCount: number; pipelineCount: number};
export type WorkspaceWork = {id:string;projectId:string;kind:'goal'|'run';title:string;status:Intake['status']|WorkStatus;updatedAt:string;resultKind?:'answer';pipelineName?:string;stageName?:string;attention?:boolean;waitingForInput?:boolean;routerRunId?:string;controlRevision?:number;recoveryPhase?:WorkRecoveryRecord['phase'];recoveryId?:string};
export const activeRecoveryPhases:ReadonlySet<string>=new Set(['checking','backoff','retrying','resuming']);
export type WorkspaceDecision = {id:string;projectId:string;kind:'clarification'|'review'|'manual'|'account';title:string;request:string;intakeId?:string;runId?:string;stageId?:string;workKind:'goal'|'run';workId:string};
export type WorkspaceSummary = {projects:Pick<ProjectOverview,'id'|'name'|'repository'|'revision'|'pipelineCount'>[];work:WorkspaceWork[];decisions:WorkspaceDecision[];sequence:number;observedAt:string};
export type IntakeConversation = {rootIntakeId:string;turns:{intakeId:string;request:string;response:string;resultKind:'answer'|'delivery';at:string;basisRevision:number;sourceRunId:string;clarifications?:{question:string;response:string}[];omittedClarifications?:number;truncated?:boolean}[];omittedTurns:number};
export type Intake = {
  id: string; projectId: string; request: string; baseline: string;
  status: 'routing' | 'dispatched' | 'clarification' | 'failed' | 'completed' | 'stopped' | 'retry_wait'; createdAt: string; updatedAt: string;
  routerRunId: string; targetRunId?: string; pipelineId?: string; rationale?: string; question?: string; error?: string;
  idempotencyKey: string; targetRunIds: string[]; rounds: IntakeRound[]; policy: IntakePolicy; outcome?: string; resultKind?: 'answer';
  parentIntakeId?:string; conversation?:IntakeConversation; continuationPending?:boolean;
  supervisorRunIds?: string[]; basisRevision?:number; recoveryHistory?:GoalRecoveryRecord[]; nextRetryAt?:string;
  lastFailure?:GoalFailure; canRetry?:boolean; retryBlockedReason?:string;
  retryBlockedCode?:string;retryBlockedScope?:RecoveryScope;retryBlockedStageId?:string;allowance?:GoalAllowance;
  resourceMode?:'account'|'tokens';account?:AllowanceAssessment;accountAcknowledgementRequired?:boolean;
  recoveryKey?:string;recoveryRecommendation?:GoalContinuationRecommendation;limitReached?:'rounds';controlRevision?:number;
  limitRevisions?:{revision:number;previousPolicy:IntakePolicy;policy:IntakePolicy;note:string;actor:string;at:string;approvedRecommendation?:{key:string;recommendation:GoalContinuationRecommendation}}[];
  executionTimeMeter?:'active-windows-v1'; executionTime?:{usedSeconds:number; remainingSeconds?:number; totalElapsedSeconds:number};
  workRecoveryHistory?:WorkRecoveryRecord[];
};
export type WorkRecoveryRecord = {
  note?:string;
  idempotencyKey?:string;inputHash?:string;browserContinuation?:BrowserContinuation;
  id:string;trigger:'manual'|'automatic';phase:'checking'|'backoff'|'retrying'|'resuming'|'completed'|'needs_input'|'cancelled';
  runId:string;stageId:string;attemptId?:string;routerRunId:string;controlRevision:number;runControlRevision?:number;
  startedAt:string;deadlineAt:string;nextAt:string;checks:number;code:string;error?:string;retriedAt?:string;endedAt?:string;
};
export type WorkResumeInput={note?:string;idempotencyKey?:string;controlRevision?:number;target?:{runId:string;stageId:string;attemptId:string;runControlRevision:number};browserProjectRevision?:number};
export type GoalRecoveryPolicy = {autoRetry:boolean; maxAttempts?:number; backoffSeconds:number; allowedFallbackModels:string[]};
/** Numeric fields describe legacy snapshots; they do not constrain current work. */
export type IntakePolicy = {maxRounds?: number; maxParallel?: number; maxTotalTokens?: number; maxElapsedSeconds?: number; recovery?:GoalRecoveryPolicy;smartRetry?:boolean};
export type GoalContinuationRecommendation = {policy:Partial<Pick<IntakePolicy,'maxRounds'|'maxTotalTokens'|'maxElapsedSeconds'>>;basis:{usedTokens:number;reservedTokens:number;usedSeconds:number;actionRounds:number;previousPolicy:IntakePolicy};purpose:'one-focused-continuation'};
export type GoalFailure = {kind:'capacity'|'other'; message:string; code?:string; at:string; runId:string; native:boolean};
export type GoalRecoveryRecord = {
  id:string; trigger:'manual'|'automatic'; status:'scheduled'|'started'|'completed'|'failed'|'cancelled'; at:string;
  reason:string; note:string; model?:string; actualModel?:string; previousRunId:string; newRunId?:string;
  previousRef?:ExecutionRef; newRef?:ExecutionRef; basisRevision:number; previousBasisRevision:number;
  refreshConfiguration:boolean; previousPolicy?:IntakePolicy; newPolicy?:IntakePolicy; error?:string;
  replyToQuestion?:string;
  workRecoveryId?:string;
  recoveryBasis?:{cause:string;progress:string;guidance?:string};
  startedAt?:string; endedAt?:string;
  approvedRecommendation?:{key:string;recommendation:GoalContinuationRecommendation};
};
export type IntakeRetryInput = {resourceMode?:'account'|'tokens';approveAccountStep?:boolean;accountAssessmentKey?:string;note?:string; model?:string; refreshConfiguration?:boolean;recoveryKey?:string;approveRecommendation?:boolean; policy?:{maxRounds?:number; maxTotalTokens?:number; maxElapsedSeconds?:number; recovery?:GoalRecoveryPolicy}};
export type IntakeDecision = {action: 'dispatch' | 'retry' | 'complete' | 'answer' | 'clarify' | 'stop'; rationale: string; expectedGain: string; tasks: {pipelineId: string; goal: string}[]; response?: string; question?: string; retry?:{runId:string;stageId:string;note:string}};
export type IntakeRound = {number: number; routerRunId: string; targetRunIds: string[]; decision?: IntakeDecision};
export type ProjectDetail = {project: Project; pipelines: Pipeline[]; runs: Run[]; knowledge: KnowledgeEntry[]; proposals: Proposal[]; events: AuditEvent[]; intakes: Intake[]};
export type Actor = {name: string; kind: 'human' | 'agent'; projectId?: string; tools?: ControlTool[]};
export type StartRunInput = {projectId: string; pipelineId: string; goal: string; baseline: string; mode?: 'once' | 'loop'; dependsOnRunIds?: string[]; idempotencyKey: string; knowledgeIds?: string[]; trigger?: Trigger; parentRunId?: string; parentStageId?: string;limits?:Partial<RunPolicy>;resourceMode?:'account'|'tokens';approveAccountStep?:boolean;accountAssessmentKey?:string};
export type KnowledgeSyncResult = {entries: KnowledgeEntry[]; stats: {added: number; changed: number; unchanged: number; missing: number; errors: number}};

/** Accepted or deliberately ended work no longer requests a recovery decision. */
export const isClosedWorkStatus=(status:string)=>['stopped','completed','cancelled','skipped'].includes(status);

export function currentGoalRecovery(goal:Pick<Intake,'status'|'routerRunId'|'controlRevision'|'workRecoveryHistory'>):WorkRecoveryRecord|undefined {
  const record=goal.workRecoveryHistory?.at(-1);
  if(isClosedWorkStatus(goal.status)||!record||record.code==='RECOVERY_SUPERSEDED'
    ||record.controlRevision!==(goal.controlRevision??0)||record.routerRunId!==goal.routerRunId)return undefined;
  return record;
}

/** Historical child gates cannot reopen their closed owning run or goal. */
export function runAcceptsInput(run:Run,runs:Run[],goals:Intake[]):boolean {
  let current=run;const seen=new Set<string>();
  while(!seen.has(current.id)){
    seen.add(current.id);if(isClosedWorkStatus(current.status)||current.cancelRequested||current.continuationDeclined)return false;
    const owner=goals.find(goal=>goal.projectId===current.projectId&&[goal.routerRunId,...(goal.supervisorRunIds??[]),...goal.targetRunIds].includes(current.id));
    if(owner)return !isClosedWorkStatus(owner.status);
    const parent=runs.find(value=>value.projectId===current.projectId&&value.id===current.parentRunId);
    if(!parent)return true;current=parent;
  }
  return true;
}
