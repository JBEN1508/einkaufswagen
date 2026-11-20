# 🛒 Einkaufswagen – Supermarkt-Angebote mit Vorhersage

Diese App lädt **jeden Morgen automatisch** die Prospekt-Angebote von **EDEKA, ALDI Nord, Lidl, REWE und famila** für Neu Wulmstorf (PLZ 21629). Die Angebote landen in einer Datenbank, und die App berechnet, **wann ein Produkt wieder im Angebot kommt**.

Du öffnest die App auf dem iPhone wie eine normale App (Symbol auf dem Home-Bildschirm). Ein Mac oder App Store ist dafür nicht nötig.

---

## 📱 App auf das iPhone holen (einmalig)

1. Öffne in **Safari** (nicht Chrome): `https://DEIN-NAME.github.io/einkaufswagen/`
2. Tippe unten auf das **Teilen-Symbol** (Quadrat mit Pfeil nach oben).
3. Wähle **„Zum Home-Bildschirm“** und tippe auf **Hinzufügen**.

Jetzt hast du ein Symbol „Angebote“, das sich wie eine eigene App öffnet.

---

## ⚙️ Wie es funktioniert

| Teil | Was passiert |
|---|---|
| **Automatischer Abruf** | GitHub startet jeden Morgen um ca. 6:20 Uhr das Programm `scripts/update.mjs`. EDEKA, Lidl und REWE kommen von marktguru.de (Prospekte für deine PLZ), ALDI Nord direkt von aldi-nord.de, famila aus dem Prospekt des Markts Neu Wulmstorf. |
| **Datenbank** | Alle Angebote mit Woche, Preis, Normalpreis und Rabatt stehen in `docs/data/products.json`. Die Historie wächst jeden Tag. |
| **Vorhersage** | Aus den Abständen zwischen den bisherigen Aktionen (Median) berechnet die App die nächste Angebotswoche. Sie zeigt auch an, wie sicher die Vorhersage ist. |
| **App** | Die Webseite im Ordner `docs/` wird kostenlos über GitHub Pages veröffentlicht. |

Vorhersagen gibt es, sobald ein Produkt **mindestens zweimal** im Angebot war. Nach ein paar Wochen gibt es also deutlich mehr davon.

---

## 🔄 „Aktualisieren“-Knopf freischalten (optional)

Ohne Einrichtung holt der Knopf nur den neuesten gespeicherten Stand. Soll er sofort einen neuen Abruf starten, braucht die App einen **Token**, eine Art Passwort nur für diese eine Aufgabe:

1. Öffne https://github.com/settings/personal-access-tokens/new
2. **Token name:** `Einkaufswagen`. Bei **Expiration** kannst du z. B. 1 Jahr wählen.
3. **Repository access:** *Only select repositories* und dann `einkaufswagen` auswählen.
4. **Permissions:** unter *Repository permissions* bei **Actions** auf **Read and write** stellen.
5. Unten auf **Generate token** tippen und den Token (beginnt mit `github_pat_`) kopieren.
6. In der App auf **Mehr**, den Token einfügen und **Token speichern** tippen.

Der Token bleibt nur auf deinem iPhone gespeichert.

---

## 📥 Daten der alten Website übernehmen

1. Auf der alten Seite (`edeka.html` bzw. `aldi.html`) auf **„Einträge exportieren (CSV)“** klicken.
2. Hier im Repository den Ordner **`import`** öffnen und dann **Add file → Upload files** wählen.
3. Die CSV-Datei hochladen. Der Dateiname muss den Markt enthalten, z. B. `edeka_angebote_….csv`. Die Exporte der alten Seite heißen schon so.
4. Unten auf **Commit changes** klicken.

Nach etwa 2 Minuten sind die alten KW-Daten in der App und fließen in die Vorhersage ein. Die Datei wird danach nach `import/erledigt` verschoben.

---

## 🛠 Einstellungen ändern

In **`config.json`** kannst du ändern:

- `zip`: Postleitzahl
- `stores`: welche Märkte geladen werden (`edeka`, `aldi`, `lidl`, `rewe`, `famila`)
- `extraKeywords`: zusätzliche Suchbegriffe, falls ein Produkt nie gefunden wird, z. B. `["Skyr", "Hafermilch"]`

---

## ❓ Wenn etwas nicht klappt

- **Abrufe ansehen:** Reiter **Actions**. Ein grüner Haken heißt alles okay, ein rotes X heißt Fehler. Wenn du den Lauf antippst, siehst du die Meldung.
- **„marktguru hat den Zugriff abgelehnt“:** marktguru hat keine offizielle Schnittstelle, die Zugangsschlüssel können sich ändern.
  1. Öffne marktguru.de am PC in Chrome, drücke F12 und wechsle zum Tab *Network*.
  2. Suche auf der Seite ein Produkt.
  3. Klicke auf den Eintrag `offers/search`. Unter *Request Headers* stehen `x-apikey` und `x-clientkey`.
  4. Trage beide unter **Settings → Secrets and variables → Actions** als `MARKTGURU_APIKEY` und `MARKTGURU_CLIENTKEY` ein.
- **Die App zeigt alte Daten:** GitHub Pages speichert bis zu 10 Minuten zwischen. Einfach kurz warten.
- Die Angebote gelten für die Kette in deiner Region, nicht für eine bestimmte Filiale.

---

## Projektaufbau

```
.github/workflows/update.yml   Zeitplan: täglicher Abruf + Veröffentlichung
scripts/update.mjs             Abruf + Speichern
config.json                    PLZ, Märkte, Suchbegriffe
import/                        hier alte CSV-Dateien hochladen
docs/                          die App (wird über GitHub Pages veröffentlicht)
  data/products.json           die Datenbank
  js/predict.js                Kalenderwochen + Vorhersage
  js/marktguru.js              Abruf bei marktguru
test/                          Tests (npm test)
```

**Hinweis zu famila:** famila stellt seine Angebote nur als Prospekt bereit. Die App liest den Prospekttext und übernimmt nur Angebote, bei denen Normalpreis, Rabatt und Angebotspreis rechnerisch zusammenpassen (etwa 70 pro Woche). Einzelne Produktnamen können trotzdem etwas ungenau sein.
