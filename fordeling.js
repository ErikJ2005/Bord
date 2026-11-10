/*
 * Algoritmen for bordfordeling.
 *
 * Ingen filer skrives og ingenting logges eller sendes: alt skjer i minnet i
 * nettleseren.
 *
 * Idé
 * ---
 * Vi holder en tellematrise treff[i][j] = antall uker person i og j har sittet
 * ved samme bord. Hver uke søker vi etter en fordeling som minimerer
 *
 *     sum over alle par ved samme bord av  treff[i][j] ** 2
 *
 * Kvadratet gjør at et par som allerede har sittet sammen to ganger er mye
 * "dyrere" enn to par som har sittet sammen én gang, så gjentakelser spres
 * jevnt og alle får sitte med flest mulig forskjellige.
 *
 * Søket er simulert gløding (simulated annealing) med bytter mellom to
 * personer av samme type (stipp <-> stipp, elev <-> elev) ved forskjellige
 * bord. Kostnadsendringen for et bytte regnes ut i O(1) ved hjelp av
 * S[p][b] = summen av straff mellom person p og alle ved bord b.
 *
 * Fila kan brukes både som vanlig <script> og som Web Worker.
 */
(function (global) {
  "use strict";

  class FordelingsFeil extends Error {
    constructor(melding) {
      super(melding);
      this.name = "FordelingsFeil";
    }
  }

  function stokk(liste, rand) {
    for (let i = liste.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [liste[i], liste[j]] = [liste[j], liste[i]];
    }
    return liste;
  }

  /**
   * Bestem hvor mange som skal sitte ved hvert bord.
   *  - Bruker så mange bord som mulig så lenge hvert bord får minst `minimum`.
   *  - Fordeler folk så jevnt som mulig, innenfor kapasiteten til hvert bord.
   *  - Stipper spres jevnt (maks én per bord når det er nok bord).
   */
  function lagBordplan(antallStipper, antallElever, plasserPerBord, minimum, rand) {
    const n = antallStipper + antallElever;
    if (n === 0) throw new FordelingsFeil("Fant ingen navn i fila.");
    const kapasitet = plasserPerBord.reduce((a, b) => a + b, 0);
    if (n > kapasitet) {
      throw new FordelingsFeil(
        `Det er ${n} personer, men bare ${kapasitet} plasser totalt. ` +
          "Legg til flere bord eller plasser."
      );
    }

    // Største bord først (Array.sort er stabil, så rekkefølgen beholdes ved likhet)
    const rekkefolge = plasserPerBord.map((_, i) => i).sort((a, b) => plasserPerBord[b] - plasserPerBord[a]);
    let antall = Math.max(1, Math.min(plasserPerBord.length, Math.floor(n / Math.max(1, minimum))));
    const sumForste = (k) => rekkefolge.slice(0, k).reduce((s, i) => s + plasserPerBord[i], 0);
    while (sumForste(antall) < n) antall++;
    const valgte = rekkefolge.slice(0, antall).sort((a, b) => a - b);
    const kap = valgte.map((i) => plasserPerBord[i]);

    // Jevn fordeling ("vannfylling"): gi neste person til minste bord med plass
    const storrelser = new Array(antall).fill(0);
    for (let p = 0; p < n; p++) {
      let j = -1;
      for (let k = 0; k < antall; k++) {
        if (storrelser[k] >= kap[k]) continue;
        if (
          j < 0 ||
          storrelser[k] < storrelser[j] ||
          (storrelser[k] === storrelser[j] && kap[k] - storrelser[k] > kap[j] - storrelser[j])
        ) {
          j = k;
        }
      }
      storrelser[j]++;
    }

    // Stipper: jevnt fordelt, tilfeldig hvilke bord som får ekstra
    const stipp = new Array(antall).fill(0);
    let rest = antallStipper;
    while (rest > 0) {
      let kandidater = [];
      for (let k = 0; k < antall; k++) if (stipp[k] < storrelser[k]) kandidater.push(k);
      const minst = Math.min(...kandidater.map((k) => stipp[k]));
      kandidater = stokk(kandidater.filter((k) => stipp[k] === minst), rand);
      for (const k of kandidater.slice(0, rest)) {
        stipp[k]++;
        rest--;
      }
    }

    return valgte.map((bordIndeks, k) => ({
      bordIndeks,
      stippPlasser: stipp[k],
      elevPlasser: storrelser[k] - stipp[k],
    }));
  }

  /** Returnerer {bordFor, kostnad} for én uke. W[i*n+j] er straffen for at i og j sitter sammen. */
  function fordelEnUke(antallStipper, plan, W, n, rand, iterasjoner) {
    const T = plan.length;

    // Startløsning: tilfeldig, men respekterer stipp-/elevplasser.
    // Gruppene brukes også senere: bare personer i samme gruppe byttes.
    let grupper = [[], []];
    for (let p = 0; p < n; p++) grupper[p < antallStipper ? 0 : 1].push(p);
    grupper.forEach((g) => stokk(g, rand));
    const pos = [0, 0];
    const bordFor = new Int32Array(n);
    plan.forEach((b, bi) => {
      for (let i = 0; i < b.stippPlasser; i++) bordFor[grupper[0][pos[0]++]] = bi;
      for (let i = 0; i < b.elevPlasser; i++) bordFor[grupper[1][pos[1]++]] = bi;
    });

    // S[p*T+b] = sum av straff mellom p og alle ved bord b
    const S = new Float64Array(n * T);
    for (let p = 0; p < n; p++) {
      for (let q = 0; q < n; q++) S[p * T + bordFor[q]] += W[p * n + q];
    }
    let kostnad = 0;
    for (let p = 0; p < n; p++) kostnad += S[p * T + bordFor[p]];
    kostnad /= 2;

    if (kostnad === 0 || iterasjoner <= 0 || T < 2) return { bordFor, kostnad };

    grupper = grupper.filter((g) => g.length > 1);
    if (grupper.length === 0) return { bordFor, kostnad };
    const totalVekt = grupper.reduce((s, g) => s + g.length, 0);

    let beste = bordFor.slice();
    let besteKostnad = kostnad;
    const temp0 = 2.0, temp1 = 0.02;
    const faktor = Math.pow(temp1 / temp0, 1.0 / iterasjoner);
    let temp = temp0;

    for (let it = 0; it < iterasjoner; it++) {
      temp *= faktor;
      const g = grupper.length === 1 || rand() * totalVekt < grupper[0].length ? grupper[0] : grupper[1];
      const a = g[Math.floor(rand() * g.length)];
      const b = g[Math.floor(rand() * g.length)];
      const A = bordFor[a], B = bordFor[b];
      if (A === B) continue;
      const aT = a * T, bT = b * T;
      const wab = W[a * n + b];
      const delta = S[aT + B] - wab - S[aT + A] + (S[bT + A] - wab - S[bT + B]);
      if (delta <= 0 || rand() < Math.exp(-delta / temp)) {
        bordFor[a] = B;
        bordFor[b] = A;
        const an = a * n, bn = b * n;
        for (let p = 0; p < n; p++) {
          const d = W[an + p] - W[bn + p];
          if (d) {
            S[p * T + A] -= d;
            S[p * T + B] += d;
          }
        }
        kostnad += delta;
        if (kostnad < besteKostnad - 1e-9) {
          beste = bordFor.slice();
          besteKostnad = kostnad;
          if (besteKostnad <= 0) break;
        }
      }
    }
    return { bordFor: beste, kostnad: besteKostnad };
  }

  /**
   * Lag bordfordeling for flere uker.
   *
   * Returnerer {uker, stat}. `uker` er en liste (én per uke) med lister av
   * bord: {nr, navn: [...]}, der stipper står først.
   */
  function genererUker(stipper, elever, plasserPerBord, minimum, antallUker, framdrift, rand) {
    rand = rand || Math.random;
    const navn = [...stipper, ...elever];
    const n = navn.length;
    const ns = stipper.length;
    const treff = new Int32Array(n * n);
    const uker = [];

    const iterasjoner = Math.max(3000, 240 * n);
    const omstarter = 3;

    for (let uke = 0; uke < antallUker; uke++) {
      const plan = lagBordplan(ns, n - ns, plasserPerBord, minimum, rand);
      const W = new Float64Array(n * n);
      for (let i = 0; i < n * n; i++) W[i] = treff[i] * treff[i];
      let beste = null, besteKost = Infinity;
      for (let r = 0; r < omstarter; r++) {
        const { bordFor, kostnad } = fordelEnUke(ns, plan, W, n, rand, iterasjoner);
        if (kostnad < besteKost) {
          beste = bordFor;
          besteKost = kostnad;
        }
        if (besteKost <= 0) break;
      }

      const medlemmer = plan.map(() => []);
      for (let p = 0; p < n; p++) medlemmer[beste[p]].push(p);
      for (const m of medlemmer) {
        for (let i = 0; i < m.length; i++) {
          for (let j = i + 1; j < m.length; j++) {
            treff[m[i] * n + m[j]]++;
            treff[m[j] * n + m[i]]++;
          }
        }
      }
      uker.push(medlemmer.map((m, b) => ({ nr: plan[b].bordIndeks + 1, navn: m.map((p) => navn[p]) })));
      if (framdrift) framdrift(uke + 1, antallUker);
    }
    return { uker, stat: statistikk(navn, treff) };
  }

  function statistikk(navn, treff) {
    const n = navn.length;
    const perPerson = [];
    let gjentattePar = 0;
    for (let i = 0; i < n; i++) {
      let ulike = 0;
      for (let j = 0; j < n; j++) {
        if (j !== i && treff[i * n + j] > 0) ulike++;
        if (j > i && treff[i * n + j] > 1) gjentattePar++;
      }
      perPerson.push([navn[i], ulike]);
    }
    return { perPerson, gjentattePar };
  }

  const api = { FordelingsFeil, lagBordplan, genererUker, statistikk };
  global.Fordeling = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // Kjører som Web Worker: ta imot oppdrag og send tilbake resultat
  const erWorker =
    typeof WorkerGlobalScope !== "undefined" && global instanceof WorkerGlobalScope;
  if (erWorker) {
    global.onmessage = (e) => {
      const { stipper, elever, plasserPerBord, minimum, antallUker } = e.data;
      try {
        const res = genererUker(stipper, elever, plasserPerBord, minimum, antallUker, (i, n) =>
          global.postMessage({ type: "framdrift", i, n })
        );
        global.postMessage({ type: "ferdig", ...res });
      } catch (err) {
        global.postMessage({
          type: "feil",
          brukerfeil: err instanceof FordelingsFeil,
          melding: err instanceof FordelingsFeil ? err.message : err.name,
        });
      }
    };
  }
})(typeof self !== "undefined" ? self : globalThis);
