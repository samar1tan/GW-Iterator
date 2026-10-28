import type {Run} from '../../src/contracts';
import {useI18n} from '../i18n';
import {Icon} from '../Icons';

export function WorkflowBasis({run}:{run:Run}){
  const {t}=useI18n(),origin=run.snapshot.pipeline.origin,selection=run.selection;
  if(!origin&&!selection)return null;
  const originKey=origin?({builtin:'workflowBuiltin',manual:'workflowManual',copy:'workflowCopy',adoption:'workflowAdoption',template:'workflowTemplate',import:'workflowImport',proposal:'workflowProposal'} as const)[origin.kind]:undefined;
  const selectionKey=selection?({manual:'workflowChosenManually','owner-api':'workflowChosenOwnerApi','agent-tool':'workflowChosenTool',coordinator:'workflowChosenCoordinator',dependency:'workflowChosenDependency'} as const)[selection.method]:undefined;
  return <details className="pf-workflow-basis"><summary><Icon name="workflow"/>{t('workflowBasis')}</summary><dl className="metadata-list"><div><dt>{t('workflowOrigin')}</dt><dd>{originKey?t(originKey):t('workflowUnknownOrigin')}{origin?.kind==='template'&&<> · r{origin.template.revision}</>}</dd></div>{selectionKey&&<div><dt>{t('workflowSelection')}</dt><dd>{t(selectionKey)}{selection?.reason&&<p>{selection.reason}</p>}</dd></div>}<div><dt>{t('revision',{revision:run.snapshot.pipeline.revision})}</dt><dd>{run.snapshot.pipeline.name}</dd></div></dl></details>;
}
