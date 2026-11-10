/*
 * Grensesnittet for Bordfordeling.
 *
 * Personvern: Fila du velger leses bare i nettleseren. Ingen navn eller
 * fordelinger sendes til noen server, lagres eller logges. Alt forsvinner når
 * fanen lukkes eller du trykker «Nullstill».
 */
(function () {
  "use strict";

  const { FordelingsFeil } = window.Fordeling;
  const $ = (id) => document.getElementById(id);

  const EKSEMPEL = [
    ["Elever", "Stipp"],
    ["Ola Nordmann", ""],
    ["Kari Hansen", ""],
    ["Per Olsen", "stipp"],
    ["Lise Berg", ""],
    ["Ahmed Ali", ""],
    ["Sofie Lie", "stipp"],
    ["Jonas Dahl", ""],
    ["Emma Moe", ""],
  ];

  let resultat = null;
  let arbeider = null;

  // ------------------------------------------------------------ hjelpere
  const norm = (v) => (v == null ? "" : String(v).trim().toLowerCase());

  function liste(navn, maks = 5) {
    const tekst = navn.slice(0, maks).join(", ");
    return navn.length > maks ? `${tekst} og ${navn.length - maks} til` : tekst;
  }

  /** Likhet mellom to tekster (0–1), tilsvarer difflib sin ratio(). */
  function likhet(a, b) {
    if (!a.length && !b.length) return 1;
    const dp = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let forrige = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? forrige + 1 : Math.max(dp[j], dp[j - 1]);
        forrige = tmp;
      }
    }
    return (2 * dp[b.length]) / (a.length + b.length);
  }

  function nermest(ord, kandidater, grense = 0.6) {
    let beste = null, besteVerdi = grense;
    for (const k of kandidater) {
      const v = likhet(ord, k);
      if (v >= besteVerdi) {
        beste = k;
        besteVerdi = v;
      }
    }
    return beste;
  }

  function lag(tag, attrs = {}, ...barn) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    for (const b of barn) el.append(b);
    return el;
  }

  // ------------------------------------------------------------ innlesing
  function parseCsv(tekst) {
    // Norsk Excel lagrer ofte CSV med semikolon: bruk det mest brukte skilletegnet
    const tell = (t) => tekst.split(t).length - 1;
    const skille = [",", ";", "\t"].reduce((a, b) => (tell(b) > tell(a) ? b : a));
    const rader = [];
    let rad = [], felt = "", iAnf = false;
    for (let i = 0; i < tekst.length; i++) {
      const c = tekst[i];
      if (iAnf) {
        if (c === '"') {
          if (tekst[i + 1] === '"') {
            felt += '"';
            i++;
          } else iAnf = false;
        } else felt += c;
      } else if (c === '"') iAnf = true;
      else if (c === skille) {
        rad.push(felt);
        felt = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && tekst[i + 1] === "\n") i++;
        rad.push(felt);
        rader.push(rad);
        rad = [];
        felt = "";
      } else felt += c;
    }
    if (felt || rad.length) {
      rad.push(felt);
      rader.push(rad);
    }
    return rader;
  }

  /** Returnerer [[arknavn, rutenett], ...] uten å tolke noen rad som overskrift. */
  async function lesArk(fil) {
    try {
      const buf = await fil.arrayBuffer();
      if (fil.name.toLowerCase().endsWith(".csv")) {
        let tekst;
        try {
          tekst = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          tekst = new TextDecoder("windows-1252").decode(buf);
        }
        return [["CSV", parseCsv(tekst.replace(/^﻿/, ""))]];
      }
      const bok = XLSX.read(new Uint8Array(buf), { type: "array" });
      return bok.SheetNames.map((navn) => [
        navn,
        XLSX.utils.sheet_to_json(bok.Sheets[navn], { header: 1, defval: "", raw: false, blankrows: true }),
      ]);
    } catch (e) {
      throw new FordelingsFeil(
        "Kunne ikke lese fila. Sjekk at det er en Excel-fil (.xlsx) eller en " +
          "CSV-fil, og at den ikke er skadet eller passordbeskyttet."
      );
    }
  }

  /**
   * Leser Excel/CSV med kolonnene «Elever» og (valgfritt) «Stipp».
   * Store/små bokstaver i overskriftene spiller ingen rolle, rader over
   * overskriften hoppes over, og alle ark søkes gjennom.
   */
  async function lesNavneliste(fil) {
    const ark = await lesArk(fil);
    let funnet = null;
    finn: for (const [arknavn, rader] of ark) {
      for (let i = 0; i < Math.min(rader.length, 20); i++) {
        const rad = rader[i].map(norm);
        if (rad.includes("elever")) {
          funnet = { arknavn, rader, radNr: i, overskrifter: rad };
          break finn;
        }
      }
    }
    if (!funnet) {
      const alle = new Map();
      for (const [, rader] of ark)
        for (const rad of rader.slice(0, 20))
          for (const v of rad) if (norm(v)) alle.set(norm(v), String(v).trim());
      const lik = nermest("elever", alle.keys());
      throw new FordelingsFeil(
        "Fant ingen kolonne som heter «Elever» i fila. Overskriften må stå " +
          "i en egen rad over navnene." +
          (lik ? ` Fant «${alle.get(lik)}» – skal den hete «Elever»?` : "")
      );
    }

    const { arknavn, rader, radNr, overskrifter } = funnet;
    const advarsler = [];
    const kolElev = overskrifter.indexOf("elever");
    const kolStipp = overskrifter.indexOf("stipp");
    if (kolStipp < 0) {
      const andre = new Map();
      overskrifter.forEach((h, k) => {
        if (h && k !== kolElev) andre.set(h, String(rader[radNr][k]).trim());
      });
      const lik = nermest("stipp", andre.keys());
      if (lik) {
        advarsler.push(
          `Fant ingen kolonne «Stipp», men kolonnen «${andre.get(lik)}» ligner. ` +
            "Alle er derfor behandlet som vanlige elever. Rett overskriften til " +
            "«Stipp» hvis det var meningen."
        );
      }
    }

    const stipper = [], elever = [];
    const ukjente = new Map(); // ukjent verdi -> navn
    for (const rad of rader.slice(radNr + 1)) {
      const navn = rad[kolElev] == null ? "" : String(rad[kolElev]).trim();
      if (!navn) continue;
      const rolle = kolStipp >= 0 ? norm(rad[kolStipp]) : "";
      if (rolle === "stipp") stipper.push(navn);
      else {
        elever.push(navn);
        if (rolle) {
          const verdi = String(rad[kolStipp]).trim();
          if (!ukjente.has(verdi)) ukjente.set(verdi, []);
          ukjente.get(verdi).push(navn);
        }
      }
    }

    if (arknavn !== ark[0][0]) advarsler.push(`Navnene ble lest fra arket «${arknavn}».`);
    for (const [verdi, navn] of ukjente) {
      advarsler.push(
        `Ukjent verdi «${verdi}» i Stipp-kolonnen for ${liste(navn)}. ` +
          "De er behandlet som vanlige elever. Bare «stipp» eller tom celle er gyldig."
      );
    }
    const antall = new Map();
    for (const n of [...stipper, ...elever]) antall.set(n, (antall.get(n) || 0) + 1);
    const doble = [...antall].filter(([, c]) => c > 1).map(([n]) => n);
    if (doble.length) {
      advarsler.push(
        `Disse navnene står flere ganger i lista: ${liste(doble)}. Hver forekomst ` +
          "får sin egen plass. Fjern dobbeltføringer, eller skill personene " +
          "med f.eks. etternavn."
      );
    }
    return { stipper, elever, advarsler };
  }

  // ------------------------------------------------------------ eksport
  /** Én kolonne per bord, kortere bord fylles ut med tomme celler. */
  function somTabell(bordliste) {
    const lengst = Math.max(...bordliste.map((b) => b.navn.length));
    const rader = [bordliste.map((b) => `Bord ${b.nr}`)];
    for (let i = 0; i < lengst; i++) rader.push(bordliste.map((b) => b.navn[i] || ""));
    return rader;
  }

  function lagExcel(ark) {
    const bok = XLSX.utils.book_new();
    for (const [navn, rader] of ark) XLSX.utils.book_append_sheet(bok, XLSX.utils.aoa_to_sheet(rader), navn);
    return new Blob([XLSX.write(bok, { type: "array", bookType: "xlsx" })], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function somCsv(rader) {
    const felt = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return rader.map((r) => r.map(felt).join(",")).join("\r\n") + "\r\n";
  }

  const CRC_TABELL = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABELL[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Lager en ukomprimert ZIP-fil. `filer` er [[filnavn, Uint8Array], ...]. */
  function lagZip(filer) {
    const enc = new TextEncoder();
    const deler = [], sentral = [];
    let offset = 0;
    for (const [navn, data] of filer) {
      const navnB = enc.encode(navn);
      const crc = crc32(data);
      const lokal = new DataView(new ArrayBuffer(30));
      lokal.setUint32(0, 0x04034b50, true);
      lokal.setUint16(4, 20, true);
      lokal.setUint16(6, 0x0800, true); // UTF-8-filnavn
      lokal.setUint16(12, 0x21, true); // dato 1980-01-01
      lokal.setUint32(14, crc, true);
      lokal.setUint32(18, data.length, true);
      lokal.setUint32(22, data.length, true);
      lokal.setUint16(26, navnB.length, true);
      deler.push(lokal, navnB, data);

      const s = new DataView(new ArrayBuffer(46));
      s.setUint32(0, 0x02014b50, true);
      s.setUint16(4, 20, true);
      s.setUint16(6, 20, true);
      s.setUint16(8, 0x0800, true);
      s.setUint16(14, 0x21, true);
      s.setUint32(16, crc, true);
      s.setUint32(20, data.length, true);
      s.setUint32(24, data.length, true);
      s.setUint16(28, navnB.length, true);
      s.setUint32(42, offset, true);
      sentral.push(s, navnB);
      offset += 30 + navnB.length + data.length;
    }
    const sentralStr = sentral.reduce((sum, d) => sum + d.byteLength, 0);
    const slutt = new DataView(new ArrayBuffer(22));
    slutt.setUint32(0, 0x06054b50, true);
    slutt.setUint16(8, filer.length, true);
    slutt.setUint16(10, filer.length, true);
    slutt.setUint32(12, sentralStr, true);
    slutt.setUint32(16, offset, true);
    return new Blob([...deler, ...sentral, slutt], { type: "application/zip" });
  }

  function lastNed(blob, filnavn) {
    const url = URL.createObjectURL(blob);
    const a = lag("a", { href: url, download: filnavn });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------ visning
  function visTabell(rader) {
    const tabell = lag("table");
    const thead = lag("thead", {}, lag("tr", {}, ...rader[0].map((h) => lag("th", {}, h))));
    const tbody = lag("tbody");
    for (const r of rader.slice(1)) tbody.append(lag("tr", {}, ...r.map((v) => lag("td", {}, v))));
    tabell.append(thead, tbody);
    return lag("div", { class: "tabell-boks" }, tabell);
  }

  function visMelding(tekst, type = "feil") {
    const boks = $("meldinger");
    boks.append(lag("div", { class: `melding ${type}`, role: type === "feil" ? "alert" : "status" }, tekst));
  }

  function tomResultat() {
    resultat = null;
    $("meldinger").replaceChildren();
    $("resultat").hidden = true;
    $("faner").replaceChildren();
    $("fane-innhold").replaceChildren();
  }

  function oppdaterBordfelter() {
    const antall = Math.max(1, Math.min(60, parseInt($("antall-bord").value, 10) || 1));
    const like = $("like-store").checked;
    $("felles-plasser").hidden = !like;
    const boks = $("per-bord");
    boks.hidden = like;
    if (like) return;
    const gamle = [...boks.querySelectorAll("input")].map((i) => i.value);
    boks.replaceChildren(
      ...Array.from({ length: antall }, (_, i) =>
        lag(
          "label",
          {},
          `Plasser ved bord ${i + 1}`,
          lag("input", { type: "number", min: "1", max: "40", value: gamle[i] || $("plasser").value || "7" })
        )
      )
    );
  }

  function heltall(id, min, max, navn) {
    const v = Number($(id).value);
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new FordelingsFeil(`«${navn}» må være et helt tall mellom ${min} og ${max}.`);
    }
    return v;
  }

  function lesInnstillinger() {
    const antallBord = heltall("antall-bord", 1, 60, "Antall bord");
    const minimum = heltall("minimum", 1, 8, "Minimum personer per bord");
    const startUke = heltall("start-uke", 1, 52, "Første uke");
    const sluttUke = heltall("slutt-uke", 1, 52, "Siste uke");
    if (sluttUke < startUke) throw new FordelingsFeil("Siste uke kan ikke være før første uke.");
    let plasserPerBord;
    if ($("like-store").checked) {
      plasserPerBord = new Array(antallBord).fill(heltall("plasser", 1, 40, "Plasser per bord"));
    } else {
      plasserPerBord = [...$("per-bord").querySelectorAll("input")].map((inp, i) => {
        const v = Number(inp.value);
        if (!Number.isInteger(v) || v < 1 || v > 40) {
          throw new FordelingsFeil(`Plasser ved bord ${i + 1} må være et helt tall mellom 1 og 40.`);
        }
        return v;
      });
    }
    return { antallBord, minimum, startUke, sluttUke, plasserPerBord };
  }

  /** Kjører algoritmen i en Web Worker (eller direkte hvis det ikke går). */
  function kjor(oppdrag, framdrift) {
    return new Promise((ok, feil) => {
      const direkte = () => {
        // Gi nettleseren tid til å tegne framdriftslinja før den travle jobben
        setTimeout(() => {
          try {
            const { stipper, elever, plasserPerBord, minimum, antallUker } = oppdrag;
            ok(window.Fordeling.genererUker(stipper, elever, plasserPerBord, minimum, antallUker, framdrift));
          } catch (e) {
            feil(e);
          }
        }, 30);
      };
      try {
        arbeider = new Worker("fordeling.js");
      } catch {
        direkte();
        return;
      }
      let startet = false;
      arbeider.onmessage = (e) => {
        startet = true;
        const m = e.data;
        if (m.type === "framdrift") framdrift(m.i, m.n);
        else {
          arbeider.terminate();
          arbeider = null;
          if (m.type === "ferdig") ok(m);
          else feil(m.brukerfeil ? new FordelingsFeil(m.melding) : new Error(m.melding));
        }
      };
      arbeider.onerror = (e) => {
        e.preventDefault();
        if (arbeider) arbeider.terminate();
        arbeider = null;
        if (startet) feil(new Error("Worker"));
        else direkte(); // f.eks. når siden åpnes direkte fra disk (file://)
      };
      arbeider.postMessage(oppdrag);
    });
  }

  async function generer() {
    tomResultat();
    const fil = $("fil").files[0];
    if (!fil) {
      visMelding("Last opp en navneliste først!");
      return;
    }
    const knapp = $("generer");
    const linje = $("framdrift");
    const tekst = $("framdrift-tekst");
    try {
      const innst = lesInnstillinger();
      const { stipper, elever, advarsler } = await lesNavneliste(fil);
      const antallUker = innst.sluttUke - innst.startUke + 1;
      knapp.disabled = true;
      linje.value = 0;
      linje.max = antallUker;
      tekst.textContent = "Lager fordeling …";
      $("framdrift-boks").hidden = false;
      const { uker, stat } = await kjor(
        { stipper, elever, plasserPerBord: innst.plasserPerBord, minimum: innst.minimum, antallUker },
        (i, n) => {
          linje.value = i;
          tekst.textContent = `Uke ${i} av ${n} ferdig`;
        }
      );
      const tabeller = uker.map((b, i) => [`Uke ${innst.startUke + i}`, somTabell(b)]);
      resultat = { tabeller, stat, advarsler };
      visResultat();
    } catch (e) {
      visMelding(
        e instanceof FordelingsFeil
          ? e.message
          : `Noe gikk galt (${e.name || "Feil"}). Sjekk fila og innstillingene.`
      );
    } finally {
      knapp.disabled = false;
      $("framdrift-boks").hidden = true;
    }
  }

  function visResultat() {
    const { tabeller, stat, advarsler } = resultat;
    visMelding("Bordfordeling generert!", "suksess");
    for (const a of advarsler) visMelding(a, "advarsel");

    const ulike = stat.perPerson.map(([, u]) => u);
    $("snitt").textContent = (ulike.reduce((a, b) => a + b, 0) / ulike.length).toFixed(1).replace(".", ",");
    $("faerrest").textContent = Math.min(...ulike);
    $("gjentatte").textContent = stat.gjentattePar;

    const faner = $("faner");
    const innhold = $("fane-innhold");
    tabeller.forEach(([navn, rader], i) => {
      const fane = lag("button", { type: "button", role: "tab", id: `fane-${i}`, "aria-controls": `panel-${i}` }, navn);
      const panel = lag("div", { role: "tabpanel", id: `panel-${i}`, "aria-labelledby": `fane-${i}` }, visTabell(rader));
      fane.addEventListener("click", () => velgFane(i));
      faner.append(fane);
      innhold.append(panel);
    });
    velgFane(0);
    $("resultat").hidden = false;
  }

  function velgFane(valgt) {
    $("faner").querySelectorAll("[role=tab]").forEach((f, i) => {
      f.setAttribute("aria-selected", String(i === valgt));
      f.tabIndex = i === valgt ? 0 : -1;
    });
    $("fane-innhold").querySelectorAll("[role=tabpanel]").forEach((p, i) => (p.hidden = i !== valgt));
  }

  // ------------------------------------------------------------ oppstart
  $("eksempel").append(visTabell(EKSEMPEL));
  $("last-ned-eksempel").addEventListener("click", () =>
    lastNed(lagExcel([["Navneliste", EKSEMPEL]]), "Eksempel_navneliste.xlsx")
  );
  $("antall-bord").addEventListener("input", oppdaterBordfelter);
  $("like-store").addEventListener("change", oppdaterBordfelter);
  $("generer").addEventListener("click", generer);
  $("nullstill").addEventListener("click", () => {
    if (arbeider) {
      arbeider.terminate();
      arbeider = null;
    }
    tomResultat();
    $("skjema").reset();
    oppdaterBordfelter();
  });
  $("fil").addEventListener("change", tomResultat);
  $("faner").addEventListener("keydown", (e) => {
    const faner = [...$("faner").querySelectorAll("[role=tab]")];
    const i = faner.indexOf(document.activeElement);
    if (i < 0 || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const ny = (i + (e.key === "ArrowRight" ? 1 : -1) + faner.length) % faner.length;
    velgFane(ny);
    faner[ny].focus();
  });
  $("last-ned-excel").addEventListener("click", () => {
    const oversikt = [["Navn", "Antall ulike bordkamerater"], ...resultat.stat.perPerson];
    lastNed(lagExcel([...resultat.tabeller, ["Oversikt", oversikt]]), "Bordfordeling.xlsx");
  });
  $("last-ned-zip").addEventListener("click", () => {
    const enc = new TextEncoder();
    const filer = resultat.tabeller.map(([navn, rader]) => {
      // BOM gjør at Excel viser æ, ø og å riktig
      const tekst = enc.encode("﻿" + somCsv(rader));
      return [`Bordfordeling_${navn.replace(/ /g, "_")}.csv`, tekst];
    });
    lastNed(lagZip(filer), "Alle_bordfordelinger.zip");
  });
  oppdaterBordfelter();
})();
