import fs from "node:fs";
const UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36","Accept-Language":"de-DE,de;q=0.9"};
fs.mkdirSync("out",{recursive:true});
fs.writeFileSync("out/famila.js", await (await fetch("https://www.famila-nordost.de/handzettel/famila_kw47_DJWWW/files/search/book_config.js",{headers:UA})).text());
fs.writeFileSync("out/famila_markt.html", await (await fetch("https://www.famila-nordost.de/markt/neu-wulmstorf/",{headers:UA})).text());
fs.writeFileSync("out/aldi.html", await (await fetch("https://www.aldi-nord.de/angebote.html",{headers:UA})).text());
