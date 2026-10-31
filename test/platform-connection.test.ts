import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {platformConnectionState} from '../web/platform/platformConnection.ts';
import type {PlatformConnectionState} from '../web/platform/platformConnection.ts';

const connected = {connected: true, available: true, authenticated: true};
const disconnected = {connected: false, available: false, authenticated: false};
test('global connection health requires availability and authentication, independently of project data', () => {
  assert.equal(platformConnectionState(connected), 'connected');
  assert.equal(platformConnectionState({...connected, project: null, team: null}), 'connected');
  assert.equal(platformConnectionState(disconnected), 'disconnected');
  assert.equal(platformConnectionState({...disconnected, error: {code: 'MULTICA_NOT_CONFIGURED', message: 'Synthetic setup needed.'}}), 'not-configured');
  for (const status of [401, 403]) {
    assert.equal(platformConnectionState({...disconnected, error: {code: `HTTP_${status}`, message: 'Synthetic authorization failure.', status}}), 'authentication-failed');
  }
  assert.equal(platformConnectionState({...disconnected, available: true}), 'authentication-failed');
  assert.equal(platformConnectionState({...disconnected, available: true, error: {code: 'NETWORK_ERROR', message: 'Synthetic config read failure.'}}), 'disconnected', 'A transport failure after health is not proof of failed authentication.');
  for (const value of [{...connected, connected: false}, {...connected, available: false}, {...connected, authenticated: false}, {...connected, error: {code: 'NETWORK_ERROR', message: 'Synthetic failure.'}}]) {
    assert.notEqual(platformConnectionState(value), 'connected');
  }
});

test('missing or malformed connection observations cannot preserve a green status', () => {
  for (const value of [null, [], {}, {connected: true}, {...connected, available: 'true'}, {...connected, error: 'Synthetic error'}, {...connected, error: null}, {...connected, error: {}}, {...connected, error: {code: 'HTTP_401', message: 'Synthetic', status: '401'}}]) {
    assert.equal(platformConnectionState(value), 'read-failed');
  }
  const history = [connected, null, {...disconnected, error: {code: 'MULTICA_NOT_CONFIGURED', message: 'Synthetic'}}, connected];
  assert.deepEqual(history.map(platformConnectionState), ['connected', 'read-failed', 'not-configured', 'connected']);
});

test('header status renders distinct bilingual accessible states and preserves only the project Team action', async t => {
  const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom'});
  t.after(() => vite.close());
  const {I18nContext, makeI18n} = await vite.ssrLoadModule('/web/i18n.tsx');
  const {MulticaStatus, MulticaStatusView} = await vite.ssrLoadModule('/web/platform/MulticaStatus.tsx');
  const {TeamWorkspace} = await vite.ssrLoadModule('/web/platform/TeamWorkspace.tsx');
  const states: PlatformConnectionState[] = ['checking', 'not-configured', 'connected', 'disconnected', 'authentication-failed', 'read-failed'];
  const copies = {
    en: ['Checking', 'Not configured', 'Connected', 'Connection failed', 'Authentication failed', 'Status unavailable'],
    'zh-CN': ['检查中', '未配置', '已连接', '连接失败', '鉴权失败', '状态读取失败'],
  };
  for (const locale of ['en', 'zh-CN'] as const) {
    const render = (component: typeof MulticaStatusView, props: Record<string, unknown>) => renderToStaticMarkup(createElement(I18nContext.Provider, {value: makeI18n(locale)}, createElement(component, props)));
    for (const [index, state] of states.entries()) {
      const global = render(MulticaStatusView, {state});
      assert.ok(global.includes(copies[locale][index]));
      assert.ok(global.includes(`data-state="${state}"`));
      assert.ok(global.includes('role="status" aria-live="polite" aria-atomic="true"'));
      assert.ok(global.includes(`aria-label="${locale === 'en' ? 'Multica connection' : 'Multica 连接'}"`));
      assert.ok(global.includes(locale === 'en' ? 'Multica connection' : 'Multica 连接'));
      assert.ok(global.includes(locale === 'en' ? 'model execution and results' : '模型执行和结果'));
      assert.doesNotMatch(global, /<button|<a\b/);
      assert.equal(global.includes('pf-integration-status connected'), state === 'connected');
      const project = render(MulticaStatusView, {state, onOpenTeam() {}});
      assert.match(project, /<button type="button"/);
      assert.ok(project.includes(locale === 'en' ? 'Open project team.' : '打开项目团队。'));
      assert.equal((project.match(/<button\b/g) ?? []).length, 1);
    }
    assert.ok(render(MulticaStatus, {ready: false}).includes('data-state="checking"'));
    const team = render(TeamWorkspace, {project: {id: 'synthetic', name: 'Synthetic project', roles: [], revision: 1}, team: null, error: new Error('Synthetic team read failed.'), runs: [], models: [], onRefresh: async () => {}, onRun() {}});
    const banner = team.slice(team.indexOf('class="pf-connection-banner'), team.indexOf('<nav class="pf-local-tabs"'));
    assert.ok(banner.includes(locale === 'en' ? 'Status unavailable' : '状态读取失败'));
    assert.ok(!banner.includes(locale === 'en' ? 'Not connected' : '未连接'), 'A failed team read cannot contradict the independent global connection observation.');
  }
});
