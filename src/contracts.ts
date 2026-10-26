export const EXECUTORS = ['manual', 'codex', 'github', 'pipeline'] as const;
export type Executor = typeof EXECUTORS[number];
export type WorkStatus = 'queued' | 'running' | 'waiting' | 'review' | 'paused' | 'skipped' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';
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
export type Stage = {
  id: string; name: string; roleId: string; executor: Executor; dependsOn: string[]; prompt: string; review: boolean;
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
  syncedAt: string; status: 'current' | 'missing' | 'error'; error?: string; originRunId?: string;
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
  nativeGoal?: {status:string; tokensUsed:number; timeUsedSeconds:number};
  nativeGoalCleared?: boolean;
  nativeCleanupConfirmed?: boolean;
  provider?:'codex'|'multica'|'github'|'manual';
  nativeConfiguration?: {model?:string; modelProvider?:string; reasoningEffort?:string|null; serviceTier?:string|null};
  review?: {decision: 'accept' | 'revise'; note: string; actor: string; at: string};
};
export type StageRun = {stageId: string; status: WorkStatus; attempts: Attempt[]};
export type Trigger = {kind: 'human' | 'agent' | 'loop' | 'replay'; actor: string};
export type Run = {
  executionKind?: 'native-goal'|'agent-goal';
  id: string; projectId: string; pipelineId: string; goal: string; baseline: string; trigger: Trigger;
  status: WorkStatus; iteration: number; mode: 'once' | 'loop'; createdAt: string; updatedAt: string; endedAt?: string;
  dependsOnRunIds: string[]; parentRunId?: string; parentStageId?: string; idempotencyKey: string; inputHash: string;
  pausedAt?:string;
  snapshot: {project: Project; pipeline: Pipeline; pipelines: Pipeline[]; knowledge: KnowledgeEntry[]};
  stages: StageRun[]; stopReason?: string; cancelRequested?: boolean;
  recoveryOfRunId?:string;
};
export type AuditEvent = {seq: number; at: string; projectId: string | null; runId: string | null; stageId: string | null; type: string; actor: string; message: string; data?: unknown};
export type Proposal = {id: string; projectId: string; pipelineId: string; runId?: string; baseRevision: number; definition: Pipeline; rationale: string; status: 'pending' | 'applied' | 'rejected'; createdAt: string};
export type ModelInfo = {id: string; name: string; efforts: string[]; isDefault?: boolean};
export type CodexInfo = {available: boolean; connected: boolean; authenticated?: boolean; version?: string; models: ModelInfo[]; error?: string; dynamicTools?: boolean};
export type IntegrationInfo = {codex: CodexInfo; github: {available: boolean; authenticated: boolean; error?: string};multica?:{available:boolean;authenticated:boolean;connected:boolean;serverVersion?:string;error?:unknown}};
export type ProjectOverview = Project & {runCount: number; activeRuns: number; waitingRuns: number; knowledgeCount: number; pipelineCount: number};
export type Intake = {
  id: string; projectId: string; request: string; baseline: string;
  status: 'routing' | 'dispatched' | 'clarification' | 'failed' | 'completed' | 'stopped' | 'retry_wait'; createdAt: string; updatedAt: string;
  routerRunId: string; targetRunId?: string; pipelineId?: string; rationale?: string; question?: string; error?: string;
  idempotencyKey: string; targetRunIds: string[]; rounds: IntakeRound[]; policy: IntakePolicy; outcome?: string;
  supervisorRunIds?: string[]; basisRevision?:number; recoveryHistory?:GoalRecoveryRecord[]; nextRetryAt?:string;
  lastFailure?:GoalFailure; canRetry?:boolean; retryBlockedReason?:string;
  executionTimeMeter?:'active-windows-v1'; executionTime?:{usedSeconds:number; remainingSeconds:number; totalElapsedSeconds:number};
};
export type GoalRecoveryPolicy = {autoRetry:boolean; maxAttempts:number; backoffSeconds:number; allowedFallbackModels:string[]};
export type IntakePolicy = {maxRounds: number; maxParallel: number; maxTotalTokens: number; maxElapsedSeconds: number; recovery?:GoalRecoveryPolicy};
export type GoalFailure = {kind:'capacity'|'other'; message:string; code?:string; at:string; runId:string; native:boolean};
export type GoalRecoveryRecord = {
  id:string; trigger:'manual'|'automatic'; status:'scheduled'|'started'|'completed'|'failed'|'cancelled'; at:string;
  reason:string; note:string; model:string; actualModel?:string; previousRunId:string; newRunId?:string;
  previousRef?:ExecutionRef; newRef?:ExecutionRef; basisRevision:number; previousBasisRevision:number;
  refreshConfiguration:boolean; previousPolicy?:IntakePolicy; newPolicy?:IntakePolicy; error?:string;
  startedAt?:string; endedAt?:string;
};
export type IntakeRetryInput = {note:string; model?:string; refreshConfiguration?:boolean; policy?:{maxRounds?:number; maxTotalTokens?:number; maxElapsedSeconds?:number; recovery?:GoalRecoveryPolicy}};
export type IntakeDecision = {action: 'dispatch' | 'retry' | 'complete' | 'clarify' | 'stop'; rationale: string; expectedGain: string; tasks: {pipelineId: string; goal: string}[]; question?: string; retry?:{runId:string;stageId:string;note:string}};
export type IntakeRound = {number: number; routerRunId: string; targetRunIds: string[]; decision?: IntakeDecision};
export type ProjectDetail = {project: Project; pipelines: Pipeline[]; runs: Run[]; knowledge: KnowledgeEntry[]; proposals: Proposal[]; events: AuditEvent[]; intakes: Intake[]};
export type Actor = {name: string; kind: 'human' | 'agent'; projectId?: string; tools?: ControlTool[]};
export type StartRunInput = {projectId: string; pipelineId: string; goal: string; baseline: string; mode?: 'once' | 'loop'; dependsOnRunIds?: string[]; idempotencyKey: string; knowledgeIds?: string[]; trigger?: Trigger; parentRunId?: string; parentStageId?: string};
export type KnowledgeSyncResult = {entries: KnowledgeEntry[]; stats: {added: number; changed: number; unchanged: number; missing: number; errors: number}};
