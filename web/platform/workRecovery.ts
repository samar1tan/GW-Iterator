import type {Intake,Run,WorkRecoveryRecord} from '../../src/contracts.ts';
import {activeRecoveryPhases} from '../../src/contracts.ts';
import {currentGoalRecovery,isClosedWorkStatus} from '../../src/contracts.ts';

const phaseOrder={checking:0,backoff:1,retrying:2,resuming:3,completed:4,needs_input:4,cancelled:4};
export const currentWorkRecovery=currentGoalRecovery;
export const workRecoveryPending=(goal:Intake)=>activeRecoveryPhases.has(currentWorkRecovery(goal)?.phase??'');
export const recoveryPhaseObserved=(actual:WorkRecoveryRecord['phase']|undefined,expected:WorkRecoveryRecord['phase'])=>!!actual&&phaseOrder[actual]>=phaseOrder[expected];

export function workRecoveryTiming(record:WorkRecoveryRecord,now:number){
  const next=Date.parse(record.nextAt),deadline=Date.parse(record.deadlineAt);
  return{nextSeconds:Math.max(0,Math.ceil((next-now)/1000)),remainingSeconds:Math.max(0,Math.ceil((deadline-now)/1000)),expired:!Number.isFinite(next)||!Number.isFinite(deadline)||now>=deadline};
}

/** A same-router recovery receipt has its own durable observation identity. */
export function recoveryReceiptObserved(current:Intake,receipt:Intake):boolean {
  if((current.controlRevision??0)>(receipt.controlRevision??0))return true;
  if((current.controlRevision??0)<(receipt.controlRevision??0))return false;
  if(isClosedWorkStatus(current.status)&&!isClosedWorkStatus(receipt.status)&&current.routerRunId===receipt.routerRunId&&Date.parse(current.updatedAt)>=Date.parse(receipt.updatedAt)){
    const expected=receipt.workRecoveryHistory?.at(-1);
    if(!expected||current.workRecoveryHistory?.some(record=>record.id===expected.id))return true;
  }
  if(current.routerRunId!==receipt.routerRunId&&current.supervisorRunIds?.includes(receipt.routerRunId))return true;
  const expected=currentWorkRecovery(receipt),actual=currentWorkRecovery(current);
  if(!expected)return current.routerRunId===receipt.routerRunId&&(current.limitRevisions?.length??0)>=(receipt.limitRevisions?.length??0)&&Date.parse(current.updatedAt)>=Date.parse(receipt.updatedAt);
  if(!actual)return false;
  if(actual.id!==expected.id)return !!current.workRecoveryHistory?.some(record=>record.id===expected.id)||Date.parse(actual.startedAt)>Date.parse(expected.startedAt);
  return phaseOrder[actual.phase]>phaseOrder[expected.phase]||actual.phase===expected.phase&&actual.checks>=expected.checks;
}

export function newRecoveryReceipt(receipt:Intake,previous:Pick<Intake,'workRecoveryHistory'>):boolean {
  const next=currentWorkRecovery(receipt),before=previous.workRecoveryHistory?.at(-1);
  return !!next&&(!before||next.id!==before.id||next.phase!==before.phase||next.checks!==before.checks);
}

export function recoveryTarget(goal:Intake,runs:Run[]) {
  const record=currentWorkRecovery(goal);
  const candidate=record&&record.phase!=='completed'?runs.find(run=>run.id===record.runId):undefined;
  const candidateState=candidate?.stages.find(stage=>stage.stageId===record?.stageId);
  const recorded=candidate&&(workRecoveryPending(goal)||!!candidateState&&(['failed','interrupted','cancelled'].includes(candidateState.status)||!!candidateState.allowanceHold))?candidate:undefined;
  const run=recorded??runs.find(run=>!run.executionKind&&run.stages.some(stage=>['failed','interrupted','cancelled'].includes(stage.status)||!!stage.allowanceHold))??runs.find(run=>run.id===goal.routerRunId);
  const stage=recorded?run?.stages.find(stage=>stage.stageId===record!.stageId):run?.stages.find(stage=>['failed','interrupted','cancelled'].includes(stage.status)||!!stage.allowanceHold)??run?.stages[0];
  return{run,stage,definition:run?.snapshot.pipeline.stages.find(item=>item.id===stage?.stageId)};
}

export function canRequestWorkRecovery(goal:Intake,runs:Run[]):boolean {
  if(goal.status==='completed'||goal.status==='clarification'||workRecoveryPending(goal))return false;
  if(currentWorkRecovery(goal)?.code==='EXTERNAL_REVIEW_REQUIRED')return false;
  if(!['failed','stopped','dispatched'].includes(goal.status))return false;
  if(runs.some(run=>!['completed','failed','interrupted','cancelled','skipped'].includes(run.status)))return false;
  const {stage,run}=recoveryTarget(goal,runs);
  return !!stage&&(['failed','interrupted','cancelled'].includes(stage.status)||!!run?.executionKind&&stage.status==='completed');
}

const messages={
  CONFIRMING_TERMINATION:'workConfirming',RETRY_SCHEDULED:'workBackoff',RETRYING_STEP:'workRetrying',RESUMING_COORDINATION:'workResuming',RECOVERY_COMPLETED:'workRecoveryCompleted',RECOVERY_CANCELLED:'workRecoveryCancelled',
  TERMINATION_UNCONFIRMED:'workTerminationUnconfirmed',EXTERNAL_RECONCILIATION_REQUIRED:'workTerminationUnconfirmed',EXTERNAL_REVIEW_REQUIRED:'workExternalReview',AUTOMATIC_RETRY_LIMIT:'workAutomaticLimit',REPEATED_TIMEOUT:'workRepeatedTimeout',RETRY_FAILED:'workRetryFailed',GOAL_BOUNDARY:'workGoalBoundary',RECOVERY_TARGET_CHANGED:'workTargetChanged',RECOVERY_CHECK_FAILED:'workCheckFailed',RECOVERY_INTERRUPTED:'workRecoveryInterrupted',
  STAGE_TIMEOUT:'workStepTimeout',STAGE_ATTEMPT_LIMIT:'workAttemptBoundary',RUN_TOKEN_BUDGET:'workRunBoundary',GOAL_TIME_LIMIT:'workGoalBoundary',GOAL_TOKEN_BUDGET:'workGoalBoundary',GOAL_ROUND_LIMIT:'workGoalBoundary',
  ACCOUNT_ALLOWANCE_EXHAUSTED:'workAccountBoundary',ACCOUNT_LIMIT_REACHED:'workAccountBoundary',ACCOUNT_ALLOWANCE_CAUTION:'workAccountDecision',ACCOUNT_ALLOWANCE_UNAVAILABLE:'workAccountDecision',ACCOUNT_STEP_APPROVAL_REQUIRED:'workAccountDecision',WORK_READY_TO_RESUME:'workReadyToResume',
} as const;
export function workRecoveryMessage(code:string) {
  return messages[code as keyof typeof messages]??(code.startsWith('ACCOUNT_')?'workAccountDecision':'workNeedsDecision');
}
