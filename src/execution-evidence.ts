import {isNativeCapacityFailure} from './execution-failures.ts';
import type {Intake} from './contracts.ts';

/** A rejected historical preparation has no accepted round to supply its identity. */
export function plannerStageIdentity(item:Pick<Intake,'projectId'|'rounds'>,runId:string,records:readonly {projectId:string;runId:string;stageId:string}[]):string|undefined {
  const round=item.rounds.find(round=>round.routerRunId===runId);
  if(round)return `decision-${round.number}`;
  const owned=records.filter(record=>record.projectId===item.projectId&&record.runId===runId);
  if(!owned.length)return `decision-${item.rounds.length+1}`;
  return owned.length===1&&/^decision-[1-9]\d*$/.test(owned[0].stageId)&&Number(owned[0].stageId.slice(9))<=item.rounds.length+1?owned[0].stageId:undefined;
}

/** Transport identities are not evidence of a different execution failure. */
export function executionFailureIdentity(attempt:{failureCode?:string;error?:string},fallback?:string):string{
  const message=attempt.error??fallback??'';
  if(isNativeCapacityFailure(message,attempt.failureCode))return 'model_capacity';
  const cause=message.replace(/\b(?:request|trace|correlation)[ _-]?id\s*[:=]?\s*[^\s,;]+/gi,'')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g,'')
    .replace(/\s+/g,' ').trim();
  return JSON.stringify([attempt.failureCode??'execution_failure',cause]);
}
