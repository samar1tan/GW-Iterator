import {isNativeCapacityFailure} from './execution-failures.ts';

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
