import assert from 'node:assert/strict';
import test from 'node:test';
import {requestSummary,resultPreview} from '../web/platform/requestSummary.ts';

test('multiline requests have one identifying line while punctuation and file names remain useful',()=>{
  assert.equal(requestSummary('\n  检查项目网站的导航和语言切换\n保留原来的内容，不要重写整个网站'),'检查项目网站的导航和语言切换');
  assert.equal(requestSummary('1. Update README.md for v0.2. Keep the download links.'),'Update README.md for v0.2.');
  assert.equal(requestSummary('- [ ] Inspect src/navigation.ts\n- Keep the current routes'),'Inspect src/navigation.ts');
  assert.equal(requestSummary('#\n- [ ]\nInspect the nested request description'),'Inspect the nested request description');
  assert.equal(requestSummary('- [ ]'),'- [ ]');
  assert.equal(requestSummary('Explain the project status? Include the remaining work.'),'Explain the project status?');
  assert.equal(requestSummary('修复网站导航。保留内容。'),'修复网站导航。');
});

test('long request previews are bounded without splitting words or grapheme clusters',()=>{
  const english='Improve the documentation navigation so readers can locate installation instructions and follow every supported configuration example';
  assert.equal(requestSummary(english),'Improve the documentation navigation so readers can locate…');
  const family='👩🏽‍💻';
  assert.equal(requestSummary(family.repeat(80)),family.repeat(63)+'…');
  const chinese='检查网站各个模块的入口层级和内容展示'.repeat(8);
  const preview=requestSummary(chinese);
  assert.equal(Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(preview)).length,64);
  assert.ok(preview.endsWith('…'));
  assert.equal(requestSummary('x'.repeat(64)),'x'.repeat(64));
  assert.equal(requestSummary('x'.repeat(65)),'x'.repeat(63)+'…');
});

test('delegated envelopes and short requests retain their identity without changing original input',()=>{
  const request='Original goal:\nInspect the release links\nRetain the source.\n\nDelegated action: Review the changes.';
  assert.equal(requestSummary(request),'Inspect the release links');
  assert.ok(request.endsWith('Delegated action: Review the changes.'));
  assert.equal(requestSummary('你好'),'你好');
  assert.equal(requestSummary('  \n  '),'');
});


test('result previews keep the useful line without common Markdown decoration',()=>{
 assert.equal(resultPreview('## **Reviewed change**\n\n- More detail.'),'Reviewed change');
 assert.equal(resultPreview('Check [the source](https://example.com/guide).'),'Check the source.');
 assert.equal(resultPreview('Inspect `src/file.ts` and some_file_name.'),'Inspect src/file.ts and some_file_name.');
 assert.equal(resultPreview('**X**'),'X');
 assert.equal(resultPreview('## __已核对__\n\n后续详情'),'已核对');
});
