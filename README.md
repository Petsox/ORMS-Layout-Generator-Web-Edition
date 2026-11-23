# ORMS Layout Generator – Web Edition

Webová aplikace pro kreslení kolejišť pro [ORMS](https://github.com/Petsox/Open-Rail-Management-System) (Open Rail Management System), program pro mod [OpenComputers](https://github.com/MightyPirates/OpenComputers) do hry Minecraft. Výsledkem je soubor `config.lua`, podle kterého ORMS vykreslí kolejiště na obrazovce počítače a ovládá výhybky, návěstidla a přejezdy.

**[Otevřít ORMS Layout Generator](https://petsox.github.io/ORMS-Layout-Generator-Web-Edition/)**

![Kolejiště v ORMS ve hře](res/orms-in-game.png)

## Co umí

- **Editor kolejiště** s mřížkou 160 × 50, přesně jako obrazovka ORMS. Kolejiště se kreslí jako schéma: koleje, výhybky v obou polohách, návěstidla barevně podle druhu, popisky.
- **Nástroj Kolej**: trať se kreslí tažením myši, oblouky a výhybky (včetně hrotu) se doplní samy. Dále štětec a guma.
- **Paleta** se všemi symboly a prvky; názvy se číslují automaticky (Vy1, S1, PrS1, Se1, P1 …).
- **Panel Buňka**: vlastnosti vybraného prvku (poloha výhybky, invertovaná výhybka, druh a směr návěstidla, název), takže formát buňky není potřeba psát ručně.
- **Kontrola** při každé změně: špatné formáty, výhybky bez hrotu, dvojí názvy, díry v kolejích, popisky v koleji nebo přes sousední prvky, předvěsti bez hlavního návěstidla a další. Chybné buňky jsou v mřížce označené a klik na hlášení je ukáže.
- **Náhled OpenComputers**: obrazovka vykreslená stejně jako v ORMS (barvy, umístění názvů, popisky, nadpis a tlačítka), se simulací přehazování výhybek a přejezdů.
- **Automatické centrování**: kolejiště se při uložení posune doprostřed obrazovky, nezůstane nalepené v rohu.
- **Ukládání do `.lua`**: zeptá se na název souboru a pak na místo uložení (v Chrome a Edge; ve Firefoxu a Safari se soubor stáhne).
- **Export pro SignalCraft (EMZZ)**: kontrola kolejiště a soubor stanice pro elektromechanické zabezpečovací zařízení.
- Zpět/znovu pro všechny úpravy, kopírování a vkládání oblastí (i z/do Excelu), přesun výběru tažením za okraj, vyplňování tažením za roh, posun po ploše držením kolečka myši, zoom, světlý i tmavý vzhled, průběžné ukládání rozpracované práce v prohlížeči.

Podrobný popis symbolů, formátů buněk, kontrol a konvencí je v [nápovědě](https://petsox.github.io/ORMS-Layout-Generator-Web-Edition/help.html) (v aplikaci tlačítko Nápověda nebo F1).

## Jak na to

1. Nakreslete koleje nástrojem **Kolej** a vložte prvky z palety.
2. Opravte, co hlásí panel **Kontrola**, a podívejte se do náhledu.
3. **Uložit** → název `config` → vyberte místo. Vzniklým `config.lua` nahraďte soubor v adresáři ORMS na počítači v OpenComputers a spusťte ORMS znovu.

## Soubory a zpětná kompatibilita

- **Otevřít** načte `config.lua` (i ručně upravený) i projekty `.csv` z první verze generátoru. Soubor lze také přetáhnout myší do okna. CSV uložené znovu v českém Excelu (se středníky) se načte také.
- Vygenerovaný `config.lua` má stejný formát jako v první verzi, ORMS není potřeba měnit.
- Obsah buněk se zapisuje stejně jako dřív (`═ V ╗ Vy1`, `◀ N S1`, `╪ P ═ P1`, `L text`).

## Pro vývojáře

Čistý JavaScript (ES moduly), bez knihoven a bez sestavení. Stačí servírovat složku libovolným webovým serverem (GitHub Pages); přímo z disku přes `file://` se moduly nenačtou.

| Soubor | Obsah |
| --- | --- |
| `index.html`, `res/app.js`, `res/app.css` | aplikace, paleta, panely, dialogy |
| `res/editor.js` | mřížka, výběr, nástroje, schránka |
| `res/cells.js` | formáty buněk a symboly |
| `res/validate.js` | kontroly kolejiště |
| `res/lua.js` | export a import `config.lua`, čtení starých `.csv` |
| `res/orms-render.js` | náhled obrazovky ORMS a centrování |
| `res/signalcraft.js`, `res/signalcraft-ui.js` | export pro SignalCraft |
| `help.html`, `res/help.css` | nápověda |
