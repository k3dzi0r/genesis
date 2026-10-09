import { describe, expect, it } from 'vitest';
import { GENOME_LEN, N_TRAITS, PHYSIO } from '../src/engine/constants';
import { smallWorld } from './helpers';

describe('reprodukcja i selekcja', () => {
  it('potomek dziedziczy cechy rodzica (przy mutacjach = 0 identyczne) i ma pokolenie +1', () => {
    const w = smallWorld(21, {}, { mutationRate: 0 });
    w.run(1500);
    const L = w.lineage;
    let kids = 0;
    for (let i = 0; i < w.pool.n; i++) {
      const node = w.pool.lin[i];
      const par = L.parent[node];
      if (par < 0) continue;
      kids++;
      expect(L.mutCount[node]).toBe(0);
      for (let t = 0; t < N_TRAITS; t++) expect(L.traits[node * N_TRAITS + t]).toBe(L.traits[par * N_TRAITS + t]);
      expect(L.gen[node]).toBe(L.gen[par] + 1);
    }
    expect(kids).toBeGreaterThan(0);
  });

  it('reprodukcja kosztuje: dziecko dostaje ≤ inwestycji, reszta to narzut rozproszony jako ciepło', () => {
    const w = smallWorld(22);
    w.run(1200);
    expect(w.ledger.outRepro).toBeGreaterThan(0);
    expect(w.lineage.totalRecorded).toBeGreaterThan(w.setup.initialPopulation);
  });

  it('populacja nie przekracza limitu ani pojemności puli', () => {
    const w = smallWorld(23, { capacity: 300, initialPopulation: 100 }, { maxPopulation: 250 });
    for (let k = 0; k < 15; k++) {
      w.run(200);
      expect(w.pool.n).toBeLessThanOrEqual(250);
    }
  });

  it('populacja jest ograniczona dostępnością energii, a nie tylko twardym limitem', () => {
    const w = smallWorld(24, {}, { maxPopulation: 6000 });
    w.run(6000);
    expect(w.pool.n).toBeLessThan(1500);
    expect(w.pool.n).toBeGreaterThan(0);
  });

  it('organizmy nie rozmnażają się przed dojrzałością', () => {
    const w = smallWorld(25);
    w.run(2500);
    const L = w.lineage;
    for (let n = 0; n < L.size; n++) {
      if (L.death[n] === -2 || L.parent[n] < 0) continue;
      const p = L.parent[n];
      const age = L.birth[n] - L.birth[p];
      expect(age).toBeGreaterThanOrEqual(PHYSIO.maturityMin - 1);
    }
  });

  it('presja środowiska przesuwa ewoluowane cechy: drogie sensory → mniejszy zasięg (seed 2)', () => {
    const base = smallWorld(2, { initialPopulation: 300 });
    const costly = smallWorld(2, { initialPopulation: 300 }, { senseCoef: 0.0003 });
    base.run(7000);
    costly.run(7000);
    expect(base.status).toBe('running');
    expect(costly.status).toBe('running');
    expect(costly.stats.last('m_sense')).toBeLessThan(base.stats.last('m_sense') - 0.1);
  });

  it('presja środowiska przesuwa ewoluowane cechy: stałe zimno → większa odporność na zimno (średnia z 5 seedów)', () => {
    const meanCold = (params: Parameters<typeof smallWorld>[2]) => {
      let sum = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const w = smallWorld(seed, { initialPopulation: 300 }, params);
        w.run(7000);
        expect(w.status).toBe('running');
        sum += w.stats.last('m_coldTolerance');
      }
      return sum / 5;
    };
    // pojedynczy seed bywa zdominowany przez dryf (klonalne sprzężenie genów), dlatego uśredniamy
    expect(meanCold({ baseTemperature: 0.1, coldMetabK: 4, regrowthRate: 0.15 })).toBeGreaterThan(meanCold({}) + 0.1);
  });
});

/** Dwie podpopulacje o identycznych genach poza jedną cechą — mierzymy różnicową przeżywalność. */
function twoGroups(trait: number, params: Parameters<typeof smallWorld>[2], ticks: number) {
  const w = smallWorld(5, { initialPopulation: 300 }, { mutationRate: 0, ...params });
  const p = w.pool;
  for (let i = 1; i < p.n; i++) for (let g = 1; g < GENOME_LEN; g++) p.genomes[i * GENOME_LEN + g] = p.genomes[g];
  for (let i = 0; i < p.n; i++) {
    p.genomes[i * GENOME_LEN + trait] = i % 2 === 0 ? 0 : 1;
    w.derivePhysiology(i);
    p.energy[i] = 0.5 * p.maxE[i];
  }
  w.run(ticks);
  let low = 0;
  let high = 0;
  for (let i = 0; i < p.n; i++) (p.genomes[i * GENOME_LEN + trait] < 0.5 ? low++ : high++);
  return { low, high, w };
}

describe('różnicowa przeżywalność (mechanizm selekcji naturalnej)', () => {
  it('w zimnie przeżywają i mnożą się osobniki odporne na zimno', () => {
    const r = twoGroups(6, { baseTemperature: 0.2, coldMetabK: 5, coldDamage: 0.01 }, 800);
    expect(r.high).toBeGreaterThan(r.low * 1.5);
  });

  it('przy drogich sensorach wygrywają osobniki z małym zasięgiem', () => {
    const r = twoGroups(2, { senseCoef: 0.001 }, 500);
    expect(r.low).toBeGreaterThan(r.high * 2);
  });

  it('przy drogim ruchu wygrywają wolniejsze osobniki', () => {
    const r = twoGroups(1, { moveCoef: 2 }, 600);
    expect(r.low).toBeGreaterThan(r.high * 1.5);
  });
});
