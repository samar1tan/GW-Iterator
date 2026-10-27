import type {Intake, ProjectDetail, Run} from '../../src/contracts';

export type CreatedWork =
  | {kind: 'run'; value: Run}
  | {kind: 'intake'; value: Intake};

/** Preserve server observations while making an unobserved creation reachable. */
export function withCreatedWork(detail: ProjectDetail, receipt: CreatedWork): ProjectDetail {
  if (receipt.value.projectId !== detail.project.id) return detail;
  if (receipt.kind === 'run') {
    if (detail.runs.some(run => run.id === receipt.value.id)) return detail;
    return {...detail, runs: [receipt.value, ...detail.runs]};
  }
  if (detail.intakes.some(intake => intake.id === receipt.value.id)) return detail;
  return {...detail, intakes: [receipt.value, ...detail.intakes]};
}

function auditSequence(detail: ProjectDetail): number {
  return detail.events.reduce((latest, event) =>
    event.projectId === detail.project.id ? Math.max(latest, event.seq) : latest, 0);
}

function containsReceipt(detail: ProjectDetail, receipt: CreatedWork): boolean {
  if (receipt.value.projectId !== detail.project.id) return false;
  return receipt.kind === 'run'
    ? detail.runs.some(run => run.id === receipt.value.id)
    : detail.intakes.some(intake => intake.id === receipt.value.id);
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
    const identity = JSON.stringify([receipt.kind, receipt.value.projectId, receipt.value.id]);
    if (!identities.has(identity)) {
      identities.add(identity);
      remaining.push(receipt);
    }
  }
  return {detail, pending: remaining, accepted: !stale};
}
