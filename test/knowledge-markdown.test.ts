import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('knowledge documents render readable Markdown without executing their content', async t => {
  const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom'});
  t.after(() => vite.close());
  const {KnowledgeMarkdown} = await vite.ssrLoadModule('/web/KnowledgeMarkdown.tsx');
  const {I18nContext, makeI18n} = await vite.ssrLoadModule('/web/i18n.tsx');
  const render = (content: string, locale = 'en', title?: string) => renderToStaticMarkup(createElement(I18nContext.Provider,
    {value: makeI18n(locale)}, createElement(KnowledgeMarkdown, {content, title, documentHref: '#/projects/synthetic/knowledge?entry=synthetic-note'})));

  await t.test('headings, nested lists, code, quotations and GFM use semantic elements in both locales', () => {
    const body = `# Reading note / 阅读笔记

## Evidence / 证据

A **verified** change with *context* and \`git diff\`.

1. Inspect the result
   - Keep its source
   - Compare the state
2. Review independently

> A source-bound observation.

\`\`\`ts
if (ready) {
  inspect("<not-html>");
}
\`\`\`

| State | Review |
| --- | --- |
| Before | ~~unknown~~ |
| After | verified |

- [x] Source checked
- [ ] Delivery pending

A note with a footnote.[^evidence]

[^evidence]: Independently authored synthetic evidence.
`;
    for (const locale of ['en', 'zh-CN']) {
      const html = render(body, locale);
      assert.match(html, /<h1[^>]*>Reading note \/ 阅读笔记<\/h1>/);
      assert.match(html, /<h2[^>]*>Evidence \/ 证据<\/h2>/);
      assert.match(html, /<ol>[\s\S]*<ul>[\s\S]*Keep its source/);
      assert.ok(html.includes('<strong>verified</strong>'));
      assert.ok(html.includes('<em>context</em>'));
      assert.ok(html.includes('<blockquote>'));
      assert.ok(html.includes('<code>git diff</code>'));
      assert.ok(html.includes('  inspect(&quot;&lt;not-html&gt;&quot;);'));
      assert.match(html, /<pre[^>]*><code class="language-ts">/);
      assert.ok(html.includes('<table>') && html.includes('<thead>') && html.includes('<tbody>'));
      assert.ok(html.includes('<del>unknown</del>'));
      assert.match(html, /type="checkbox" disabled="" checked=""/);
      assert.ok(html.includes(locale === 'en' ? '>Footnotes</h2>' : '>脚注</h2>'));
      assert.ok(html.includes(locale === 'en' ? 'Back to reference' : '返回引用处'));
    }
  });

  await t.test('safe links retain their labels, section anchors and duplicate heading identities', () => {
    const html = render(`## Details

## Details

## 中文章节

[Read details](#details) · [中文](#%E4%B8%AD%E6%96%87%E7%AB%A0%E8%8A%82) · [Source](https://example.com/evidence?q=one#result) · [Contact](mailto:qa@example.invalid) · [Local note](../notes.md)
`);
    assert.ok(html.includes('id="gwi-knowledge-details"'));
    assert.ok(html.includes('id="gwi-knowledge-details-1"'));
    assert.ok(html.includes('id="gwi-knowledge-中文章节"'));
    assert.ok(html.includes('href="#/projects/synthetic/knowledge?entry=synthetic-note"'));
    assert.ok(!html.includes('href="#details"'), 'Opening a document section separately must retain the workbench route.');
    assert.ok(html.includes('href="https://example.com/evidence?q=one#result"'));
    assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
    assert.ok(html.includes('href="mailto:qa@example.invalid"'));
    assert.ok(!html.includes('href="../notes.md"'));
    assert.ok(html.includes('File link: ../notes.md.'));
  });

  await t.test('a matching leading title retains its document heading and anchor while enabling header deduplication', () => {
    const matching = render('# Shared title\n\nBody.', 'en', 'Shared title');
    assert.match(matching, /<h1[^>]*id="gwi-knowledge-shared-title"[^>]*class="knowledge-leading-title"[^>]*>Shared title<\/h1>/);
    assert.ok(!render('# Different title\n\nBody.', 'en', 'Shared title').includes('knowledge-leading-title'));
    assert.ok(!render('Introductory context.\n\n# Shared title', 'en', 'Shared title').includes('knowledge-leading-title'));
    assert.ok(render('A plain text entry.', 'zh-CN', 'Entry title').includes('<p>A plain text entry.</p>'));
  });

  await t.test('untrusted HTML, executable schemes and embedded image requests stay inert', () => {
    const html = render(`<script>alert('synthetic')</script>

<iframe src="https://example.com/embed"></iframe>

[Unsafe](javascript:alert%281%29) [Data](data:text/html,synthetic) [File](file:///synthetic/private.md) [Protocol relative](//example.com/track)

![Explicit image reference](https://example.com/image.png)

![Local diagram](./diagram.svg)
`);
    assert.doesNotMatch(html, /<(script|iframe|img)\b/i);
    assert.doesNotMatch(html, /href="(?:javascript:|data:|file:|\/\/)/i);
    assert.ok(html.includes('>Unsafe</span>') && html.includes('>Data</span>'));
    assert.ok(html.includes('href="https://example.com/image.png"'));
    assert.ok(html.includes('>Explicit image reference</a>'));
    assert.ok(html.includes('>Local diagram</span>'));
  });

  await t.test('multiple result readers keep heading and footnote identities inside their own namespace',()=>{
    const body='## Shared evidence\n\n[Read evidence](#shared-evidence). A finding.[^source]\n\n[^source]: Synthetic source.';
    const documentHref='#/projects?project=synthetic&goal=synthetic-result';
    const html=renderToStaticMarkup(createElement(I18nContext.Provider,{value:makeI18n('en')},createElement('div',null,...['first-','second-'].map(idPrefix=>createElement(KnowledgeMarkdown,{key:idPrefix,content:body,documentHref,idPrefix})))));
    const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);
    assert.equal(new Set(ids).size,ids.length,'Repeated document text cannot create duplicate IDs.');
    const readers=[...html.matchAll(/<div class="knowledge-text knowledge-markdown">([\s\S]*?)<\/div>/g)].map(match=>match[1]);
    assert.equal(readers.length,2);
    for(const [index,reader] of readers.entries()){
      const prefix=index===0?'first-':'second-',ownIds=new Set([...reader.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]));
      assert.ok([...ownIds].every(id=>id.startsWith(prefix)));
      assert.ok(ownIds.has(prefix+'gwi-knowledge-shared-evidence'));assert.ok(ownIds.has(prefix+'user-content-fn-source'));assert.ok(ownIds.has(prefix+'user-content-fnref-source'));
      for(const match of reader.matchAll(/aria-describedby="([^"]+)"/g))for(const id of match[1].split(/\s+/))assert.ok(ownIds.has(id));
      assert.ok(reader.includes('href="#/projects?project=synthetic&amp;goal=synthetic-result"'));
      assert.ok(!reader.includes('href="#shared-evidence"'));
    }
  });
});
