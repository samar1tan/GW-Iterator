import {useEffect,useRef,useState} from 'react';
import type {RoleProfile} from '../../src/contracts';
import {api,errorText} from '../api';
import {Button,Notice} from '../components';
import {useCopy} from './copy';

export type LocalSkill = {name:string;path:string;description?:string};
export type LocalSkillDiscovery = {checked:boolean;skills:LocalSkill[];error?:unknown};
type Selection = RoleProfile['skills'];

export function localSkillChoices(discovered:LocalSkill[],selected:Selection):LocalSkill[] {
  const choices=new Map(discovered.map(skill=>[skill.path,skill]));
  for(const skill of selected)if(!choices.has(skill.path))choices.set(skill.path,skill);
  return [...choices.values()];
}

export async function discoverLocalRoleSkills(projectId:string,previous:LocalSkillDiscovery,read:(path:string)=>Promise<{skills:LocalSkill[]}>=path=>api(path)):Promise<LocalSkillDiscovery> {
  try {
    const result=await read(`/api/projects/${encodeURIComponent(projectId)}/skills`);
    if(!Array.isArray(result.skills)||result.skills.some(skill=>!skill||typeof skill.path!=='string'||!skill.path||typeof skill.name!=='string'||!skill.name||(skill.description!==undefined&&typeof skill.description!=='string')))throw new Error('Local skill discovery returned an invalid file list.');
    return {checked:true,skills:result.skills};
  } catch(error) {return {...previous,error};}
}

export function LocalRoleSkills({projectId,selected,onChange,disabled=false}:{projectId:string;selected:Selection;onChange:(skills:Selection)=>void;disabled?:boolean}) {
  const [discovery,setDiscovery]=useState<LocalSkillDiscovery>({checked:false,skills:[]}),[loading,setLoading]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setDiscovery({checked:false,skills:[]});setLoading(false);return()=>{generation.current++;};},[projectId]);
  const discover=async()=>{
    if(loading||disabled)return;
    const current=generation.current;setLoading(true);
    const next=await discoverLocalRoleSkills(projectId,discovery);
    if(current===generation.current){setDiscovery(next);setLoading(false);}
  };
  return <LocalRoleSkillsView discovery={discovery} loading={loading} selected={selected} disabled={disabled} onDiscover={()=>void discover()} onChange={onChange}/>;
}

export function LocalRoleSkillsView({discovery,loading=false,selected,onDiscover,onChange,disabled=false}:{discovery:LocalSkillDiscovery;loading?:boolean;selected:Selection;onDiscover:()=>void;onChange:(skills:Selection)=>void;disabled?:boolean}) {
  const {p,t}=useCopy(),choices=localSkillChoices(discovery.skills,selected),discovered=new Set(discovery.skills.map(skill=>skill.path));
  return <fieldset disabled={disabled} aria-busy={loading||undefined}>
    <legend>{p('localCodexSkills')}</legend>
    <p className="hint">{p('localCodexSkillsHelp')}</p>
    <Button disabled={loading} onClick={onDiscover}>{loading?t('loading'):p('discoverLocalSkills')}</Button>
    {discovery.error?<Notice tone="warning"><p>{p('localSkillsReadFailed')}</p><details><summary>{t('details')}</summary><p className="pre-wrap">{errorText(discovery.error)}</p></details></Notice>:!loading&&!discovery.checked?<p className="hint">{p('localSkillsNotChecked')}</p>:!loading&&!choices.length?<p className="hint">{p('noLocalSkills')}</p>:null}
    {choices.length>0&&<div className="check-list skills-list">{choices.map(skill=><label className="check skill-check" key={skill.path}>
      <input type="checkbox" checked={selected.some(item=>item.path===skill.path)} onChange={event=>onChange(event.target.checked?[...selected,{name:skill.name,path:skill.path}]:selected.filter(item=>item.path!==skill.path))}/>
      <span><strong>{skill.name}</strong>{skill.description&&<span className="small muted">{skill.description}</span>}<code className="small muted">{skill.path}</code>{!discovered.has(skill.path)&&<span className="hint">{p('savedLocalSkillUnconfirmed')}</span>}</span>
    </label>)}</div>}
  </fieldset>;
}
