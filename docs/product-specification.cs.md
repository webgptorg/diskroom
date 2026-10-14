# DiskRoom — kompletní produktová specifikace

**Verze specifikace:** 1.0  
**Datum:** 14. října 2026  
**Stav:** zadání k implementaci  
**Produkt:** DiskRoom  
**Hlavní doména:** `https://diskroom.dev`  
**npm balíček a CLI příkaz:** `diskroom`  
**Lokální pracovní a auditní složka:** `.diskroom`

> **Uvolni tolik místa, kolik potřebuješ. Ne tolik, kolik lze smazat.**

Tento soubor je samostatným zadáním celého produktu. Definuje název, distribuci, prezentační web, chování CLI, rozhodování o čištění, bezpečnost, rozšiřitelnost a akceptační kritéria. Nepředpokládá znalost předchozí konverzace. Jde o specifikaci požadovaného výsledku, nikoli o implementaci nebo návod k okamžitému mazání existujících dat.

## 1. Identita, distribuce a veřejné adresy

### 1.1 Jednotné pojmenování

| Oblast | Závazné označení |
| --- | --- |
| Název produktu | **DiskRoom** — v textech zachovat velké D a R. |
| Cílový veřejný npm balíček | `diskroom` — bez scope a bez odlišného názvu pro CLI. |
| Příkaz v terminálu | `diskroom` |
| Hlavní web a dokumentace | `https://diskroom.dev` |
| Doplňková doména | `diskroom.com`, pouze pokud ji vlastník projektu získá; potom přesměrování na hlavní `.dev` doménu. |
| Skrytá lokální složka | `.diskroom` |
| Stručný anglický popis | “Goal-driven disk cleanup for developers.” |
| Stručný český popis | „Chytrý úklid vývojářského disku podle toho, kolik místa potřebuješ.“ |

Názvy musí být konzistentní v balíčku, příkazu, nápovědě, reportech, historii, dokumentaci i na webu. Předchozí pracovní názvy se v produktu nepoužívají. Základní CLI i web mají anglické uživatelské texty, aby produkt nebyl omezen na české vývojáře; tato specifikace je v češtině. Lokalizace není podmínkou první verze.

### 1.2 Distribuce

Po publikaci musí fungovat následující způsoby použití:

```bash
# Globální instalace a interaktivní spuštění
npm install --global diskroom
diskroom

# Jednorázové spuštění bez trvalé globální instalace
npx diskroom
```

Npm balíček má příkaz `diskroom` registrovaný přes své `bin` a `homepage` nastavené na `https://diskroom.dev`. Do publikace patří funkční sestavené CLI, README, informace o licenci, podporovaných platformách a požadovaných verzích Node.js. Podpora se ověřuje na deklarovaných verzích; minimální verze nesmí být pouze neotestovaným údajem v metadatech.[6]

Instalace balíčku ani zobrazení nápovědy nic nečistí. Aplikace se neinstaluje jako služba a nezakládá automatické úlohy. Nesmí předpokládat, že se spouští ze svého zdrojového repozitáře. Pro běžný lokální sken nepotřebuje účet ani připojení ke svému webu.

### 1.3 Název a doména jsou rozhodnutí pro vydání, nikoli funkce aplikace

`diskroom.dev` je cílová hlavní doména. Na doméně běží prezentační web a dokumentace, **nikoli vzdálený čisticí engine nebo webové GUI nad uživatelovým diskem**. Samotný DiskRoom běží lokálně v terminálu.

Tato specifikace nepotvrzuje registraci či vlastnictví domény ani dostupnost nebo publikaci npm balíčku. Před veřejným vydáním musí vlastník projektu zajistit hlavní doménu a příslušný npm název. Příklady instalace jsou požadavkem na výsledný produkt, nikoli tvrzením, že je už nyní vydán.

Kontrola dostupnosti jména, registrace domény, ochrana značky a publikace balíčku jsou jednorázové kroky vydání. **Do DiskRoom se neimplementuje vyhledávání názvů ani registrace domén.** Pokud bude cílové npm jméno nedostupné, jde o rozhodnutí vlastníka před vydáním, ne o důvod k tichému přejmenování produktu implementátorem.

## 2. Účel a hranice produktu

Interaktivní CLI utilita, která pomůže vývojáři dosáhnout požadovaného volného místa na disku s co nejmenším rizikem ztráty dat a narušení práce. Nerozhoduje jen podle velikosti: rozlišuje obnovitelné artefakty, aktuálně potřebné prostředí a hodnotná uživatelská data.

**Cílem není smazat co nejvíce. Cílem je udělat právě tolik místa, kolik uživatel potřebuje, a potom přestat.**

Primární publikum tvoří vývojáři v Node.js, JavaScriptu a TypeScriptu. Nástroj je současně použitelný pro Python, Javu, Docker a další ekosystémy. Distribuuje se jako npm balíček, podporuje globální instalaci i jednorázové spuštění přes npm/npx. Pythonový či jiný vývojář pro tento způsob distribuce potřebuje Node.js a npm, ale nepotřebuje Node.js projekt.

Funguje nativně na Windows, macOS a Linuxu; Windows nesmí vyžadovat WSL. Nemá desktopové ani webové grafické rozhraní. První verze je určena především člověku v terminálu, nikoli bezobslužnému čištění na pozadí.

## 3. Základní uživatelský průchod

Spuštění bez parametrů otevře interaktivního průvodce:

1. Zobrazí název a skutečnou verzi nástroje, aktuální složku a dostupné místo.
2. Nechá vybrat rozsah skenování a cílový disk.
3. Zeptá se, kolik volného místa má po dokončení zbýt; nabídne předvolby i vlastní hodnotu.
4. Provede úplný sken zvoleného rozsahu a uloží jeho report.
5. Předloží vysvětlený návrh nejméně rušivého čištění pro dosažení cíle.
6. Uživatel prohlédne a případně upraví výběr a výslovně potvrdí konkrétní plán.
7. Nástroj provede schválené operace, průběžně kontroluje skutečné volné místo a ukáže závěrečný výsledek i cestu k záznamu.

**Skenování a čištění jsou dvě oddělené operace.** Sken sám nic nemaže ani neprovádí údržbu. Jediným vlastním zápisem během skenu jsou jeho lokální auditní soubory a nezbytný stav nástroje. Z výsledku lze odejít bez čištění nebo se k němu vrátit později; před pozdějším čištěním se podmínky znovu ověřují.

Z průvodce lze odejít v libovolném kroku před provedením zásahu. Výběr položek, sestavení plánu ani stisknutí Enter při procházení reportu se nepovažují za souhlas s mazáním. Finální potvrzení musí být samostatný, zřetelně označený krok s výchozí volbou „neprovádět“.

## 4. Rozsah a prostorový cíl

Výchozí rozsah je aktuální pracovní složka včetně potomků. Průvodce nabídne také kořen rozpoznaného projektu, jinou zadanou složku, celý vybraný disk a systémový přehled vybraných lokálních disků. Pokud se aktuální složka shoduje s kořenem projektu, nenabízí dvě totožné volby. Před skenem vždy zobrazí skutečné kořeny a výjimky.

Globální cache a úložiště mimo zvolenou složku nejsou automaticky součástí projektového skenu. Jejich zahrnutí vyžaduje viditelné rozšíření rozsahu. Síťové, odpojitelné a další připojené svazky se nepřibírají mlčky. Vzdálený Docker daemon není součástí čištění lokálního disku.

Cíl znamená **celkové požadované volné místo**, nikoli množství, které se má dodatečně smazat:

```text
potřebné uvolnění = max(0, požadované volné místo − aktuálně dostupné místo)
```

Například při 3 GB volného místa a cíli 5 GB chybí 2 GB. Jednotky musí být jednoznačné: podporovat B, kB, MB, GB i KiB, MiB, GiB, kladné desetinné hodnoty a malé cíle typu 100 kB. Výpočty a audit používají bajty.

Cíl se vztahuje ke konkrétnímu souborovému systému a místu dostupnému aktuálnímu uživateli. Uvolnění na jiném disku ho nesplňuje; při více discích se cíle a výsledky posuzují odděleně. Nesplnitelnou hodnotu nástroj vysvětlí. Je-li cíl již splněn, výchozí doporučení je nic nemazat; samostatný informační sken zůstává dostupný.

Průvodce nabízí například cíle **2 GB, 5 GB, 10 GB, vlastní hodnota** a možnost pouze skenovat. Výchozí cíl je návrh, nikoli automaticky schválený zásah. Uživatel vidí zároveň aktuální volné místo, požadovaný konečný stav a rozdíl, který zbývá uvolnit. Chybné jednotky, záporné hodnoty a hodnoty nad dostupnou kapacitou dostanou konkrétní vysvětlení.

Při práci s několika disky musí být zřejmé, na kterém disku přínos vznikne. Sdílená cache může ležet jinde než její projekt. Systémový přehled proto není jediný sloučený rozpočet všech svazků; uživatel potvrzuje cíle a plán pro jednotlivé cílové svazky. Rozsah skenu se nikdy neodvozuje od toho, že někde existuje odkaz na další disk.

## 5. Sken a vysvětlený report

Sken projde celý zvolený dostupný rozsah, nikoli jen první adresáře, které by stačily pro cíl. Rozpoznává projekty, vnořené repozitáře a workspaces, instalované artefakty, sdílená úložiště i velké neklasifikované soubory. Nepřístupné nebo vynechané části uvede; neúplný sken nesmí vydávat za úplný.

Report poskytne přehled největších projektů a adresářů, rozbalitelný strom a seznam kandidátů. Každý kandidát obsahuje cestu či identifikátor prostředku, ekosystém, vlastnící projekt, navrženou operaci, její důvod a tři nezávislá hodnocení:

| Hodnocení | Význam |
| --- | --- |
| Velikost a přínos | Logická velikost, pokud zjistitelná také velikost na disku, a samostatný konzervativní odhad skutečně uvolnitelného místa. |
| Bezpečnost odstranění | Skóre 0–100: vyšší znamená lépe podloženou obnovitelnost a nižší riziko ztráty unikátních dat. Nejde o statistickou pravděpodobnost. |
| Aktuální potřebnost | Skóre 0–100: vyšší znamená silnější známky současného používání nebo závislosti jiného projektu či programu. |

U obou skóre se zobrazí vysvětlení, podklady a míra jistoty. Nezjistitelná hodnota je výslovně neznámá, nikoli nula. Obnovitelný artefakt může být současně právě potřebný; tato informace se nesmí ztratit v jednom souhrnném čísle.

Výchozí řazení zohledňuje bezpečnost, potřebnost a přínos vzhledem k cíli. Uživatel může samostatně řadit či filtrovat podle velikosti, rizika, aktivity, ekosystému a projektu. Malé položky lze agregovat. Práh významnosti se přizpůsobuje cíli: několik kilobajtů nemá přehlušit gigabajtové kandidáty, ale malý prostorový cíl nesmí být ignorován.

Překrývající se kandidáti se nezapočítávají dvakrát: celý projekt a jeho `node_modules` nejsou dvě nezávislé úspory. Totéž platí pro sdílené soubory, hardlinky, vrstvy a úložiště. Pokud nelze skutečný přínos zjistit, report uvede nejistotu, ne falešně přesné číslo. Struktura pnpm je jedním z důvodů tohoto rozlišení.[1]

### 5.1 Sken musí být úplný, ale nesmí zbytečně zatěžovat disk

Průběžný nález dostatečného množství kandidátů neukončuje úplný sken. Již rozpoznané artefakty lze vyhodnocovat úsporně, ale report musí pokrýt celý deklarovaný rozsah a označit, kde je podrobnost omezená. Zdrojové soubory se bez potřeby nečtou celé; pro běžný sken se preferují metadata a malé deklarativní soubory.

Sken umí pokračovat kolem nepřístupných složek, odpojeného svazku nebo selhání jednoho detektoru. Report ale ukáže stav „neúplný“, konkrétní výjimky a jejich dopad. Výsledek z dostupné části lze po výslovném upozornění použít pouze pro kandidáty, jejichž bezpečnost nevyžaduje chybějící informace. Například neznalost části projektů snižuje jistotu, že sdílený runtime není používán.

### 5.2 Detail kandidáta

Vedle tří hlavních hodnocení musí detail ukázat stabilní ID kandidáta, jeho kategorii, hranice zásahu, závislosti na dalších kandidátech a konkrétní důvody zařazení. Má odpovědět na otázky: **Co se změní? Proč to doporučuješ? Co se může pokazit? Jak to později obnovím?**

U obnovy se rozlišuje nová instalace, sestavení projektu, stažení z remote a obnovení z uživatelovy zálohy. Zobrazí se známé předpoklady, například síť, přístup k soukromému registru nebo zdrojová data. Doporučení nepředstírá, že samotný lockfile garantuje budoucí dostupnost všech balíčků. Cena opětovného stažení nebo sestavení se zohlední alespoň kvalitativně.

## 6. Rozpoznávané ekosystémy a kategorie

První použitelná verze zahrnuje následující oblasti. Konkrétní detekce musí vycházet z kontextu ekosystému, nikoli pouze z názvu adresáře.

| Oblast | Co vyhledává a nabízí | Bezpečnostní hranice |
| --- | --- | --- |
| Node.js / JS / TS | Projektové `node_modules`, cache npm, pnpm, Yarn a Bun, dočasné instalace a rozpoznané buildovací či testovací artefakty. | Zachovat zdrojové soubory, manifesty, lockfiles, patche a cíle lokálních odkazů. Sdílené cache čistit se znalostí příslušného správce. |
| Python | Rozpoznaná virtuální prostředí, `__pycache__`, cache pip/uv a obnovitelné buildovací či testovací výstupy. | Virtuální prostředí není jen složka pojmenovaná `.venv`; ověřit jeho povahu, využití a dostupnost podkladů k obnově.[2] |
| Java / JVM | Obnovitelné výstupy a cache Maven/Gradle a starší instalace vývojových prostředí spravované rozpoznanými nástroji. | Lokálně vytvořený nebo nainstalovaný artefakt v cache nemusí být znovu dostupný. Neodstranit jedinou kopii vlastního balíčku. |
| Runtime a nástroje | Starší instalace Node.js, Pythonu, JDK a dalších rozpoznaných runtime. | Věk verze nestačí. Chránit aktivní, výchozí, nejnovější nainstalovanou a projektem či aplikací požadovanou verzi; systémové instalace neodstraňovat plošně. |
| Docker | Build cache, nepoužívané images, zastavené kontejnery a přehled dalších objemných prostředků. | Rozlišovat cache, image, zapisovatelná data kontejneru a volumes. Zastavený neznamená postradatelný. Volumes nikdy nepředvybírat.[3] |
| Git a celé projekty | Velké repozitáře, lokální údržbu a samostatně rizikové možnosti redukce či odstranění. | Pravidla stanoví oddíl 9. |
| Logy a ostatní velké soubory | Velké logy, trasovací soubory, dumpy, archivy a neznámé objemné soubory. | Výchozí stav je k posouzení, ne automaticky ke smazání. Přípona ani stáří neprokazují bezcennost. |

Dokumentované, obnovitelné artefakty neaktivních projektů mohou vstoupit do doporučeného výběru. Samotný `package.json`, přípona souboru, umístění v cache nebo záznam v `.gitignore` však nejsou důkazem bezpečnosti. Lokální úpravy, vlastní data, chybějící podklady k obnově nebo známá nedostupnost zdroje riziko zvyšují.

Odinstalace runtime a čištění spravovaných úložišť používají podporované operace daného správce; nástroj neobchází jeho evidenci prostým mazáním interních souborů. Nepodporovaný případ lze zobrazit s vysvětlením, ale nesmí se tvářit jako bezpečně automatizovatelný.

### 6.1 Pravidla konkrétních kategorií

U Node.js se podporují běžné samostatné projekty i monorepa. Workspaces, propojené lokální balíčky a sdílená úložiště nesmějí vést k odstranění jejich zdrojových cílů. Buildovací složky typu `dist`, `build`, `.next`, `.nuxt`, `.turbo` nebo `coverage` jsou pouze příklady k rozpoznání; shoda názvu sama nestačí. `.yarn` ani jiná směsná konfigurační složka se nemaže jako jeden univerzální odpad.

U Pythonu se rozlišuje prostředí, jeho balíčky a samotný interpreter. U JVM se rozlišují výstupy projektu, stažené artefakty a lokálně vytvořené publikace. V obou případech je chybějící plán obnovy důvodem k opatrnějšímu hodnocení, ne k označení složky za bezpečnou podle názvu.

Staré runtime verze se hledají zejména v instalacích spravovaných rozpoznaným version managerem. Plugin musí umět doložit, jak nalezenou instalaci odinstaluje, co na ni odkazuje a kterou část podpory na konkrétní platformě skutečně poskytuje. Nepoužívané stáří se neodhaduje jen z data vydání verze. Nejnovější nainstalovaná verze, výchozí runtime, interpreter běžícího DiskRoom i prostředí používané jiným programem jsou automaticky chráněné.

U Dockeru se každá operace váže na konkrétní ověřený lokální daemon a přesně vymezené prostředky. Nástroj nespouští široké čištění všech prostředků jen proto, že je to pohodlnější než potvrzený výběr. Pokud správce neumí operaci omezit na deklarovanou množinu nebo spolehlivý filtr, automatické provedení této operace se nenabízí. Nově vzniklé prostředky nesmějí být zahrnuty bez opětovného posouzení a souhlasu.

U logů nástroj v první verzi nabízí prohlédnutí metadat a explicitní odstranění. Neprovádí skryté ořezávání obsahu ani přepisování aktivních logů. Otevřený či průběžně zapisovaný soubor se nečistí, dokud není vhodně vyřešeno jeho používání. Ostatní neklasifikované velké soubory jsou viditelné, ale nikdy se automaticky neposunou do doporučených artefaktů jen svou velikostí.

## 7. Aktivita a ochrana rozpracované práce

Aktivita se odhaduje z kombinace signálů: změny zdrojů a manifestů, relevantní Git aktivita včetně necommitnuté práce, dostupné informace o běžících procesech a otevřených souborech, vazby runtime, prostředí a závislostí a uživatelské označení projektu.

Stáří `node_modules`, datum vydání runtime ani starý poslední commit samy nestačí. Změny vyvolané vlastním skenem, auditní složkou nebo generovaným balastem nesmějí projekt uměle omlazovat. Nemožnost zjistit používání se uvádí jako nejistota, nikoli jako důkaz neaktivity.

Projekt, z něhož uživatel nástroj spustil, je ve výchozím stavu chráněn před čištěním svých závislostí, i při širším skenu. Uživatel může projekt nebo konkrétní cestu výslovně chránit, vynechat pro tento běh nebo označit jako archivní. Explicitní ochrana má přednost před heuristikou.

Období poslední aktivity musí být viditelné a hranice nastavitelné. Měsíc, půl roku nebo několik let neaktivity zvyšují vhodnost kandidáta, ale nepřevádějí neobnovitelná data na bezpečná. Prokazatelně používaný prostředek se neodstraňuje; nástroj sám nezastavuje procesy, servery ani kontejnery, aby si čištění vynutil.

Výchozí orientační hranice je **30 dnů od poslední důvěryhodně zjištěné vývojové aktivity**; nedávnější projekty se nepředvybírají. Pásma nad 30 dnů, nad 180 dnů a nad jeden rok slouží k vysvětlení stáří a prioritizaci, nikoli jako automatické povolení mazání. Hranice je uživatelsky nastavitelná a její konkrétní hodnota patří do auditu.

Uživatel může označit projekt jako archivní nebo zrušit měkkou ochranu vyplývající z nedávné aktivity. Neobchází tím zákaz zásahu do právě používaného prostředku, explicitně chráněných cest nebo vlastního běžícího prostředí DiskRoom. Neúplná detekce procesů musí být uvedena jako omezení; nástroj neslibuje dokonalou detekci všeho používání na všech systémech.

Chráněné položky zůstávají v přehledu viditelné, aby bylo jasné, kde diskové místo je. Ochrana před čištěním a vyloučení ze skenu jsou dvě rozdílné volby. Dlouhodobé výjimky a označení projektů se ukládají lokálně do konfigurace pracovního prostoru `.diskroom`; uživatel je může zobrazit, změnit nebo zrušit.

## 8. Návrh a provedení nejmenšího potřebného zásahu

Kandidáti se dělí na **doporučené**, **vyžadující posouzení**, **rizikové** a **chráněné**. Předvybraná je pouze potřebná část doporučených kandidátů, nikoli všechny odstranitelné položky. Neznámé, aktivní a rizikové položky nejsou prostředkem k automatickému dosažení vysokého cíle.

Plán nejdříve respektuje ochranu a riziko, potom minimalizuje narušení práce a zbytečný objem operací. Mezi srovnatelnými možnostmi preferuje účinné zásahy do malého počtu neaktivních projektů před stovkami drobných zásahů. Velikost nikdy nepřebije bezpečnostní zákaz. Přesný optimalizační algoritmus tato specifikace neurčuje; výsledek musí být vysvětlitelný.

Příklad: na disku zbývá 0,4 GB, cíl je 2 GB. Starý projekt nabízí 1,9 GB obnovitelných závislostí, aktivní projekt má 4 GB závislostí a nejasný log 9 GB. Nástroj doporučí pouze závislosti starého projektu. Zdrojový projekt ponechá a větších, ale potřebných či nejistých položek se nedotkne.

Jednotkou operace je smysluplný celek, například celé obnovitelné prostředí. Nástroj nesmaže náhodnou část závislostí jen proto, aby přesně trefil počet bajtů. Přiměřené překročení cíle kvůli takové jednotce předem ukáže.

Po potvrzení provádí pouze schválené operace. Před každou znovu ověří cíl, identitu prostředku, rozsah, ochranu a relevantní změny od skenu. Změněný nebo nově používaný kandidát se přeskočí a vysvětlí. Změna plánu, která přidává jiné položky nebo zvyšuje riziko, vyžaduje nové potvrzení.

Po každé dokončené operaci změří skutečné volné místo. Jakmile je cíl dosažen, další operaci nezačne. Není-li cíl dosažitelný schváleným plánem, oznámí zbývající rozdíl a nabídne změnu cíle, rozsahu nebo nové posouzení kandidátů; samo nepřejde k agresivnějšímu mazání.

Přesun do koše se nepovažuje za uvolnění místa bez potvrzené změny dostupné kapacity. Přímé mazání musí být jasně označené jako potenciálně nevratné. Odložené uvolnění, sdílená data nebo prostor uvnitř virtuálního disku Dockeru se nesmějí vykazovat jako již uvolněné místo na hostitelském disku. Nečekaný výsledek neospravedlňuje další neschválené zásahy.

### 8.1 Transparentní rozhodnutí, nikoli neprůhledné celkové skóre

Pořadí rozhodování je: respektovat zákazy a explicitní ochrany; vybrat obnovitelné prostředky s nejnižší potřebností; mezi srovnatelnými variantami omezit náklady obnovy, zbytečné překročení cíle a počet zasažených projektů. Dvě mírně menší bezpečné položky mohou být vhodnější než jeden extrémně velký zásah. Není požadováno matematicky optimální řešení, ale vysvětlitelné a opakovatelné chování.

Nesmí vzniknout vážený součet, ve kterém velká velikost „přebije“ riziko ztráty zdrojů nebo známé používání. Pokud heuristika nedokáže nic doporučit, je správným výsledkem prázdný doporučený plán s vysvětlením.

Cíl dosažený během skenu jinou aplikací vede před mazáním k novému vyhodnocení a nulovému zásahu. Pokles volného místa během čištění naopak není automatickým povolením přidat kandidáty. Po vyčerpání schváleného plánu se nástroj zastaví, vypíše skutečný stav a vyžádá nové rozhodnutí.

Pokud se cíl naplní během rozpracované smysluplné operace, nástroj ji bezpečně dokončí nebo podle povahy správce ukončí, ale nezačne další. Neslibuje transakční rollback odstraněných souborů. Vynucené přerušení může zanechat částečně odstraněné prostředí; report i audit pak musí popsat potřebu jeho nové instalace.

## 9. Git: údržba není totéž co odstranění projektu

Report odděluje tři úrovně:

**Konzervativní lokální údržba.** Nabídnout Git garbage collection či repacking se zachováním dosažitelné historie a ochranných lhůt. Ukázat očekávaný přínos, nejistotu a případnou potřebu dočasného místa. Standardní GC může zahrnovat i prořezání reflogů a nedosažitelných objektů; není to pouhé bezeztrátové přebalení.[4] Agresivní pruning ani okamžitá expirace nesmějí být skrytou součástí běžného úklidu.

**Omezení lokálního rozsahu.** Nabídnout odděleně a bez předvýběru redukci historie, například náhradu ověřeným shallow clonem, nebo jiný rozpoznaný způsob omezení lokální kopie. Vysvětlit, co lokálně přestane být dostupné a co bude vyžadovat opětovné stažení.[5] Při náhradě se původní kopie nesmí odstranit před dokončením a ověřením nové; není-li na bezpečný postup místo, nabídku nelze provést.

**Odstranění celého projektu nebo repozitáře.** Poslední, riziková možnost, nikdy předvybraná. Zůstává viditelná i při velkém objemu, ale vyžaduje explicitní potvrzení konkrétního projektu a dopadů.

Tvrzení „všechno je pushnuté“ se nesmí odvodit pouze z čistého pracovního stromu nebo existujícího `origin`. Posuzují se lokální větve a commity, tagy, stash, necommitnuté, nesledované i ignorované soubory, submoduly, další worktrees, LFS a další lokálně jedinečná data. Kontrola nesmí implicitně nic pushovat.

Aktuální dostupnost vzdálené kopie a potřebných dat se ověřuje jen s odpovídajícím přístupem; offline stav nebo staré remote-tracking informace se označí jako neověřené. Ani dostupný remote nepředstavuje záruku budoucí obnovy. U známých jedinečných dat se odstranění zablokuje, dokud je uživatel nevyřeší; neurčitost nikdy neznamená bezpečí. Běžné čištění závislostí nesmí zasahovat do `.git`.

Kontrola vzdálené kopie je zřetelná samostatná činnost. Lokální čistý stav a záznam posledního pushnutí se uvádějí jako lokální podklady, nikoli ověřená aktuální záloha. U projektu s neodeslanou větví, stashem, důležitým ignorovaným souborem nebo jinou jedinečnou lokální informací se odstranění celého projektu zablokuje, dokud uživatel tento stav nevyřeší.

Nástroj nemění vzdálené repozitáře, nepushuje, nemaže vzdálené větve a nespravuje uživateli historii na serveru. Běžné čištění nesmí použít plošné odstranění ignorovaných souborů jako zkratku k odstranění artefaktů. Slovo „prune“ musí v reportu vždy znamenat konkrétní operaci s popsaným dopadem, nikoli univerzální příslib bezpečnosti.

Omezená kopie repozitáře může být menší, ale neznamená úplnou offline zálohu. Nahrazení shallow clonem je pokročilá, riziková a nikdy předvybraná možnost; nepřevádí celý repozitář do kategorie bezpečně zahoditelných cache.

## 10. Interaktivní terminálové rozhraní a příkazy

Rozhraní musí být plnohodnotné TUI: srozumitelné volby, editovatelné hodnoty, klávesová navigace, hromadný výběr v rámci bezpečných kategorií, rozbalení detailu a možnost vrátit se o krok zpět. Při změně výběru okamžitě aktualizuje očekávané volné místo a stav dosažení cíle.

Během skenu ukazuje průběh, aktuální rozsah, počet zpracovaných položek a dostupné souhrny, bez zahlcení terminálu jednotlivými soubory. Nevymýšlí přesná procenta, pokud celkový rozsah ještě nezná. Souhrn před potvrzením odděluje přínos, rizika a to, co se bude muset případně znovu nainstalovat či sestavit.

Důležité stavy se rozlišují textem a symboly, nikoli pouze barvou. Rozhraní funguje v úzkém terminálu, světlém i tmavém prostředí, bez barev a při změně velikosti okna. `Ctrl+C` bezpečně přeruší další práci a uloží dosažitelný stav; neslibuje vrácení již provedených operací.

Součástí jsou srozumitelné `--help`, `--version`, samostatný sken a prohlížení historie. Mimo interaktivní terminál musí existovat čitelný textový výstup a strojově zpracovatelný report, bez čekání na neviditelné otázky. Bez explicitního schválení se nic nemaže. Budoucí automatizace musí být schopna využít stejné skenování, plán a audit; plánovač běhů není požadavkem první verze.

### 10.1 Obrazovky a ovládání

Průvodce má zřetelné kroky **rozsah → cíl → sken → report a plán → potvrzení → výsledek**. Na relevantních obrazovkách zůstávají dostupné název, skutečná verze DiskRoom, vybraný rozsah a cílový svazek.

Primární ovládání funguje šipkami, Tab, Enter, mezerníkem a Escape. Výběr má viditelný fokus, nápovědu kláves a rozbalitelný detail. Myš může být doplněk, nikdy podmínka. Report podporuje hledání podle cesty nebo projektu, filtr kategorií, řazení a přepnutí mezi stromem a plochým seznamem. Hromadné označení nesmí bez dalšího zahrnout chráněné či rizikové položky.

Zobrazení musí odlišovat **nalezené**, **doporučené**, **uživatelem vybrané**, **skutečně provedené** a **přeskočené** položky. Hlavní souhrn obsahuje dostupné místo nyní, prostorový cíl, konzervativně očekávaný přínos plánu a počet dotčených projektů. Při nejistotě přínosu zobrazí interval nebo neznámou hodnotu, nikoli falešně přesný výsledek.

Závěrečné potvrzení vypíše konkrétní operace a jejich hranice. Rizikový zásah vyžaduje navíc potvrzení identifikátoru nebo názvu dotčeného prostředku a jeho konkrétních dopadů. Tato potvrzení nejsou nahrazena jedním obecným tlačítkem „vyčistit vše“.

Chyby mají srozumitelný popis a doporučený další krok, například připojit disk, uvolnit soubor nebo změnit auditní pracovní složku. Technický detail je dostupný v rozbalení či historii. Rozhraní nemá simulovat práci umělými čekáními ani vypisovat tisíce řádků souborů do běžného terminálu.

Ilustrační uspořádání souhrnu; hodnoty jsou příkladem, nikoli reálným měřením:

```text
DiskRoom <actual-version>                         diskroom.dev

Scope: projects folder       Target volume: Work
Free now: 0.4 GB             Target free: 2.0 GB
Still needed: 1.6 GB         Estimated selected gain: 1.9 GB

Selected  Candidate                      Gain      Decision
[x]       old-project / node_modules     1.9 GB    Recommended
[ ]       current-project / node_modules 4.0 GB    Protected: active
[ ]       large-debug.log                9.0 GB    Review required

Expected free after plan: 2.3 GB
1 operation selected. Source files will be preserved.

[Review details]   [Confirm cleanup...]   [Exit without changes]
```

Stejný report musí jít použít i bez barvy a v užším okně. Otevření potvrzovací obrazovky ještě nic nemaže; teprve výslovný souhlas s jejím konkrétním plánem zahájí provedení.

### 10.2 Veřejné příkazy

| Příkaz | Požadované chování |
| --- | --- |
| `diskroom` | Otevře celý interaktivní průchod. Nic nečistí bez schválení plánu. |
| `diskroom scan [path]` | Provede pouze sken a uloží jeho výsledek; cesta jinak odpovídá aktuální složce. Může sestavit nezávazné doporučení podle cíle. |
| `diskroom clean --scan <run-id>` | Načte uložený sken z aktuálního auditního pracovního prostoru, ověří aktuální stav a otevře interaktivní výběr a potvrzení čištění. Pokud sken neměl prostorový cíl, nechá jej nejprve zadat. |
| `diskroom history` | Zobrazí přehled běhů v aktuálním auditním pracovním prostoru. |
| `diskroom history <run-id>` | Otevře detail konkrétního skenu, plánu nebo čištění včetně odkazů na související běhy. |
| `diskroom about` | Zobrazí název, skutečnou verzi, účel a hlavní web. |
| `diskroom --help` | Zobrazí strukturovanou nápovědu, příklady, výchozí chování a skutečnou verzi. |
| `diskroom --version` | Vypíše skutečnou verzi nainstalovaného balíčku. |

Pro hlavní průvodce a sken jsou dostupné přepínače `--scope cwd|project|disk|system` a `--target-free <size>`. Pro explicitní cestu lze použít `--path <path>`; poziční cesta u `scan` znamená totéž a nelze současně zadat dvě různé cesty. Rozsah `disk` vybere svazek obsahující zadanou cestu. `system` znamená přehled lokálních svazků s explicitním interaktivním potvrzením vybraných svazků a jejich cílů, nikoli mlčky povolený celý systém.

`--workspace <path>` určuje pracovní složku pro `.diskroom`, nemění rozsah skenu a samo nepovoluje mazání. Bez přepínače je pracovní složkou původní cwd. `--no-color` vypíná barevnost. `--json` je v první verzi podporované pro `scan` a `history`; vypíše verzovaný strojově čitelný výsledek bez interaktivních obrazovek, průběh a diagnostiku oddělí od standardního výstupu.

Příklady zamýšleného použití po publikaci:

```bash
# Průvodce s předvyplněným cílem: celkem 5 GB volného místa
# Přepínač cíl předvyplní, ale neschválí čištění.
diskroom --target-free 5GB

# Sken jedné složky bez mazání
diskroom scan /path/to/projects --target-free 5GB

# Sken disku obsahujícího zadanou cestu; na Windows lze uvést například C:/
diskroom scan --scope disk --path C:/ --target-free 2GB

# Strojově čitelný sken pro další zpracování; audit se stále ukládá lokálně
diskroom scan . --json

# Pozdější prohlédnutí konkrétního běhu
diskroom history <run-id>

# Načtení téhož skenu s novou kontrolou a interaktivním potvrzením
diskroom clean --scan <run-id>
```

Čtení konfigurace, nápověda ani prohlížení historie nezakládají nový čisticí běh a nevyvolávají kontrolu celého disku. Při načtení reportu z jiné či nepodporované verze schématu se čtení vysvětlitelně odmítne; nástroj nesmí z neznámého formátu odvodit destruktivní akce.

### 10.3 Neinteraktivní prostředí a budoucí integrace

První verze **neprovádí bezobslužné mazání**. `clean` bez interaktivního potvrzovacího terminálu skončí s vysvětlením a nenulovým návratovým kódem; nemá univerzální přepínač, kterým lze obejít ochrany. Neinteraktivní sken a export reportu fungují bez otázek, pokud je rozsah jednoznačně zadaný. Chybějící potřebný vstup nebo vícesvazkové interaktivní rozhodnutí se hlásí jako chyba místo čekání na neviditelnou otázku.

Návratové kódy rozlišují úspěšné dokončení (`0`), chybu běhu či neplatné zadání (`1`), dokončené čištění bez dosažení zadaného cíle (`2`) a uživatelské přerušení (`130`). Neúplnost skenu a chyby jednotlivých operací musí být současně v reportu; technická chyba má přednost před pouhým nedosažením cíle. Samotný sken s nenaplněným cílem není neúspěšným čištěním — nic čistit neměl.

Jádro skenování, plánování a provádění musí být oddělené od TUI tak, aby je budoucí integrace mohla využít bez automatického ovládání terminálu. Veřejné SDK, automatický plánovač ani dlouhodobě běžící agent nejsou požadavkem první verze.

## 11. Lokální audit každého běhu

Každý sken, sestavení či změna plánu, čištění a údržbová operace má dohledatelný záznam. Sken a navazující čištění mají vlastní identifikátory a vzájemný odkaz. Zaznamenají se také běhy bez zásahu, přerušení, chyby a částečné výsledky. Pouhé zobrazení nápovědy nebo verze není čisticí běh.

### 11.1 Umístění a vztah k rozsahu skenu

Audit se ukládá vždy do skryté složky **`.diskroom` v potvrzené pracovní složce daného běhu**. Pracovní složka auditu a rozsah skenu jsou explicitně odlišené:

- Výchozí pracovní složkou je cwd, ze kterého byl DiskRoom spuštěn, tedy například `<projekt>/.diskroom`.
- Uživatel může před skenem výslovně zvolit jinou pracovní složku. Při práci nad celým diskem může zvolit jeho kořen, například `C:\.diskroom`, `/Volumes/Work/.diskroom` nebo `/.diskroom`, pokud je příslušný kořen zapisovatelný.
- Změna rozsahu na celý disk sama nepřesouvá audit z původního cwd. Průvodce jasně ukáže obě cesty a umožní potvrzené uložení do kořene disku.
- Při skenu více svazků může relace používat jednu potvrzenou pracovní složku; záznamy musí jednotlivé svazky jednoznačně odlišovat. Není nutné vytvářet auditní složku v každém nalezeném projektu.

Tím musí být umožněn globální sken i na platformě, kde do kořene systémového svazku nelze běžným uživatelem zapisovat. Nástroj ale nesmí potichu přepnout do domovské složky, systémového temp adresáře nebo cloudu. Nezapisovatelné umístění se vyřeší **před zahájením skenu či zásahu**, například explicitním výběrem původního cwd. Pokud nelze zajistit audit ve schváleném umístění, běh nezačne.

Složka má být skrytá i na Windows, nikoli pouze pojmenovaná s tečkou. Její skutečná cesta musí být vždy dostupná v UI i závěrečném reportu. DiskRoom nesmí bez souhlasu upravovat projektový `.gitignore`; může nabídnout přidání `.diskroom/` do ignorování nebo vysvětlit postup. Samotná skrytost není zárukou, že audit neobsahuje citlivé názvy cest.

Audit nesmí sám zabránit posouzení aktivity tím, že změní mtime adresáře projektu nebo vytvoří nesledované soubory. Tento vlastní vedlejší efekt se při heuristice ignoruje. Při rozhodování o odstranění celého projektu se ale skutečná přítomnost auditní složky respektuje: **aktivní audit nesmí být smazán spolu s projektem**.

### 11.2 Formát a obsah

Záznamy jsou otevřený, verzovaný JSON uložený v komprimované podobě `.json.gz`. Mohou být rozdělené do více provázaných komprimovaných souborů, aby detailní evidence nevyžadovala velkou nekomprimovanou kopii ani velkou paměť. Musí být čitelné bez proprietární služby.

Každý běh obsahuje alespoň:

| Skupina | Povinné informace |
| --- | --- |
| Identita | ID běhu a souvisejícího skenu/plánu, typ operace, začátek a konec, stav dokončení, časové údaje s časovou zónou. |
| Prostředí | Verze nástroje a formátu záznamu, OS a architektura, použité pluginy a jejich verze, relevantní verze správců a runtime. |
| Zadání | Původní pracovní složka, skutečné kořeny, cílové disky, prostorový cíl, výjimky, ochrany a použitá nastavení heuristik. |
| Stav před | Dostupné místo, úplnost skenu, zjištěné položky a jejich velikosti, hodnocení, podklady a nejistoty. |
| Rozhodnutí | Navržený i schválený plán, uživatelské změny, potvrzení rizik, důvody výběru, pořadí a předpokládaný přínos. |
| Provedení | Konkrétní dotčené prostředky a akce, časy, výsledek každé operace, změny od skenu, chyby a důvody přeskočení. |
| Stav po | Změřený stav po operacích i na konci, zbývající položky a částečné zásahy, srovnání s odhadem, stav cíle a důvod ukončení. |

Při přímém mazání adresáře je součástí auditu inventář konkrétních souborů a jejich známých výsledků, nikoli pouze údaj „smazán adresář“. U prostředků spravovaných například Dockerem zaznamenává stabilní identifikátory a výsledek správce; nesmí předstírat znalost jeho jednotlivých interních souborů. Stav před a po znamená relevantní metadata a pozorování, nikoli zálohu obsahu disku.

Před destruktivní operací musí být trvale zapsán její záměr; výsledky se doplňují průběžně. Pád nesmí zničit již dokončené záznamy. Operace přerušená mezi změnou a zápisem výsledku se označí jako neověřená, nikoli automaticky úspěšná. Nové spuštění nabídne kontrolu takového stavu, nikdy automatické pokračování v mazání.

Audit je vyloučen z čištění, zkreslování aktivity i výpočtu uvolnitelného místa. Nástroj nesmí smazat svůj běžící program, potřebné prostředí ani kořen obsahující právě zapisovaný audit. Historie se nemaže automaticky; její případné odstranění je samostatné uživatelské rozhodnutí. Také při ručním výběru celého starého projektu se nalezená historie musí výslovně vyřešit, například zachováním mimo mazaný projekt; nesmí zmizet jako nepřiznaný vedlejší efekt. Prostor spotřebovaný novými auditními záznamy je zahrnutý ve skutečném měření volného místa.

Záznamy neobsahují obsahy zdrojových souborů, logů, tokeny ani hesla. Citlivé části parametrů a URL se redigují. Změnu volného místa nástroj neprezentuje jako přesně prokázaný vlastní přínos, pokud ji mohly ovlivnit souběžné zápisy jiných procesů. **Audit není záloha a neposkytuje obecné undo.**

### 11.3 Odolnost, historie a úspornost

Kompresi nelze odložit až na konec běhu tak, že by pád zničil celou historii. Implementace musí průběžně vytvářet uzavřené, čitelné komprimované části a mít dohledatelný stav právě rozpracované operace. Příklad přípustné výsledné struktury, nikoli předepsané vnitřní implementace:

```text
.diskroom/
  config.json
  runs/
    <scan-run-id>/
      summary.json.gz
      inventory-0001.json.gz
      inventory-0002.json.gz
    <clean-run-id>/
      summary.json.gz
      plan.json.gz
      intent-0001.json.gz
      result-0001.json.gz
```

`config.json` slouží nastavení, není záznamem čištění. Všechny trvalé záznamy běhů a inventáře jsou komprimovaný JSON. Každá část obsahuje nebo jednoznačně odkazuje na ID běhu a verzi schématu; pořadí a vazby nesmějí být závislé pouze na času v názvu souboru. Formát je dokumentovaný a strojově čitelný.

U skenu je „stav potom“ skutečně pozorovaný stav po dokončení, nikoli tvrzení, že se disk mezitím nemohl změnit. U mazání souborů se rozlišuje naplánované odstranění, potvrzený úspěch, selhání, přeskočení a neověřený výsledek. Při pádu mezi smazáním a zápisem není dovoleno následně označit operaci za úspěšnou jen proto, že byla v plánu.

Pokud audit během operace přestane být zapisovatelný, nástroj nezahajuje další destruktivní akce a aktuální práci zastaví tak bezpečně, jak umožňuje použitý správce. Předem se ověří, že je prostor alespoň pro záměr a průběžný záznam; při téměř plném disku nesmí aplikace spoléhat na to, že si nejprve něco smaže bez evidence. Velké inventáře se zpracovávají postupně a nevyžadují načtení celého disku do paměti.

Historie umožňuje dohledat jednotlivé soubory či prostředky, důvod zásahu, verze, míru jistoty a stav před/po. Sken a následné čištění jsou propojené, nikoli přepisem téhož souboru. Změny plánu se ukládají jako revize nebo události; nemusí mít samostatný adresář pro každý stisk klávesy.

Souběžné čisticí běhy DiskRoom nesmějí bez koordinace zasahovat tutéž oblast nebo sdílené úložiště. Detekovaný konflikt vede k odmítnutí či odložení zásahu a vysvětlení. Starý zámek po pádu není automatickým povolením pokračovat v nedokončeném mazání.

## 12. Rozšiřitelnost a hranice pluginů

Podpora ekosystémů a nových druhů artefaktů je modulární. Přidání dalšího případu nesmí vyžadovat přepis průvodce, prioritizace, auditu nebo bezpečnostních pravidel.

Plugin popisuje, co rozpoznává, jak prokazuje povahu a obnovitelnost prostředku, jak odhaduje potřebnost a prostorový přínos, jaké podporuje operace, jejich předpoklady a platformy a jak se artefakt obnovuje. Výsledky se převádějí do společného reportu a auditního formátu.

Jádro vlastní pravidla rozsahu, ochrany, souhlasu, práce s cílem a evidence. Plugin nesmí v rámci produktového kontraktu obcházet potvrzení ani sám zvýšit povolené riziko. Neznámá či nepodporovaná schopnost se projeví konzervativně. Externí pluginy se neinstalují ani neaktivují podle obsahu nalezeného projektu bez výslovného souhlasu uživatele.

První verze má společným způsobem zapojené minimálně detektory Node.js/JS/TS, Pythonu, Javy/JVM, runtime instalací, Dockeru, Gitu a velkých souborů. Není přípustné „podporu dalších ekosystémů“ deklarovat pouze jako budoucí možnost architektury a vydat jen detektor `node_modules`.

Kontrakt rozšíření zahrnuje **detekci → vysvětlený nález → návrh akce → ověření předpokladů → provedení po souhlasu → ověření výsledku → audit**. Každé rozšíření má stabilní identifikátor, verzi, seznam podporovaných platforem a správců a vlastní testovací scénáře. Má explicitně deklarovat, zda umí jen detekovat, nebo také bezpečně provádět konkrétní operaci.

První vydání může používat jen vestavěná rozšíření se společným interním rozhraním. Samostatný tržištní ekosystém npm pluginů není nutný. Přidání dalšího typu cache či prostředí ale nesmí vyžadovat nové paralelní UI nebo vlastní formát historie.

Selhání jednoho detektoru se hlásí v pokrytí skenu a auditní stopě, ne skrytím jeho prostředků. Projektové konfigurační soubory se zpracovávají jako data. Rozšíření třetí strany jsou důvěryhodnostní rozhodnutí: modulární kontrakt sám o sobě není bezpečnostní sandbox pro libovolný cizí kód.

## 13. Provozní a bezpečnostní invarianty

Sken nespouští kód nalezených projektů, instalační hooky ani jejich vlastní čisticí skripty. Nástroj nemění manifesty, lockfiles ani zdrojový kód jako součást úklidu instalovaných závislostí. Uživatelská data, přihlašovací údaje, databáze a konfigurace nejsou odpad jen kvůli umístění.

Symlinky, junctions a připojené svazky nesmějí rozšířit mazání mimo potvrzený rozsah. Respektují se identity souborů, vnořené projekty, oprávnění a souběžné změny. Nedostatečná práva nejsou důvodem k automatickému zvýšení oprávnění nebo násilnému odemčení prostředků.

Nástroj zvládá rozsáhlé stromy a téměř plný disk bez neúměrné paměti či velkých dočasných souborů. Nelze-li ani bezpečně zapsat minimální audit, nic nemaže. Údržba potřebující dodatečné místo se neprovádí bez odpovídající rezervy. Zamčené soubory a chyby se evidují jako chyby či částečné výsledky, nikoli jako úspěšně odstraněné položky.

Lokální sken nevyžaduje účet ani cloud a neodesílá názvy souborů nebo obsah projektů. Síťové ověřování například vzdálené Git kopie musí být zřetelné; bez něj zůstávají příslušná tvrzení neověřená.

Rozpoznávání i provádění musí správně obsloužit cesty s mezerami, Unicode, dlouhé cesty a rozdíly ve velikosti písmen. Parametry odvozené z názvů souborů nesmějí být vyhodnoceny jako shellový kód. Mezi kontrolou a operací se znovu ověřuje identita cíle a zabrání se záměně adresáře za odkaz vedoucí mimo schválený rozsah; pokud to pro daný typ prostředku nelze zajistit, zásah se neprovede.

Při skenu se nesledují cykly v odkazech, nestahují se automaticky obsahy cloudových zástupných souborů a nepřechází se do pseudo-souborových systémů, které nejsou běžnými uloženými daty. Základní pravidla platí i při spuštění s vyššími oprávněními. Vyšší práva nejsou souhlasem s širším rozsahem ani rizikem.

Výsledný produkt má nativně ověřené chování v PowerShellu/Windows Terminalu a běžných terminálech macOS a Linuxu. Detekce procesů, oprávnění a možností konkrétních správců může být platformně odlišná; takové rozdíly musí být viditelné v reportu i dokumentaci a nesmějí být nahrazené falešnou jistotou.

Ve výchozím stavu není zapnutá telemetrie. Audit zůstává lokální a síťová operace se smí týkat jen explicitně popsaného účelu, například uživatelem povoleného ověření Git remote. Nástroj pro sken nepotřebuje LLM ani odesílání cest do externí AI služby. Deterministické, vysvětlitelné heuristiky jsou pro tuto specifikaci postačující.

## 14. Veřejný web na diskroom.dev

### 14.1 Úloha webu

Na **`https://diskroom.dev`** bude jednoduchý veřejný prezentační a dokumentační web DiskRoom. Web je součástí dodávky produktu, ale neprovádí skenování disku, nepřijímá upload auditů a nenabízí ovládací panel pro vzdálené mazání. CLI má plnohodnotně fungovat i bez dostupnosti tohoto webu.

Primární sdělení webu musí vysvětlit rozdíl proti univerzálním čističům: DiskRoom kombinuje **velikost, obnovitelnost a aktuální potřebnost** a připravuje jen tolik zásahů, kolik je třeba pro požadované volné místo. Nesmí slibovat bezrizikové mazání, garantovanou obnovu ze sítě ani dokonalou detekci používání.

### 14.2 Minimální obsah

Úvodní stránka obsahuje název DiskRoom, stručné vysvětlení, podporované operační systémy, instalaci `npm install --global diskroom`, spuštění `diskroom` a příklad cíle „chci mít 5 GB volného místa“. Musí jasně říkat, že pro použití je potřeba Node.js/npm, ale cílové projekty mohou patřit i do jiných ekosystémů.

Viditelné mají být tři základní kroky **scan → review → clean**, ukázka skutečného nebo zřetelně ilustračního terminálového průchodu a vysvětlení lokálního auditu `.diskroom`. Web nabídne odkazy na npm balíček a zdrojový repozitář až podle skutečných adres projektu; nesmí obsahovat vymyšlené funkční odkazy či neexistující reference.

Dokumentace pokryje začátek používání, význam cíle, rozsahy a auditní pracovní složku, přehled příkazů, kategorizaci rizik, ochranu aktivních projektů, podporované ekosystémy a operace, Git/Docker zvláštnosti, formát a čtení historie, obnovu závislostí a řešení běžných chyb. Součástí je přehled skutečně otestované podpory jednotlivých platforem a správců, informace o licenci a kontaktní cesta pro hlášení chyb a bezpečnostních problémů.

Obsah webu, README a CLI se nesmí rozcházet v názvu, instalaci, přepínačích ani tvrzeních o bezpečnosti. Ukázky jasně odlišují sken od potvrzeného mazání. Ukázka s konkrétní verzí musí pocházet z reálného vydání nebo být označena jako ilustrace.

### 14.3 Provozní požadavky

Web má být rychlý, responzivní a přístupný z klávesnice. Pro běžné přečtení dokumentace nepotřebuje přihlášení. Statická či staticky generovaná podoba je dostatečná; není vyžadovaný backend, konkrétní framework ani poskytovatel hostingu.

Hlavní veřejná adresa používá HTTPS a kanonický host `diskroom.dev` bez `www`. Varianta `www.diskroom.dev`, pokud je zřízena, přesměrovává na hlavní adresu. Pokud vlastník získá `diskroom.com`, tato doplňková doména přesměruje na `.dev` se zachováním cesty, kde to dává smysl; není podmínkou pro vydání CLI. Nastavení cizí nebo nevlastněné domény se neprovádí.

Registrace domény a nasazení webu patří mezi úkoly realizace podle přístupu a schválení vlastníka. Samotné sepsání tohoto dokumentu nic neregistruje, neobjednává, nepublikuje ani nenasazuje.

## 15. Akceptační scénáře

| Situace | Očekávaný výsledek |
| --- | --- |
| Volné místo již splňuje cíl. | Žádné doporučené mazání; zaznamenaný běh bez zásahu. |
| Jeden starý projekt má dost obnovitelných závislostí pro dosažení cíle. | Vybrat jen potřebný zásah, zachovat jeho zdroje a nezasahovat další projekty. |
| Aktivní projekt má více závislostí než neaktivní. | Aktivní projekt nevyhrává jen velikostí; jeho prostředí zůstává chráněné. |
| Starý Python používá aplikace nebo připnuté prostředí. | Nenabídnout jeho odstranění jako bezpečnou výchozí volbu. |
| Velký log a Docker volume jsou největší položky. | Zobrazit je k posouzení, ale nepředvybrat. |
| Repozitář má čistý Git status, ale ignorovaný `.env`, stash nebo lokální větev. | Neoznačit celý projekt za bezpečně obnovitelný jen z remote. |
| Není dost nízkorizikových kandidátů. | Oznámit nedosažitelný cíl; automaticky nepřidávat rizikové operace. |
| Sdílený store, vnořené `node_modules` nebo překrývající se kořeny. | Nezapočítat tutéž úsporu vícekrát. |
| Mezi skenem a čištěním projekt ožije nebo se změní cílová cesta. | Znovu ověřit, přeskočit neplatný zásah a zaznamenat důvod. |
| Po první operaci je cílové místo skutečně dostupné. | Další schválené, ale již nepotřebné operace nezačínat. |
| Čištění se přeruší nebo některý soubor nejde smazat. | Zachovat čitelný audit; rozlišit úspěch, chybu, částečný a neověřený výsledek. |
| Kořen disku není zapisovatelný nebo není prostor pro audit. | Před během nabídnout potvrzenou pracovní složku, například původní cwd. Bez zapisovatelného auditu nic nemazat a potichu nepřesunout historii. |
| Uživatel zvolí malý cíl či disk odlišný od pracovního adresáře. | Správně vyhodnotit jednotky i konkrétní cílový disk. |
| Stejný scénář běží na Windows, macOS a Linuxu. | Stejná logika cíle, ochrany a auditu; odlišnosti schopností jsou výslovně uvedené. |
| Globální sken je spuštěn z projektové složky. | Jasně oddělit rozsah skenu od umístění `<cwd>/.diskroom`; změnu workspace provést jen výslovně. |
| Symlink či junction vede mimo rozsah nebo se mezi skenem a akcí změní. | Nezasáhnout externí cíl; kandidáta odmítnout a zaznamenat důvod. |
| U pnpm nebo Dockeru nelze odhadnout výlučně uvolnitelný prostor. | Ukázat nejistotu, nepřičíst logické součty opakovaně a cíl posuzovat podle skutečného svazku. |
| Docker vymaže cache uvnitř virtuálního disku, ale na hostiteli zatím místo nepřibyde. | Neoznačit cíl hostitele za splněný a nepokračovat neschváleným širším čištěním. |
| Správce by plánovanou akcí odstranil i další nepotvrzené prostředky. | Takovou akci neprovést; nabídnout jen přesně vymezenou podporovanou operaci. |
| DiskRoom běží z npx cache nebo runtime, který patří mezi nálezy. | Vlastní program, jeho závislosti a běžící runtime z čištění vyloučit. |
| Sken prochází disk s miliony souborů. | Pracovat průběžně, nezahlcovat terminál, nevyžadovat velkou nekomprimovanou kopii auditu ani paměť úměrnou plnému inventáři. |
| Pád nastane mezi zapsaným záměrem a zapsaným výsledkem. | Předchozí uzavřené části historie zůstanou čitelné; dotčená operace má neověřený stav, ne automatický úspěch. |
| Audit přestane být zapisovatelný během čištění. | Bezpečně zastavit další destruktivní práci a nezahájit nový nezaznamenaný zásah. |
| Uživatel chce odstranit projekt, ve kterém je právě aktivní `.diskroom`. | Neodstranit vlastní audit; vysvětlit potřebu jiného potvrzeného workspace a nového ověření plánu. |
| Spustí se `diskroom scan . --json` mimo interaktivní terminál. | Vytvořit použitelný JSON bez TUI, uložit komprimovaný lokální audit a nic nesmazat. |
| Spustí se neinteraktivní `clean` bez potvrzovacího terminálu. | Skončit s vysvětlením a bez mazání. |
| Uživatel pouze otevře nápovědu, verzi nebo historii. | Neprovádět sken ani čištění; nezakládat falešný čisticí běh. |
| Přidá se nový ekosystém. | Zapojit jej do stejného reportu, prioritizace, potvrzení a auditu bez přepisu TUI. |
| Návštěvník otevře `diskroom.dev`. | Najít skutečné instrukce pro CLI a dokumentaci; nedostat webový přístup k lokálnímu disku ani nepravdivý příslib dostupného nevydaného balíčku. |
| Zkontroluje se název napříč CLI, npm, webem a auditem. | Používat DiskRoom / `diskroom` / `.diskroom`; verzi odvozovat ze skutečného vydání, ne z natvrdo zadaného ilustračního čísla. |

Tyto scénáře musí mít ověřitelné testy nebo reprodukovatelný postup ověření. Destruktivní testy běží nad izolovanými dočasnými stromy, repozitáři či testovacími prostředky, nikoli nad reálným uživatelským diskem. Testovací data zahrnují poškozené reporty, chybějící oprávnění, aktivní procesy, souběžné změny a přerušené běhy.

## 16. Mimo rozsah produktu

Produkt není univerzální systémový optimalizátor, čistič registrů, antivir ani zálohovací služba. Není určen k automatickému odstranění maximálního množství dat, změnám deklarovaných závislostí nebo přepisování historie na vzdáleném Git serveru. První verze nepotřebuje GUI, cloudovou synchronizaci ani automatický plánovač.

Průzkum názvu, kontrola jeho dostupnosti na npm a registrace domény jsou jednorázová produktová rozhodnutí, **nikoli funkce aplikace**. Konkrétní implementační jazyk, knihovny TUI, váhy heuristik a vnitřní uspořádání kódu tato specifikace nepředepisuje.

Mimo rozsah první verze jsou také prodej diskového prostoru, vzdálená správa cizích počítačů, automatické uploady historie, tržiště pluginů, přepisování projektových manifestů pro redukci závislostí, zastavování služeb kvůli získání místa a automatické rozšiřování oprávnění.

DiskRoom automaticky znovu neinstaluje smazané závislosti. Poskytuje vysvětlení a postup obnovy, ale opětovná instalace se neděje jako skrytá součást čištění. Nástroj neslibuje úplné undo; případná budoucí funkce zálohování musí být samostatně specifikována.

## 17. Požadované výstupy a definice dokončení

Dodávka obsahuje funkční multiplatformní npm CLI DiskRoom, vestavěné rozšiřitelné detektory uvedených oblastí, interaktivní průchod, cílově orientované plánování, oddělený sken a provedení, komprimovanou lokální auditní historii, testy, README a veřejný dokumentační web připravený pro `diskroom.dev`.

První vydání nesmí vydávat makety za podporované funkce. Pro každou kombinaci ekosystému, správce a platformy musí dokumentace pravdivě rozlišit **detekci**, **provádění konkrétního čištění** a **nepodporovanou operaci**. Základní bezpečné scénáře Node.js, Pythonu a Javy musejí být skutečně realizované; Docker a Git mají vlastní ověřené postupy nebo konkrétní vysvětlené omezení prostředí.

Před zveřejněním se ověří shoda názvů, kontrola nad cílovou npm identitou a hlavní doménou, skutečné platformní testy, korektnost odkazů a informací o licenci. Volba či změna licenčních podmínek patří vlastníkovi projektu, nikoli automatickému vedlejšímu rozhodnutí implementace. Nesmí se přebírat smyšlená dostupnost, rezervace, vlastnictví či nasazení z tohoto dokumentu.

Za úspěch se nepovažuje nejvyšší počet smazaných gigabajtů. Rozhodující je dosažení uživatelova cíle s nejnižším obhajitelným rizikem, zachování jeho rozpracované práce a úplná dohledatelnost toho, co se opravdu stalo. **Bezpečné odmítnutí zásahu je správnější výsledek než nedoložené dosažení cíle.**

## 18. Referenční podklady

Požadavky na produkt vycházejí ze zadání. Následující primární dokumentace objasňuje technické skutečnosti, na které odkazují příslušné bezpečnostní hranice; není zdrojem nových produktových funkcí. Dokumentace byla při zpracování konzultována 14. října 2026. Konkrétní implementace musí respektovat chování skutečně podporovaných verzí nástrojů.

[1]: https://pnpm.io/symlinked-node-modules-structure "pnpm — Symlinked node_modules structure"
[2]: https://docs.python.org/3/library/venv.html "Python — venv"
[3]: https://docs.docker.com/engine/manage-resources/pruning/ "Docker — Prune unused Docker objects"
[4]: https://git-scm.com/docs/git-gc "Git — git gc"
[5]: https://git-scm.com/docs/git-clone "Git — git clone"
[6]: https://docs.npmjs.com/cli/v11/configuring-npm/package-json/ "npm — package.json, bin a homepage"
