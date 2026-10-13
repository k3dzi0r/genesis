import { describe, expect, it } from 'vitest';
import { behaviorAtlas, captureAncestorSpecimen, captureSpecimen, speciesAnalysis, validateSpecimen } from '../src/engine/behavior';
import { B2_OFF, GENOME_LEN, IN_MEM, N_HID, N_IN, N_TRAITS, OUT_MEM, OUT_TURN, TRAIT_MEMORY, W1_OFF, W2_OFF } from '../src/engine/constants';
import { interveneGenome, runLabGenerator, temporalMemoryProbe, type LabRequest } from '../src/engine/lab';
import { serializeWorld, stateHash } from '../src/engine/serialize';
import { pairedSeedTest, pairedTest } from '../src/engine/statsutil';
import { specimenFromJson, specimenToJson } from '../src/storage/atlas';
import { smallWorld } from './helpers';

function execute(req: LabRequest) { const gen = runLabGenerator(req); let r = gen.next(); let progress = 0; while (!r.done) { progress++; r = gen.next(); } return { result: r.value, progress }; }

describe('sparowane eksperymenty', () => {
  it('mierzy rozrzut różnic, zamiast rozrzutu wspólnego środowiska', () => {
    const r = pairedTest([10, 100, 1000], [11, 103, 1005]);
    expect(r.diff).toBe(3); expect(r.df).toBe(2); expect(r.t).toBeCloseTo(2.598076, 5);
    expect(r.ciLo).toBeCloseTo(-1.968, 2); expect(r.ciHi).toBeCloseTo(7.968, 2);
    const constant = pairedTest([10, 100, 1000], [12, 102, 1002]);
    expect(constant.t).toBe(Infinity); expect(constant.p).toBe(0); expect(constant.ciLo).toBe(2);
    expect(pairedTest([1, 2], [1, 2]).p).toBe(1);
  });
  it('dopasowuje seedy i odrzuca niepoprawny projekt', () => {
    expect(pairedSeedTest([{ seed: 1, v: 2 }, { seed: 2, v: 5 }], [{ seed: 2, v: 6 }, { seed: 1, v: 3 }], (r) => r.v).diff).toBe(1);
    expect(() => pairedSeedTest([{ seed: 1 }, { seed: 1 }], [{ seed: 1 }, { seed: 2 }], () => 0)).toThrow();
    expect(() => pairedTest([1], [2])).toThrow(); expect(() => pairedTest([1, 2], [1])).toThrow();
  });
});

describe('atlas i okazy', () => {
  it('preserves 0.4 specimen provenance, genome, somatic state and historical outcomes',()=>{
    const w=smallWorld(14); w.run(40);
    const source=captureSpecimen(w,w.pool.id[0]);
    const historical=execute({mode:'memory',specimenA:source,environments:[],seeds:[],ticks:40}).result;
    historical.engineVersion='0.4.0';
    const legacy=structuredClone(source) as unknown as Record<string,unknown>;
    legacy.engineVersion='0.4.0'; legacy.outcomes=[historical];
    delete (legacy.params as Record<string,unknown>).biomes; delete (legacy.params as Record<string,unknown>).biomeContrast; delete (legacy.behavior as Record<string,unknown>).biomeTransitions;
    const migrated=validateSpecimen(legacy);
    expect(migrated.engineVersion).toBe('0.4.0'); expect(migrated.provenance).toBe(source.provenance); expect(migrated.genome).toEqual(source.genome); expect(migrated.somaticWeights).toEqual(source.somaticWeights); expect(migrated.memory).toEqual(source.memory); expect(migrated.eligibility).toEqual(source.eligibility); expect(migrated.trace).toEqual(source.trace);
    expect(migrated.params.biomes).toBe(0); expect(migrated.behavior.biomeTransitions).toBe(0); expect(migrated.outcomes[0].engineVersion).toBe('0.4.0');
    expect((legacy.params as Record<string,unknown>).biomes).toBeUndefined();
    const fresh=execute({mode:'memory',specimenA:migrated,environments:[],seeds:[],ticks:40}).result;
    expect(fresh.engineVersion).toBe('0.5.0'); expect(fresh.notes.join(' ')).toMatch(/0\.4\.0/);
    const mixed=execute({mode:'commonGarden',specimenA:source,specimenB:migrated,environments:[{kind:'configured',label:'A',setup:w.setup,params:w.params},{kind:'configured',label:'B',setup:w.setup,params:w.params}],seeds:[1,2],ticks:1}).result;
    expect(mixed.notes.join(' ')).toMatch(/Okaz B.*0\.4\.0/); expect(mixed.engineVersion).toBe('0.5.0');
    expect(specimenFromJson(specimenToJson(migrated))).toEqual(migrated);
    expect(()=>validateSpecimen({...migrated,engineVersion:'0.3.0'})).toThrow();
  });
  it('rozróżnia rzeczywistą aktywność pomimo identycznych genotypów', () => {
    const w = smallWorld(12, { initialPopulation: 2 });
    w.pool.genomes.copyWithin(GENOME_LEN, 0, GENOME_LEN);
    w.pool.observedTicks.fill(100, 0, 2); w.pool.distance[0] = 100; w.pool.distance[1] = 5; w.pool.feedingTicks[1] = 80;
    const before = stateHash(w); const atlas = behaviorAtlas(w);
    expect(atlas.groups.map((g) => g.label)).toContain('Wędrowni poszukiwacze'); expect(atlas.groups.map((g) => g.label)).toContain('Osiadli żerujący');
    speciesAnalysis(w); expect(stateHash(w)).toBe(before);
  });
  it('mierzy kilka grup zgodności i rozróżnia rzeczywisty przepływ A/B', () => {
    const w = smallWorld(4, { initialPopulation: 6 }, { sexual: 1, mateChoice: 1 });
    for (let i = 0; i < 6; i++) {
      const phenotype = Math.floor(i / 2) * 0.45;
      w.pool.plantSpecialization[i] = phenotype; w.pool.diet[i] = phenotype;
      w.pool.matePreference[i] = phenotype; w.pool.mateSelectivity[i] = 1;
    }
    w.mating = { within: 3, between: 1, rejectedWithin: 2, rejectedBetween: 4 };
    const s = speciesAnalysis(w);
    expect(s.candidateGroups).toHaveLength(3); expect(s.sampledOrganisms).toBe(6);
    expect(s.geneFlow).toBe(0.25); expect(s.mateRejections).toBe(6);
  });
  it('odtwarza wyłącznie genotyp przodka i odrzuca wymyślony stan nauczony', () => {
    const w = smallWorld(7); const archived = captureAncestorSpecimen(w, w.pool.id[0]);
    expect(archived.provenance).toBe('archived-genome'); expect(archived.trace).toEqual([]);
    expect(() => execute({ mode: 'memory', specimenA: archived, environments: [], seeds: [], ticks: 40, somatic: true })).toThrow(/przodka/);
    expect(() => captureAncestorSpecimen(w, 9999999)).toThrow();
  });
  it('utrwala pełny stan, waliduje import i pozostaje niezależny od organizmu', () => {
    const w = smallWorld(14); w.run(40);
    const s = captureSpecimen(w, w.pool.id[0]); const restored = specimenFromJson(specimenToJson(s));
    expect(restored).toEqual(s); expect(restored.genome).toHaveLength(GENOME_LEN); expect(restored.eligibility).toHaveLength(GENOME_LEN);
    const old = s.genome[0]; w.pool.genomes[0] = 1 - old; expect(s.genome[0]).toBe(old);
    expect(() => validateSpecimen({ ...s, genome: [-2, ...s.genome.slice(1)] })).toThrow();
    expect(() => validateSpecimen({ ...s, params: { ...s.params, communication: Infinity } })).toThrow();
  });
});

describe('kontrolowane ogrody i interwencje', () => {
  it('pełne cztery komórki są deterministyczne, a źródło niezmienione', () => {
    const w = smallWorld(16, { initialPopulation: 15, capacity: 200 }); w.run(30);
    const s = captureSpecimen(w, w.pool.id[0]); const bytes = serializeWorld(w); const before = stateHash(w);
    const req: LabRequest = { mode: 'commonGarden', specimenA: s, specimenB: s, environments: [{ label: 'Dawne', kind: 'saved', bytes }, { label: 'Obecne', kind: 'saved', bytes }], seeds: [1, 2], ticks: 80 };
    const a = execute(req), b = execute(req);
    expect(a.result.runs).toHaveLength(8); expect(a.progress).toBeGreaterThan(8); expect(a.result).toEqual(b.result);
    expect(a.result.comparisons.every((r) => r.survival.diff === 0 && r.offspring.diff === 0)).toBe(true); expect(stateHash(w)).toBe(before);
    expect(a.result.runs.filter((r) => r.genotype.startsWith('A:') && r.environment === 'Dawne').map((r) => r.distance)[0]).not.toBe(a.result.runs.filter((r) => r.genotype.startsWith('A:') && r.environment === 'Dawne').map((r) => r.distance)[1]);
    expect(a.result.runs.every((r) => r.environmentTick === 30 && r.environmentKind === 'saved')).toBe(true);
  });
  it('interwencja somatyczna respektuje zakres efektywnych wag, genetyczna zeruje stan nauczony', () => {
    const w = smallWorld(8); const s = captureSpecimen(w, w.pool.id[0]); s.genome[N_TRAITS] = 3; s.somaticWeights[N_TRAITS] = 2;
    const req: LabRequest = { mode: 'mutation', specimenA: s, environments: [{ label: 'Kontrola', kind: 'saved', bytes: serializeWorld(w) }], seeds: [1,2], ticks: 20, gene: N_TRAITS, value: 6, somatic: true };
    expect(() => execute(req)).toThrow(/zakresem/);
    expect(execute({ ...req, somatic: false }).result.runs).toHaveLength(4);
  });
  it('zmienia dokładnie jeden gen i odrzuca pozorne/nieprawidłowe zmiany', () => {
    const w = smallWorld(18); const s = captureSpecimen(w, w.pool.id[0]); const changed = interveneGenome(s.genome, 0, s.genome[0] > 0.5 ? 0.2 : 0.8);
    expect(Array.from(changed).filter((v, i) => v !== s.genome[i])).toHaveLength(1);
    expect(() => interveneGenome(s.genome, 0, s.genome[0])).toThrow(); expect(() => interveneGenome(s.genome, GENOME_LEN, 0)).toThrow(); expect(() => interveneGenome(s.genome, N_TRAITS, 7)).toThrow();
    const { result } = execute({ mode: 'mutation', specimenA: s, environments: [{ label: 'Nowa mapa', kind: 'configured', setup: { ...s.setup, initialPopulation: 8 }, params: s.params }], seeds: [1, 2], ticks: 20, gene: 0, value: changed[0] });
    expect(result.runs).toHaveLength(4); expect(result.intervention?.gene).toBe(0);
    result.comparisons[0].survival = pairedTest([1, 3], [3, 5]);
    const withResults = { ...s, outcomes: [result] };
    expect(specimenFromJson(specimenToJson(withResults))).toEqual(withResults);
  });
});

describe('odroczona wskazówka', () => {
  it('pamięć odróżnia historie przy identycznym bieżącym wejściu; kontrola nie', () => {
    const g = new Float32Array(GENOME_LEN); g[TRAIT_MEMORY] = 0.7;
    g[W1_OFF + 3] = 4; // neuron 0 widzi wskazówkę
    g[W2_OFF + OUT_MEM * N_HID] = 4;
    g[W1_OFF + N_IN + IN_MEM] = 4; // neuron 1 czyta pamięć
    g[W2_OFF + OUT_TURN * N_HID + 1] = 4;
    const results = temporalMemoryProbe(g);
    expect(results[1].intactContrast).toBeGreaterThan(0.05); expect(results.every((r) => r.ablatedContrast === 0)).toBe(true);
    g[W1_OFF + N_IN + IN_MEM] = 0; g[B2_OFF + OUT_TURN] = 0.5;
    expect(temporalMemoryProbe(g).every((r) => r.intactContrast === 0)).toBe(true);
  });
});
