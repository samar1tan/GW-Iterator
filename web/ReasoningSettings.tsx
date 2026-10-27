import {useI18n} from './i18n';
import {EFFORTS, EFFORT_LABELS} from '../src/contracts';
import type {ModelInfo} from '../src/contracts';

export function effortSupported(value:string, model?:ModelInfo){return !model?.efforts.length || model.efforts.includes(value);}
export function EffortOptions({model,value}:{model?:ModelInfo;value:string}){const {t}=useI18n();return <>{!EFFORTS.some(effort=>effort===value)&&<option value={value} disabled={!value}>{value||t('effortNotReported')}</option>}{EFFORTS.map(effort=><option key={effort} value={effort} disabled={!effortSupported(effort,model)}>{EFFORT_LABELS[effort]}</option>)}</>;}
export function ReasoningHelp({model,value}:{model?:ModelInfo;value?:string}={}){const {locale,t}=useI18n();return <><p className="hint" lang={locale}>{t('reasoningHelp')}{' '}<a href="https://codexradar.com/?station=codex" target="_blank" rel="noreferrer">CodexRadar</a>{' '}{t('reasoningAdvisory')}</p>{model&&value&&!effortSupported(value,model)&&<p className="notice warning" role="status">{t('unsupportedEffort',{model:model.name,effort:EFFORT_LABELS[value as keyof typeof EFFORT_LABELS]??value})}</p>}</>;}
