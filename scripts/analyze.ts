/**
 * Analiza zachowań i strategii populacji z zapisu .genesis:
 *   npm run analyze -- plik.genesis [--ablation] [--ticks 300] [--k 4]
 */
import { readFileSync } from 'node:fs';
import { ablationSuite, clusterStrategies, probeBehavior } from '../src/engine/analysis';
import { TRAIT_NAMES } from '../src/engine/constants';
import { deserializeWorld, gunzip } from '../src/engine/serialize';

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('Użycie: npm run analyze -- plik.genesis [--ablation] [--ticks 300] [--k 4]');
  process.exit(1);
}
const flag = (n: string) => process.argv.includes(`--${n}`);
const opt = (n: string, d: number) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const w = deserializeWorld(await gunzip(new Uint8Array(readFileSync(file))));
const { results, n } = probeBehavior(w);
console.log(`tick=${w.tick} populacja=${n} seed=${w.setup.seed} maks. pokolenie=${w.stats.last('maxGen')} drapieżniki=${(w.stats.last('carnFrac') * 100).toFixed(0)}% klady=${w.stats.last('cladeCount')}`);
console.log('Średnie cechy:', TRAIT_NAMES.map((t) => `${t}=${w.stats.last('m_' + t).toFixed(2)}`).join(' '));

console.log('\nStrategie (k-średnie po cechach):');
for (const c of clusterStrategies(w, opt('k', 4)))
  console.log(`  ${(c.share * 100).toFixed(0).padStart(3)}%  ${c.label.padEnd(44)} energia=${c.meanEnergy.toFixed(2)} wiek=${c.meanAge.toFixed(0)} potomstwo=${c.meanOffspring.toFixed(1)}`);

console.log('\nSondy zachowań (dodatni wynik = odruch wyglądający adaptacyjnie; z = odchylenie od losowych sieci w błędach standardowych):');
for (const r of results)
  console.log(`  ${r.label.padEnd(36)} wynik=${r.mean.toFixed(3).padStart(7)}  odsetek>0=${(r.fraction * 100).toFixed(0).padStart(3)}%  losowe=${r.baselineMean.toFixed(3).padStart(7)}±${r.baselineSd.toFixed(3)}  z=${r.z.toFixed(1)}`);

if (flag('ablation')) {
  const ticks = opt('ticks', 400);
  console.log(`\nTest ablacji kohortowej (${ticks} ticków; połowa organizmów traci zmysł; dodatni wynik = zmysł się opłaca; |z| < 3 ≈ szum przy 12 porównaniach):`);
  const s = ablationSuite(w, ticks);
  console.log(`  kontrast zerowy (bez ablacji): Δprzeżycie=${s.nullRow.dSurvival.toFixed(3)} Δpotomstwo=${s.nullRow.dOffspring.toFixed(3)}`);
  for (const r of s.rows)
    console.log(
      `  ${r.label.padEnd(42)} Δprzeżycie=${r.dSurvival.toFixed(3).padStart(7)} (z=${r.zSurvival.toFixed(1).padStart(5)})  Δpotomstwo=${r.dOffspring.toFixed(3).padStart(7)} (z=${r.zOffspring.toFixed(1).padStart(5)})  [ablowani: ${(r.ablated.survival * 100).toFixed(0)}% / ${r.ablated.offspring.toFixed(2)}, nienaruszeni: ${(r.intact.survival * 100).toFixed(0)}% / ${r.intact.offspring.toFixed(2)}]`,
    );
}
