import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DEFAULT_EFFORT, EFFORTS, EFFORT_LABELS} from '../src/contracts.ts';
import type {Project} from '../src/contracts.ts';
import {defaultRoles} from '../src/defaults.ts';
import {validateProject} from '../src/validation.ts';

test('six native efforts round-trip through project validation without migrating explicit values', () => {
  const project: Project = {id:'synthetic', name:'Synthetic', description:'', repository:'', workspace:'/synthetic', revision:1, createdAt:'2026-01-01', updatedAt:'2026-01-01', roles:defaultRoles(), knowledgeSources:[]};
  assert.equal(DEFAULT_EFFORT, 'max');
  assert.ok(project.roles.every(role => role.effort === 'max'));
  for (const effort of EFFORTS) {
    project.roles[0].effort = effort;
    const serialized = JSON.parse(JSON.stringify(project));
    validateProject(serialized);
    assert.equal(serialized.roles[0].effort, effort);
    assert.equal(project.roles[0].effort, effort);
  }
  const invalid = JSON.parse(JSON.stringify(project));
  invalid.roles[0].effort = 'extreme';
  assert.throws(() => validateProject(invalid), /execution policy/);
});

test('rendered choices have fixed labels and preserve catalog capability restrictions', async () => {
  const server = await createServer({server:{middlewareMode:true}, appType:'custom'});
  try {
    const {EffortOptions, ReasoningHelp} = await server.ssrLoadModule('/web/ReasoningSettings.tsx');
    const {I18nContext, makeI18n} = await server.ssrLoadModule('/web/i18n.tsx');
    assert.deepEqual(Object.values(EFFORT_LABELS), ['Light','Medium','High','Extra High','Max','Ultra']);
    for (const locale of ['en','zh-CN']) {
      const html = renderToStaticMarkup(createElement(I18nContext.Provider, {value:makeI18n(locale)}, createElement('select', {defaultValue:'max'}, createElement(EffortOptions, {value:'max', model:{id:'synthetic',name:'Synthetic',efforts:[...EFFORTS]}}))));
      for (const effort of EFFORTS) assert.ok(html.includes(`>${EFFORT_LABELS[effort]}</option>`));
      assert.ok(html.includes('value="max" selected=""'));
      assert.ok(!html.includes('disabled'));
    }
    const limited = renderToStaticMarkup(createElement(EffortOptions, {value:'max',model:{id:'limited',name:'Limited',efforts:['low']}}));
    assert.match(limited, /value="max" disabled=""/);
    assert.match(limited, /value="ultra" disabled=""/);
    for (const locale of ['en','zh-CN']) {
      const help = renderToStaticMarkup(createElement(I18nContext.Provider, {value:makeI18n(locale)}, createElement(ReasoningHelp)));
      assert.ok(help.includes('https://codexradar.com/?station=codex'));
      assert.ok(help.includes(`lang="${locale}"`));
      assert.equal(help.includes('New roles and agents default to Max.'), locale === 'en');
      assert.equal(help.includes('新角色和代理默认 Max。'), locale === 'zh-CN');
      assert.equal(help.includes('(advisory)'), locale === 'en');
      assert.equal(help.includes('（仅供参考）'), locale === 'zh-CN');
      const incompatible=renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(ReasoningHelp,{value:'max',model:{id:'limited',name:'Limited model',efforts:['low']}})));
      assert.ok(incompatible.includes(locale==='en'?'Limited model does not support Max.':'Limited model 不支持 Max。'));
      const unknown=renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n(locale)},createElement(ReasoningHelp,{value:'max',model:{id:'unknown',name:'Unknown model',efforts:[]}})));
      assert.ok(!unknown.includes('notice warning'));
    }
  } finally {await server.close();}
});
