const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});

export function requestSummary(request:string):string{
 const lines=request.trim().replace(/^Original goal:\s*/i,'').split(/\r?\n/u).map(line=>line.trim());
 const content=lines.map(line=>line.replace(/^(?:[-*•](?:\s+|$)(?:\[[ xX]\]\s*)?|\d+[.)、](?:\s+|$)|#{1,6}(?:\s+|$))/u,'')).find(Boolean)??lines.find(Boolean)??'';
 const sentence=(content.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/u)?.[0]??content).replace(/\s+/g,' ').trim();
 const units=Array.from(graphemes.segment(sentence),part=>part.segment);
 if(units.length<=64)return sentence;
 const prefix=units.slice(0,63).join(''),boundary=prefix.lastIndexOf(' ');
 return (boundary>=prefix.length*.65?prefix.slice(0,boundary):prefix).trimEnd()+'…';
}
