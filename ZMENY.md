# ORMS Layout Generator – změny

## 25. 11. 2026 – rychlosti výhybek

- Rychlost do odbočky u výhybky (40 výchozí, 50, 60, 80, 100, 120 km/h) v panelu Buňka i v režimu ORMS; jedno nastavení pro
  ORMS i SignalCraft (EMZZ).
- config.lua: 7. položka výhybky `{x, y, "═", "╔", "Vy5", false, 60}` (6. = invertovaná); 40 km/h se nezapisuje. Při otevření
  .lua se rychlosti načtou.
- Nastavení SignalCraftu se v režimu ORMS nepřepočítává (neobarvuje mřížku).

## 24. 11. 2026 – režim SignalCraft

- **Přepínač ORMS / SignalCraft** v hlavičce. V režimu SignalCraft je místo náhledu OpenComputers panel se
  záložkami Přehled, Stavědla, Návěstidla, Výhybky, Koleje a tratě, Cesty, Přístroje; tlačítka Kopírovat stanici
  (do schránky pro přístroj v DK) a Stáhnout stanici; tlačítko „Přepočítat a zkontrolovat“.
- **Nastavení všeho, co si export dřív domýšlel**: stavědlo každého prvku, název / pořadí / kontrolky IK stavědel,
  druh hlavního návěstidla a koleje skupinového návěstidla, platnost návěstidla (pro posun / pro jízdu vlaku / pro
  obojí), záměna + / − výhybky, rychlost do odbočky, spřažené výhybky, dopravní koleje, jména a texty tratí
  (z … / do … / na štítcích, odjezd po koleji dvoukolejné trati), vlakové cesty (vypnout, polohy výhybek, přidat).
  Stejná nastavení vybraného prvku jsou i v pravém panelu (Buňka).
- Nastavení patří ke kolejišti: ukládá se do .lua jako komentář `--[=[SignalCraft …]=]` (ORMS ho ignoruje)
  a s automatickým uložením v prohlížeči; po otevření souboru se načte.
- **res/emzz-model.js**: převod logiky SignalCraftu (Station, Equipment) do JS. Export stanici načte jako hra:
  její chyby jsou chyby exportu a záložka Přístroje ukazuje hradla, kličky a závěrníky tak, jak je hra postaví
  (včetně souhlasových hradel mezi stavědly). Při změně logiky v SignalCraftu je potřeba upravit i tento soubor.
- **Export (res/signalcraft.js)**: skupinová návěstidla ve zhlaví dostanou cestu z každé koleje (`z`), vjezdy končí
  na první dopravní koleji, druh a platnost návěstidel se zapisují do stanice, stavědla podle čísla / pořadí.
- Výhybky, návěstidla a přejezdy jsou v mřížce obarvené podle stavědla; oprava editoru, aby po smazání nebo přesunu
  prvku nezůstávala obarvená prázdná buňka.
- Starý dialog „Export do SignalCraftu“ nahrazen režimem SignalCraft; nápověda upravená.
