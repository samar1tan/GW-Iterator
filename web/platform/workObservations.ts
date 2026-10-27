import type {Intake, ProjectDetail, Run} from '../../src/contracts.ts';
import {newRecoveryReceipt,recoveryReceiptObserved} from './workRecovery.ts';

export type CreatedWork =
  | {kind: 'run'; value: Run}
  | {kind: 'intake'; value: Intake}
  | {kind: 'continued-intake'; value:Intake;previous:Pick<Intake,'routerRunId'|'status'|'updatedAt'|'controlRevision'|'workRecoveryHistory'>};

function isPriorContinuationState(current:Intake,receipt:Extract<CreatedWork,{kind:'continued-intake'}>):boolean {
  if(newRecoveryReceipt(receipt.value,receipt.previous)||current.routerRunId===receipt.value.routerRunId)return (current.controlRevision??0)<=(receipt.value.controlRevision??0)&&[receipt.previous.routerRunId,receipt.value.routerRunId].includes(current.routerRunId)&&!recoveryReceiptObserved(current,receipt.value);
  const earlierPhase=current.status===receipt.previous.status||receipt.previous.status==='clarification'&&['routing','dispatched','retry_wait'].includes(current.status);
  return current.routerRunId===receipt.previous.routerRunId&&earlierPhase&&(current.controlRevision??0)===(receipt.previous.controlRevision??0)&&Date.parse(current.updatedAt)<=Date.parse(receipt.previous.updatedAt);
}
function continuationObserved(current:Intake,receipt:Extract<CreatedWork,{kind:'continued-intake'}>):boolean {
  if(newRecoveryReceipt(receipt.value,receipt.previous)||current.routerRunId===receipt.value.routerRunId)return recoveryReceiptObserved(current,receipt.value);
  if((current.controlRevision??0)>(receipt.previous.controlRevision??0))return true;
  if(current.routerRunId===receipt.previous.routerRunId||receipt.value.supervisorRunIds?.includes(current.routerRunId))return false;
  return !!current.supervisorRunIds?.includes(receipt.value.routerRunId)||Date.parse(current.updatedAt)>Date.parse(receipt.value.updatedAt);
}

/** Preserve server observations while making an unobserved creation reachable. */
export function withCreatedWork(detail: ProjectDetail, receipt: CreatedWork): ProjectDetail {
  if (receipt.value.projectId !== detail.project.id) return detail;
  if (receipt.kind === 'run') {
    if (detail.runs.some(run => run.id === receipt.value.id)) return detail;
    return {...detail, runs: [receipt.value, ...detail.runs]};
  }
  const current=detail.intakes.find(intake=>intake.id===receipt.value.id);
  if(current){
    if(receipt.kind!=='continued-intake'||!isPriorContinuationState(current,receipt))return detail;
    return{...detail,intakes:detail.intakes.map(intake=>intake.id===receipt.value.id?receipt.value:intake)};
  }
  return {...detail, intakes: [receipt.value, ...detail.intakes]};
}

function auditSequence(detail: ProjectDetail): number {
  return detail.events.reduce((latest, event) =>
    event.projectId === detail.project.id ? Math.max(latest, event.seq) : latest, 0);
}

function containsReceipt(detail: ProjectDetail, receipt: CreatedWork): boolean {
  if (receipt.value.projectId !== detail.project.id) return false;
  if(receipt.kind==='run')return detail.runs.some(run=>run.id===receipt.value.id);
  const current=detail.intakes.find(intake=>intake.id===receipt.value.id);
  return !!current&&(receipt.kind!=='continued-intake'||continuationObserved(current,receipt));
}

/** Only accepted server observations acknowledge pending creation receipts. */
export function observeProjectWork(
  previous: ProjectDetail | null | undefined,
  incoming: ProjectDetail,
  pending: readonly CreatedWork[],
): {detail: ProjectDetail; pending: CreatedWork[]; accepted: boolean} {
  const stale = previous?.project.id === incoming.project.id && (
    incoming.project.revision < previous.project.revision ||
    auditSequence(incoming) < auditSequence(previous)
  );
  let detail = stale && previous ? previous : incoming;
  const remaining: CreatedWork[] = [];
  const identities = new Set<string>();
  for (const receipt of pending) {
    detail = withCreatedWork(detail, receipt);
    if (!stale && containsReceipt(incoming, receipt)) continue;
    const identity = JSON.stringify([receipt.kind, receipt.value.projectId, receipt.value.id,...(receipt.kind==='continued-intake'?[receipt.value.routerRunId,receipt.value.workRecoveryHistory?.at(-1)?.id]:[])]);
    if (!identities.has(identity)) {
      identities.add(identity);
      remaining.push(receipt);
    }
  }
  return {detail, pending: remaining, accepted: !stale};
}
