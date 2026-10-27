import {useRef} from 'react';
import type {AnchorHTMLAttributes, ReactNode} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import {useI18n} from './i18n';

const headingPrefix = 'gwi-knowledge-';

type DocumentNode = {type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: DocumentNode[]};
function documentText(node: DocumentNode): string {
  return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(documentText).join('');
}
function markLeadingTitle({title}: {title?: string}) {
  return (tree: DocumentNode) => {
    const first = tree.children?.find(node => node.type === 'element');
    if (!title || !first || !/^h[1-6]$/.test(first.tagName ?? '') || documentText(first) !== title) return;
    first.properties = {...first.properties, className: ['knowledge-leading-title']};
  };
}

function scopeDocumentIds({prefix}: {prefix?:string}) {
  return (tree:DocumentNode)=>{
    if(!prefix)return;
    const identifiers=new Map<string,string>();
    const visit=(node:DocumentNode,action:(node:DocumentNode)=>void)=>{action(node);for(const child of node.children??[])visit(child,action);};
    visit(tree,node=>{const id=node.properties?.id;if(typeof id==='string')identifiers.set(id,prefix+id);});
    visit(tree,node=>{
      const properties=node.properties;if(!properties)return;
      if(typeof properties.id==='string')properties.id=identifiers.get(properties.id)??properties.id;
      if(typeof properties.href==='string'&&properties.href.startsWith('#')){
        const fragment=properties.href.slice(1);let decoded=fragment;try{decoded=decodeURIComponent(fragment);}catch{}
        const target=identifiers.get(fragment)??identifiers.get(decoded);if(target)properties.href='#'+target;
      }
      for(const name of ['ariaDescribedBy','ariaLabelledBy']){
        const value=properties[name];
        if(Array.isArray(value))properties[name]=value.map(id=>typeof id==='string'?identifiers.get(id)??id:id);
        else if(typeof value==='string')properties[name]=value.split(/\s+/).map(id=>identifiers.get(id)??id).join(' ');
      }
    });
  };
}

function safeDestination(value: string): string {
  if (/^[\u0000-\u0020]|[\u0000-\u001f\u007f]/.test(value)) return '';
  if (/^(https?:|mailto:)/i.test(value)) {
    try { const url = new URL(value); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : ''; }
    catch { return ''; }
  }
  return /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(value) ? '' : value;
}

export function KnowledgeMarkdown({content,title,documentHref,idPrefix=''}:{content:string;title?:string;documentHref:string;idPrefix?:string}) {
  const {t} = useI18n();
  const reader = useRef<HTMLDivElement>(null);
  const link = (href: string | undefined, children: ReactNode, props: AnchorHTMLAttributes<HTMLAnchorElement> = {}) => {
    if (!href) return <span>{children}</span>;
    if (href.startsWith('#')) return <a {...props} href={documentHref} onClick={event => {
      // Document fragments must not replace the workbench's hash route.
      event.preventDefault();
      let fragment: string;
      try { fragment = decodeURIComponent(href.slice(1)); } catch { return; }
      const target = [...(reader.current?.querySelectorAll<HTMLElement>('[id]') ?? [])]
        .find(element => element.id === fragment || element.id === idPrefix + headingPrefix + fragment);
      if (target) {
        if (!target.hasAttribute('tabindex') && target.tabIndex < 0) target.tabIndex = -1;
        target.scrollIntoView({block: 'start'});
        target.focus({preventScroll: true});
      }
    }}>{children}</a>;
    if (/^(https?:|mailto:)/i.test(href)) return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    return <span className="knowledge-file-link" title={t('knowledgeFileLink', {path: href})}>{children}</span>;
  };
  return <div ref={reader} className="knowledge-text knowledge-markdown"><Markdown
    skipHtml
    urlTransform={safeDestination}
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[[rehypeSlug, {prefix: headingPrefix}], [markLeadingTitle, {title}], [scopeDocumentIds,{prefix:idPrefix}]]}
    remarkRehypeOptions={{footnoteLabel: t('markdownFootnotes'), footnoteBackLabel: t('markdownFootnoteBack')}}
    components={{
      a: ({node, href, children, ...props}) => link(href, children, props),
      img: ({src, alt, title}) => link(typeof src === 'string' ? src : undefined, alt || t('markdownImage'), {title}),
      h1: ({node, ...props}) => <h1 {...props} tabIndex={-1}/>,
      h2: ({node, ...props}) => <h2 {...props} tabIndex={-1}/>,
      h3: ({node, ...props}) => <h3 {...props} tabIndex={-1}/>,
      h4: ({node, ...props}) => <h4 {...props} tabIndex={-1}/>,
      h5: ({node, ...props}) => <h5 {...props} tabIndex={-1}/>,
      h6: ({node, ...props}) => <h6 {...props} tabIndex={-1}/>,
      table: ({node, ...props}) => <div className="knowledge-table" tabIndex={0} role="region" aria-label={t('markdownTable')}><table {...props}/></div>,
      pre: ({node, ...props}) => <pre {...props} tabIndex={0} aria-label={t('markdownCodeBlock')}/>,
    }}
  >{content}</Markdown></div>;
}
