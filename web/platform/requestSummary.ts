export function requestSummary(request:string):string{
 const paragraph=request.trim().split(/\r?\n\s*\r?\n/,1)[0]??'';
 const sentence=paragraph.match(/^[\s\S]*?(?:[。！？]|[.!?](?=\s|$))/u)?.[0]??paragraph;
 return sentence.replace(/\s+/g,' ').trim();
}
