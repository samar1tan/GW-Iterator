import type {Artifact, ControlTool, ExecutionRef, ModelInfo, RoleProfile, TaskOutput, Usage, CodexInfo,Project} from '../contracts.ts';
import type {AccountAllowanceObservation} from '../account-allowance-types.ts';

export type AdapterEvent = {type: string; message: string; ref?: ExecutionRef; usage?: Usage; data?: unknown};
export type CodexExecutionInput = {
  workspace: string; role: RoleProfile; prompt: string; timeoutSeconds?: number; tokenBudget?: number;
  signal: AbortSignal; onEvent: (event: AdapterEvent) => void;
  onTool: (tool: ControlTool, args: Record<string, unknown>) => Promise<unknown>;
};
export type CodexExecution = {ref: ExecutionRef; completion: Promise<{output: TaskOutput; usage?: Usage}>};
export type AgentExecutionInput = CodexExecutionInput & {project:Project;runId:string;stageId:string;attemptId:string;executionPurpose?:'review'};
export interface AgentExecutor {
  start(input:AgentExecutionInput):Promise<CodexExecution>;
  steer(ref:ExecutionRef,text:string):Promise<void|{id:string;status:string}>;
  close?():Promise<void>;
}
export type CodexNativeGoal = {
  threadId: string; objective: string;
  status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
  tokenBudget?: number | null; tokensUsed: number; timeUsedSeconds: number; createdAt: number; updatedAt: number;
};
export type CodexGoalInput = CodexExecutionInput & {objective: string};
export type CodexGoalResult = {status: 'complete' | 'blocked' | 'budgetLimited' | 'usageLimited' | 'cleared'; summary: string; usage?: Usage; nativeGoal?: CodexNativeGoal};
export type CodexGoalExecution = {ref: ExecutionRef; completion: Promise<CodexGoalResult>};
export interface CodexAdapter {
  readAccountAllowance?():Promise<AccountAllowanceObservation>;
  info(): Promise<CodexInfo>;
  skills(workspace: string): Promise<{name: string; path: string; description: string}[]>;
  start(input: CodexExecutionInput): Promise<CodexExecution>;
  startGoal?(input: CodexGoalInput): Promise<CodexGoalExecution>;
  steer(ref: ExecutionRef, text: string): Promise<void>;
  interrupt(ref: ExecutionRef): Promise<void>;
  close(): Promise<void>;
}
export type GithubObservation = {status: 'queued' | 'running' | 'completed' | 'failed'; summary: string; url?: string; runId?: number; artifacts?: Artifact[]; data?: unknown};
export interface GithubAdapter {
  info(): Promise<{available: boolean; authenticated: boolean; error?: string}>;
  observe(repository: string, options: {runId?: number; workflow?: string; ref?: string}): Promise<GithubObservation>;
  dispatch(repository: string, workflow: string, ref: string): Promise<GithubObservation>;
}
