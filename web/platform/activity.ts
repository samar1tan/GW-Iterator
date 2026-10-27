import type {AuditEvent} from '../../src/contracts';

export type ActivityCategory = 'work' | 'review' | 'system';
const humanEventTypes = new Set([
  'run.started','run.account_policy','account.step_authorized','run.completed','run.cancelled','run.stopped','run.paused','run.resumed','run.recovered','run.limits_changed','run.dependency','run.loop',
  'stage.started','stage.result','stage.review','stage.failed','stage.retry','stage.limit','stage.timeout','stage.skipped','stage.linked',
  'goal.created','goal.decision','goal.dispatched','goal.clarification','goal.handoff','goal.completed','goal.answered','goal.failed','goal.stopped','goal.interrupted','goal.planner_failed','goal.capacity_failed','goal.policy_approved','goal.policy_extended','goal.stage_retried','goal.recovery_scheduled','goal.recovery_started','goal.recovery_failed','goal.recovery_interrupted','goal.recovery_limit',
  'manual.completed','github.observed','multica.steered','multica.steer_pending','codex.steered',
]);
export function isHumanActivity(event: AuditEvent): boolean {
  return humanEventTypes.has(event.type) || /(?:^|\.)verification\.(prepared|checked)$/.test(event.type);
}
export type ActivityGroup = {key:number; event:AuditEvent; count:number; lastSeq:number;lastAt:string};
export function groupHumanActivity(events: AuditEvent[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const event of events.filter(isHumanActivity)) {
    const previous = groups.at(-1);
    const sameResult = !!previous && ['stage.result','manual.completed'].includes(previous.event.type) && ['stage.result','manual.completed'].includes(event.type);
    if (previous && previous.event.projectId === event.projectId && previous.event.runId === event.runId && previous.event.stageId === event.stageId && previous.event.message === event.message && (sameResult || (previous.event.type === event.type && previous.event.actor === event.actor))) {
      previous.count++; if (!sameResult || event.type === 'manual.completed') previous.event = event; previous.lastSeq = event.seq;previous.lastAt=event.at;
    } else groups.push({key:event.seq,event,count:1,lastSeq:event.seq,lastAt:event.at});
  }
  return groups;
}
export function activityCategory(type: string): ActivityCategory {
  if (/review|proposal|clarification|decision/.test(type)) return 'review';
  if (/^(run|stage|goal|manual)\.|\.message$/.test(type)) return 'work';
  return 'system';
}
export function activityTitle(type: string) {
  if (type === 'account.step_authorized' || type === 'run.account_policy') return 'eventAccountDecision';
  if (type === 'stage.result' || type === 'manual.completed') return 'eventStageResult';
  if (/(?:^|\.)verification\.prepared$/.test(type)) return 'eventVerificationPrepared';
  if (/(?:^|\.)verification\.checked$/.test(type)) return 'eventVerificationChecked';
  if (type === 'goal.answered') return 'eventAnswered';
  if (type === 'github.observed') return 'eventCiStatus';
  if (/handoff|dependency|stage\.linked/.test(type)) return 'eventHandoff';
  if (/steer|guidance/.test(type)) return 'eventGuidance';
  if (/review|proposal|decision/.test(type)) return 'eventReview';
  if (/recover|retri|retry|limits|policy_extended|policy_approved|reconcil/.test(type)) return 'eventRecovery';
  if (/fail|timeout|interrupt|denied|circuit|limit/.test(type)) return 'eventFailed';
  if (/stopped|cancel|stopping|ended/.test(type)) return 'eventCancelled';
  if (/clarification|waiting|paused/.test(type)) return 'eventWaiting';
  if (/knowledge/.test(type)) return 'eventKnowledge';
  if (/artifact|evidence|verification/.test(type)) return 'eventArtifact';
  if (/configuration|updated|created|synced/.test(type) && /project|pipeline|configuration/.test(type)) return 'eventConfiguration';
  if (/completed/.test(type)) return 'eventCompleted';
  if (/started|dispatched|resumed/.test(type)) return 'eventStarted';
  return 'eventRecorded';
}
export function mergeActivity(previous: AuditEvent[], incoming: AuditEvent[]): AuditEvent[] {
  const known = new Set(previous.map(event => event.seq));
  const added = incoming.filter(event => {if (known.has(event.seq)) return false; known.add(event.seq); return true;});
  if (!added.length) return previous;
  return [...previous, ...added].sort((a, b) => a.seq - b.seq);
}
