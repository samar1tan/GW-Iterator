import type {RoleProfile,ControlTool} from '../../src/contracts';
import {Field} from '../components';
import {useI18n} from '../i18n';

export function setRoleTool(role:RoleProfile,tool:ControlTool,enabled:boolean,savedBrowser?:RoleProfile['browser']):RoleProfile{
  return{...role,tools:enabled?[...new Set([...role.tools,tool])]:role.tools.filter(value=>value!==tool),...(tool==='browser.use'&&!enabled?{browser:savedBrowser}:{} )};
}

export function BrowserAccess({role,onChange,disabled=false}:{role:RoleProfile;onChange?:(role:RoleProfile)=>void;disabled?:boolean}){
  const{t}=useI18n();if(!role.tools.includes('browser.use'))return null;
  if(!onChange)return <section className="pf-role-section"><h3>{t('browserOrigins')}</h3>{role.browser?.origins.length?<ul>{role.browser.origins.map(origin=><li key={origin}><code>{origin}</code></li>)}</ul>:<p>{t('browserOriginsRequired')}</p>}</section>;
  return <Field label={t('browserOrigins')} hint={t('browserOriginsHelp')}><textarea required rows={3} disabled={disabled} value={role.browser?.origins.join('\n')??''} onChange={event=>{const origins=event.target.value.split('\n');onChange({...role,browser:{origins}});}}/><p className="hint">{t('browserFutureRuns')}</p></Field>;
}
