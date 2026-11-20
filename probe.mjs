import fs from "node:fs";
fs.mkdirSync("out",{recursive:true});
const UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36","Accept-Language":"de-DE,de;q=0.9"};
const h=await (await fetch("https://www.marktguru.de/",{headers:UA})).text();
const apiKey=h.match(/"apiKey"\s*:\s*"([^"]+)"/i)?.[1], clientKey=h.match(/"clientKey"\s*:\s*"([^"]+)"/i)?.[1];
const r=await fetch("https://api.marktguru.de/api/v1/offers/search?as=web&limit=3&offset=0&q=Butter&zipCode=21629",{headers:{...UA,"x-apikey":apiKey,"x-clientkey":clientKey}});
const j=await r.json(); fs.writeFileSync("out/mg_offer.json", JSON.stringify(j.results.slice(0,2),null,1));
const id=j.results[0].id; const out=[];
// Bild-URLs aus der Website finden
const page=await (await fetch(`https://www.marktguru.de/offers/${id}`,{headers:UA})).text();
out.push("page imgs: "+[...new Set([...page.matchAll(/https:\/\/[^"' )]+?\.(?:webp|jpg|jpeg|png)/g)].map(m=>m[0]))].slice(0,15).join("\n"));
for (const u of [`https://mg2de.b-cdn.net/api/v1/offers/${id}/images/default/0/small.webp`,`https://mg2de.b-cdn.net/api/v1/offers/${id}/images/default/0/medium.webp`,`https://mg2de.b-cdn.net/api/v1/offers/${id}/images/default/0/small.jpg`,`https://api.marktguru.de/api/v1/offers/${id}/images/default/0/small.webp`]) {
  try { const x=await fetch(u,{headers:UA}); out.push(`${x.status} ${x.headers.get("content-type")} ${u}`);} catch(e){out.push("ERR "+u+" "+e.message)}
}
fs.writeFileSync("out/mg_images.txt", out.join("\n"));
