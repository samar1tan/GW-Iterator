import type {Effort, Usage} from './contracts.ts';

export type AccountAllowanceWindow = {
  bucketId:string; bucketName?:string; slot:'primary'|'secondary'; usedPercent:number;
  remainingPercent:number; windowDurationMins:number; resetsAt:number;
};
export type AccountAllowanceSnapshot = {
  id:string; status:'available'|'unavailable'; observedAt:string; expiresAt:string;
  source:'local-codex'; windows:AccountAllowanceWindow[]; exhausted:boolean; reason?:string;
};
export type AccountAllowanceObservation = AccountAllowanceSnapshot & {accountKey?:string};
export type AllowanceTarget = {
  projectId:string; pipelineId:string; stageId:string; roleId:string; model:string|null;
  effort:Effort; kind:'stage'|'planner'; runId?:string; attemptId?:string;
};
export type ExecutionTrend = {
  sampleCount:number; comparableCount:number; direction:'rising'|'steady'|'falling'|'unknown';
  durationSeconds?:{low:number;high:number};
  windows:{bucketId:string;slot:'primary'|'secondary';windowDurationMins:number;lowPercent:number;highPercent:number}[];
  attribution:'shared-account-observation'; reasons:string[];
};
export type AllowanceAssessment = {
  key:string; status:'ready'|'learning'|'caution'|'exhausted'|'unavailable'; code:string;
  account:AccountAllowanceSnapshot; trend:ExecutionTrend;
  action:'continue'|'wait'|'owner-step'; target?:AllowanceTarget;
  activeExecutions:number;
};
export type AllowanceExecution = {id:string;target:AllowanceTarget;before:AccountAllowanceObservation;startedAt:string};
export type AllowanceFinish = {status:string;dispatched:boolean;usage?:Usage};
export interface AccountAllowanceReader {readAccountAllowance():Promise<AccountAllowanceObservation>}
