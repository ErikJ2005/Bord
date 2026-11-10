# Bordfordeling

Lager bordfordeling for flere uker slik at alle sitter med flest mulig
forskjellige personer.

Dette er en vanlig, statisk nettside (HTML, CSS og JavaScript) uten
server og uten Python/Streamlit.

## Personvern

- Ingen navn eller fordelinger skrives til disk, logges eller sendes videre.
  Hele appen kjører **i nettleseren**: fila du laster opp forlater aldri
  datamaskinen din, og alt forsvinner når fanen lukkes (eller når du trykker
  «Nullstill»).
- Den eneste eksterne fila er [SheetJS](https://sheetjs.com) (for å lese og
  skrive Excel), som lastes fra `cdn.sheetjs.com`. Den kjører også lokalt og
  sender ingenting.

## Filer

| Fil            | Innhold                                                     |
|----------------|-------------------------------------------------------------|
| `index.html`   | Selve siden                                                 |
| `style.css`    | Utseende (lys og mørk modus, fungerer på mobil)             |
| `app.js`       | Innlesing av navneliste, visning og nedlasting (Excel/ZIP)  |
| `fordeling.js` | Algoritmen. Kjører i en Web Worker så siden ikke fryser      |

## Filformat

Excel (`.xlsx`) eller CSV med kolonnene:

| Elever | Stipp |
|--------|-------|
| Ola    |       |
| Kari   | stipp |
| Per    |       |

- `stipp`: spres jevnt utover bordene (helst én per bord).
- Tom: vanlig elev.

Alle som står i lista får bordplass.

Store og små bokstaver i overskriftene spiller ingen rolle, andre kolonner og
en tittelrad over overskriftene hoppes over, og navnelista kan ligge i
hvilket som helst ark. Appen advarer om ukjente verdier i Stipp-kolonnen,
navn som står flere ganger, og en kolonne som ligner «Stipp» men er stavet
annerledes.

## Publisere gratis med GitHub Pages

1. Slå sammen endringene til `main`.
2. På GitHub: **Settings → Pages → Build and deployment**, velg
   *Deploy from a branch*, gren `main`, mappe `/ (root)`, og lagre.
3. Etter et minutt er siden tilgjengelig på
   `https://<brukernavn>.github.io/<repo>/`.

Siden kan også legges på hvilken som helst annen statisk vert (Netlify,
Cloudflare Pages, en skoleserver o.l.): bare last opp filene.

> **Obs:** Alt som ligger i repoet blir offentlig tilgjengelig på
> GitHub Pages. Ikke legg navnelister (f.eks. `.xlsx`-filer) i repoet.

## Kjøre lokalt

```bash
python3 -m http.server 8000
```

Åpne deretter <http://localhost:8000>. (Å åpne `index.html` direkte fra
disk fungerer også, men da kjører algoritmen uten Web Worker.)

## Hvordan algoritmen fungerer

For hvert par telles hvor mange uker de har sittet sammen. Hver uke søkes det
(simulert gløding med bytter mellom bord) etter en fordeling som minimerer
summen av *antall ganger²* for alle par ved samme bord. Kvadratet gjør at
gjentakelser spres jevnt, slik at ingen par sitter sammen mange ganger.

Sammenlignet med den gamle versjonen (100 tilfeldige forsøk per uke), med 65
personer, 10 bord og 10 uker:

|                                   | Før | Nå |
|-----------------------------------|-----|----|
| Par som satt sammen mer enn én gang | 403 | ~150 |
| Flest ganger samme par satt sammen | 4   | 2  |
| Snitt ulike bordkamerater          | 41  | 51 |

Med 158 personer og 15 uker gikk tiden fra ca. 11 s (gammel versjon) til
under ett sekund i nettleseren.
