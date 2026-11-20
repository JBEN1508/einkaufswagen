const UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36","Accept-Language":"de-DE,de;q=0.9","Accept":"text/html,application/xhtml+xml,*/*"};
async function aldi(){
  const r=await fetch("https://www.aldi-nord.de/angebote.html",{headers:UA}); console.log("ALDI status",r.status);
  const h=await r.text(); console.log("ALDI len",h.length);
  const m=h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if(!m){ console.log("no NEXT_DATA; scripts:", [...h.matchAll(/<script[^>]*(id|type)="([^"]+)"/g)].map(x=>x[2]).slice(0,20)); console.log(h.slice(0,1500)); return;}
  const j=JSON.parse(m[1]);
  const walk=(o,p,d)=>{ if(d>6||!o||typeof o!=="object")return; for(const k of Object.keys(o)){ if(/offer|apiData/i.test(k)) console.log("KEY",p+"."+k, Array.isArray(o[k])?"array "+o[k].length:typeof o[k]); walk(o[k],p+"."+k,d+1);} };
  walk(j,"",0);
  const s=JSON.stringify(j); const i=s.indexOf("OFFER_GET"); console.log("OFFER_GET at",i); console.log(s.slice(i,i+4000));
}
async function famila(){
  const r=await fetch("https://www.famila-nordost.de/markt/neu-wulmstorf/",{headers:UA}); console.log("famila status",r.status);
  const h=await r.text(); const links=[...new Set([...h.matchAll(/\/handzettel\/([^\/"?]+)\//g)].map(x=>x[1]))]; console.log("handzettel",links);
  for(const l of links.slice(0,1)){
    const u=`https://www.famila-nordost.de/handzettel/${l}/files/search/book_config.js`; const r2=await fetch(u,{headers:UA}); console.log(u,r2.status);
    const t=await r2.text(); console.log("len",t.length); console.log(t.slice(0,6000));
  }
}
await aldi().catch(e=>console.log("ALDI ERR",e)); await famila().catch(e=>console.log("famila ERR",e));
