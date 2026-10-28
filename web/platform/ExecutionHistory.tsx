import type {IntakePolicy,RunPolicy} from '../../src/contracts';
import {useCopy} from './copy';

const policyLabels={concurrency:'concurrency',maxAttempts:'attempts',maxIterations:'iterations',timeoutSeconds:'seconds',tokenBudget:'newTokens',maxRounds:'historicalActionRounds',maxParallel:'historicalParallelActions',maxTotalTokens:'newTokens',maxElapsedSeconds:'seconds'} as const;

export function HistoricalExecutionPolicy({policy}:{policy:RunPolicy|IntakePolicy}) {
  const {p,number}=useCopy();
  const entries=Object.entries(policy).filter(([key,value])=>Object.hasOwn(policyLabels,key)&&typeof value==='number'&&Number.isFinite(value));
  const recoveryAttempts='recovery' in policy?policy.recovery?.maxAttempts:undefined;
  if(!entries.length&&recoveryAttempts===undefined)return null;
  return <details className="pf-historical-policy"><summary>{p('historicalExecutionPolicy')}</summary><p className="hint">{p('historicalExecutionPolicyHelp')}</p><dl className="metadata-list">{entries.map(([key,value])=><div key={key}><dt>{p(policyLabels[key as keyof typeof policyLabels])}</dt><dd>{number(value as number)}</dd></div>)}{recoveryAttempts!==undefined&&Number.isFinite(recoveryAttempts)&&<div><dt>{p('historicalRecoveryAttempts')}</dt><dd>{number(recoveryAttempts)}</dd></div>}</dl></details>;
}
