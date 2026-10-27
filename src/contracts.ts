import type {AllowanceAssessment} from './account-allowance-types.ts';
export const EXECUTORS = ['manual', 'codex', 'github', 'pipeline'] as const;
export type Executor = typeof EXECUTORS[number];
export type WorkStatus = 'queued' | 'running' | 'waiting' | 'review' | 'paused' | 'skipped' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export const currentWorkStatuses:ReadonlySet<string>=new Set(['routing','dispatched','retry_wait','clarification','queued','running','waiting','review','paused']);
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = typeof EFFORTS[number];
export const DEFAULT_EFFORT: Effort = 'max';
export const EFFORT_LABELS: Record<Effort, string> = {low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra'};
export type ControlTool = 'context.read' | 'knowledge.search' | 'knowledge.write' | 'pipeline.read' | 'pipeline.propose' | 'pipeline.write' | 'run.read' | 'run.start' | 'intake.route' | 'project.bootstrap';
export const CONTROL_TOOLS: ControlTool[] = ['context.read','knowledge.search','knowledge.write','pipeline.read','pipeline.propose','pipeline.write','run.read','run.start','intake.route','project.bootstrap'];
export type RoleProfile = {
  id: string; name: string; description: string; instructions: string;
  model: string | null; effort: Effort; sandbox: 'read-only' | 'workspace-write';
  skills: {name: string; path: string}[]; tools: ControlTool[];
  inputs?:string[]; outputs?:string[]; checks?:string[]; retired?:boolean;
  multica?:{agentId?:string;runtimeId?:string;skillIds?:string[];mcpServerIds?:string[]};
};
export type KnowledgeSource = {id: string; kind: 'document' | 'artifact' | 'memory'; path: string; roles: string[]; section?: string};
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
  executionPurpose?: 'review'; ownerGate?: boolean;
  reworkTo?: string;
  inputs?:string[]; outputs?:string[]; checks?:string[];
  condition?:{stageId:string;outcome:'done'|'no_change'|'revise'|'blocked'};
  position?:{x:number;y:number};
  options?: {repository?: string; workflow?: string; ref?: string; runId?: number; mode?: 'observe' | 'dispatch'; pipelineId?: string};
};
export type RunPolicy = {concurrency: number; maxAttempts: number; maxIterations: number; timeoutSeconds: number; tokenBudget: number};
export type Pipeline = {id: string; projectId: string; revision: number; name: string; description: string; roleId: string; stages: Stage[]; policy: RunPolicy; updatedAt: string};
export type KnowledgeEntry = {
  id: string; projectId: string; sourceId: string; kind: KnowledgeSource['kind'] | 'lesson'; roles: string[];
  title: string; content: string; hash: string; revision: number; sourcePath?: string; sourceRevision?: string;
  syncedAt: string; status: 'current' | 'missing' | 'error'; error?: string; errorCode?: 'SOURCE_CONFIGURATION_CHANGED'; originRunId?: string;
};
export type Artifact = {label: string; path?: string; url?: string};
export type TaskOutput = {outcome: 'done' | 'revise' | 'blocked' | 'no_change'; summary: string; artifacts: Artifact[]; observations: string[]};
export type Usage = {input: number; output: number; total: number; cachedInput?:number};
/** Budget newly processed tokens; retain gross and cached counts for inspection. */
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
  review?: {decision: 'accept' | 'revise'; note: string; actor: string; at: string};
};
export type StageRun = {stageId: string; status: WorkStatus; attempts: Attempt[];resumeChildRunId?:string;childInputInvalidated?:boolean;allowanceHold?:{code:string;assessmentKey?:string}};
export type Trigger = {kind: 'human' | 'agent' | 'loop' | 'replay'; actor: string};
export type Run = {
  executionKind?: 'native-goal'|'agent-goal';
  id: string; projectId: string; pipelineId: string; goal: string; baseline: string; trigger: Trigger;
  status: WorkStatus; iteration: number; mode: 'once' | 'loop'; createdAt: string; updatedAt: string; endedAt?: string;
  dependsOnRunIds: string[]; parentRunId?: string; parentStageId?: string; idempotencyKey: string; inputHash: string;
  pausedAt?:string;
  snapshot: {project: Project; pipeline: Pipeline; pipelines: Pipeline[]; knowledge: KnowledgeEntry[]; conversation?: IntakeConversation};
  stages: StageRun[]; stopReason?: string; cancelRequested?: boolean;
  recoveryOfRunId?:string;
  approvedPolicy?: RunPolicy;
  resourceMode?:'account'|'tokens';
  accountApprovals?:AccountStepApproval[];controlRevision?:number;
  limitRevisions?:{revision:number;policy:RunPolicy;note:string;actor:string;at:string}[];
};
export function runPolicy(run:Run):RunPolicy{return run.limitRevisions?.at(-1)?.policy??run.approvedPolicy??run.snapshot.pipeline.policy;}
export type AccountStepApproval={stageId:string;assessmentKey:string;accountSnapshotId:string;at:string;actor:string;used?:boolean;revoked?:boolean};
export type RunAllowance = {policy:RunPolicy;usedTokens:number;reservedTokens:number;remainingTokens:number;usageComplete:boolean};
export type GoalAllowance = {id:string;usedTokens:number;reservedTokens:number;remainingTokens:number;remainingSeconds:number;remainingRounds:number;resourceMode?:'account'|'tokens'};
export type RecoveryScope = {kind:'run'|'goal';id:string};
export type RunRecovery = {
  runId:string;stageId?:string;recoveryKey:string;action:'retry'|'approve'|'reconcile'|'wait'|'blocked'|'none';
  account?:AllowanceAssessment;accountAcknowledgementRequired?:boolean;resourceMode?:'account'|'tokens';
  code:string;reason:string;limitRevision:number;allowance:RunAllowance;stageAttempts?:number;scope:RecoveryScope;
  recommendation?:{limits:Partial<RunPolicy>;note:string;basis:{usedTokens:number;reservedTokens:number;previousAttemptTokens?:number;attempts:number;previousPolicy:RunPolicy;purpose:'one-failed-stage'}};goal?:GoalAllowance;
};
export type ContinueRunInput = {stageId:string;recoveryKey:string;note?:string;approveRecommendation?:boolean;resourceMode?:'account'|'tokens';approveAccountStep?:boolean;accountAssessmentKey?:string};
export type AuditEvent = {seq: number; at: string; projectId: string | null; runId: string | null; stageId: string | null; type: string; actor: string; message: string; data?: unknown};
export type Proposal = {id: string; projectId: string; pipelineId: string; runId?: string; baseRevision: number; definition: Pipeline; rationale: string; status: 'pending' | 'applied' | 'rejected'; createdAt: string};
export type ModelInfo = {id: string; name: string; efforts: string[]; isDefault?: boolean};
export type CodexInfo = {available: boolean; connected: boolean; authenticated?: boolean; version?: string; models: ModelInfo[]; error?: string; dynamicTools?: boolean};
export type IntegrationInfo = {codex: CodexInfo; github: {available: boolean; authenticated: boolean; error?: string};multica?:{available:boolean;authenticated:boolean;connected:boolean;serverVersion?:string;error?:unknown}};
export type ProjectOverview = Project & {runCount: number; activeRuns: number; waitingRuns: number; knowledgeCount: number; pipelineCount: number};
export type WorkspaceWork = {id:string;projectId:string;kind:'goal'|'run';title:string;status:Intake['status']|WorkStatus;updatedAt:string;resultKind?:'answer';pipelineName?:string;stageName?:string;attention?:boolean;waitingForInput?:boolean;routerRunId?:string;controlRevision?:number};
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
  executionTimeMeter?:'active-windows-v1'; executionTime?:{usedSeconds:number; remainingSeconds:number; totalElapsedSeconds:number};
};
export type GoalRecoveryPolicy = {autoRetry:boolean; maxAttempts:number; backoffSeconds:number; allowedFallbackModels:string[]};
export type IntakePolicy = {maxRounds: number; maxParallel: number; maxTotalTokens: number; maxElapsedSeconds: number; recovery?:GoalRecoveryPolicy};
export type GoalContinuationRecommendation = {policy:Partial<Pick<IntakePolicy,'maxRounds'|'maxTotalTokens'|'maxElapsedSeconds'>>;basis:{usedTokens:number;reservedTokens:number;usedSeconds:number;actionRounds:number;previousPolicy:IntakePolicy};purpose:'one-focused-continuation'};
export type GoalFailure = {kind:'capacity'|'other'; message:string; code?:string; at:string; runId:string; native:boolean};
export type GoalRecoveryRecord = {
  id:string; trigger:'manual'|'automatic'; status:'scheduled'|'started'|'completed'|'failed'|'cancelled'; at:string;
  reason:string; note:string; model?:string; actualModel?:string; previousRunId:string; newRunId?:string;
  previousRef?:ExecutionRef; newRef?:ExecutionRef; basisRevision:number; previousBasisRevision:number;
  refreshConfiguration:boolean; previousPolicy?:IntakePolicy; newPolicy?:IntakePolicy; error?:string;
  replyToQuestion?:string;
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
