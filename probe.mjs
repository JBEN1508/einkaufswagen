import fs from "node:fs"; fs.mkdirSync("out",{recursive:true});
const H={"User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1","Referer":"https://jben1508.github.io/","Accept":"image/webp,image/*"};
const urls=["https://mg2de.b-cdn.net/api/v1/offers/25773822/images/default/0/small.webp","https://s7g10.scene7.com/is/image/aldinord/0331_47_2026_tk_blaetterteigschnecke_1_kg_2_on_comp?wid=240"];
const out=[]; for(const u of urls){ const r=await fetch(u,{headers:H}); const b=await r.arrayBuffer(); out.push(`${r.status} ${r.headers.get("content-type")} ${b.byteLength} ${u}`);} fs.writeFileSync("out/ref.txt",out.join("\n"));
