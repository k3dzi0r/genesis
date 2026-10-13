/** npm run calibrate -- --seeds 101,202,303,404,505,606 --ticks 10000 --out docs/calibration-0.5 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/engine/world';
import { ENGINE_VERSION } from '../src/engine/constants';
import { CALIBRATION_CONDITIONS, CALIBRATION_PARAMS, CALIBRATION_SETUP, calibrationComparisons, calibrationRun, type CalibrationRun } from '../src/engine/calibration';
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--seeds', '--ticks', '--out'].includes(key) || !value || options.has(key)) throw new Error(`Nieprawidłowa opcja: ${key}`);
  options.set(key, value);
}
const seeds = (options.get('--seeds') ?? '101,202,303,404,505,606').split(',').map(Number);
const ticks = Number(options.get('--ticks') ?? 10000);
if (seeds.length < 2 || seeds.length > 100 || new Set(seeds).size !== seeds.length || seeds.some(s => !Number.isSafeInteger(s) || s < 0 || s > 0xffffffff) || !Number.isSafeInteger(ticks) || ticks < 1 || ticks > 1000000) throw new Error('Wymagane 2–100 unikalnych seedów uint32 oraz 1–1000000 ticków.');
const out = options.get('--out') ?? 'docs/calibration-0.5';
mkdirSync(out, { recursive: true });
const runs: CalibrationRun[] = [];
const started = Date.now();
const reference = new World({ ...CALIBRATION_SETUP, seed: seeds[0] }, CALIBRATION_PARAMS);
const resolvedSetup = reference.setup, resolvedParams = reference.params;
for (const seed of seeds) for (const condition of CALIBRATION_CONDITIONS) {
  const result = calibrationRun(seed, ticks, condition.patch, seed === seeds[0]);
  runs.push({ condition: condition.id, ...result });
  if (!result.observationsImmutable || result.resumeExact === false || Math.abs(result.energyImbalance) > 1e-4) throw new Error(`Audyt nieudany: ${seed}/${condition.id}`);
  writeFileSync(join(out, 'runs.json'), JSON.stringify({ engine: ENGINE_VERSION, ticks, seeds, setup: resolvedSetup, params: resolvedParams, conditions: CALIBRATION_CONDITIONS, runs }, null, 2));
  console.log(`${runs.length}/${seeds.length * CALIBRATION_CONDITIONS.length} seed=${seed} ${condition.id}: tick=${result.summary.ticks}, pop=${result.summary.finalPop}, status=${result.summary.status}`);
}
const comparisons = calibrationComparisons(runs);
// A repeated control with the same seed audits reproducibility independently of save/resume.
const repeated = calibrationRun(seeds[0], ticks, {});
const repeatExact = repeated.finalHash === runs.find(r => r.condition === 'control' && r.summary.seed === seeds[0])!.finalHash;
if (!repeatExact) throw new Error('Powtórzona kontrola nie jest deterministyczna.');
const report = { engine: ENGINE_VERSION, generatedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000, ticks, seeds, setup: resolvedSetup, params: resolvedParams, conditions: CALIBRATION_CONDITIONS, repeatExact, comparisons, runs };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2));
writeFileSync(join(out, 'runs.csv'), ['condition,seed,tick,status,finalPop,meanPop,births,deaths,initialHash,finalHash,energyImbalance,resumeExact', ...runs.map(r => [r.condition,r.summary.seed,r.summary.ticks,r.summary.status,r.summary.finalPop,r.summary.meanPop,r.summary.totalBirths,r.summary.totalDeaths,r.initialHash,r.finalHash,r.energyImbalance,r.resumeExact ?? 'not-tested'].join(','))].join('\n'));
const rows = comparisons.map(c => {
  const m = c.metrics.finalPop;
  const treatment = runs.filter(r => r.condition === c.condition);
  return `| ${c.label} | ${m.diff.toFixed(2)} | [${m.ciLo.toFixed(2)}, ${m.ciHi.toFixed(2)}] | ${m.p.toFixed(4)} | ${treatment.filter(r => r.summary.status === 'extinct').length}/${seeds.length} |`;
});
writeFileSync(join(out, 'REPORT.md'), `# Kalibracja GENESIS ${ENGINE_VERSION}\n\nWykonano ${runs.length} biegów, po maksymalnie ${ticks} ticków (wymarcie kończy bieg). Seedy: ${seeds.join(', ')}. ${runs.filter(r => r.summary.ticks === ticks).length} biegów osiągnęło docelowy tick; pozostałe wymarły wcześniej. Rzeczywiste końce biegów: ${Math.min(...runs.map(r => r.summary.ticks))}–${Math.max(...runs.map(r => r.summary.ticks))}. Setup i pełne parametry doświadczenia znajdują się w report.json. Każdy wariant zmienia jeden parametr względem wspólnej kontroli; identyczne seedy tworzą pary. To seria eksploracyjna jednej konfiguracji, bez wyboru korzystnych seedów.\n\nKontrola: wszystkie sześć badanych mechanik aktywne, dwa pokarmy oraz rozród płciowy. Znak Δ = wariant − kontrola.\n\n| Wariant | Δ populacji końcowej | 95% CI różnicy sparowanej | p (bez korekty) | Wymarcia |\n|---|---:|---:|---:|---:|\n${rows.join('\n')}\n\nKontrola: ${runs.filter(r => r.condition === 'control' && r.summary.status === 'extinct').length}/${seeds.length} wymarć. Wyniki zerowe i przeciwne oczekiwaniom pozostają w danych. Przedziały t-Studenta przy małej liczbie seedów wymagają ostrożnej interpretacji; sześć porównań nie ma korekty wielokrotnych testów. Populacja ma twardy limit 600, więc nasycenie może ukrywać różnice. Średnia populacja jest średnią zachowanych wierszy statystyk; narodziny i zgony sumują przedziały do ostatniej próbki (możliwy niepełny końcowy przedział przy wymarciu). Nie mierzymy tutaj wyłonienia znaczenia sygnałów, pełnej specjacji ani przewagi każdego genotypu.\n\nAudyt: ponowna kontrola pierwszego seeda identyczna: ${repeatExact}. Zapis/odczyt w połowie i dalszy bieg identyczny dla każdego wariantu pierwszego seeda. Odczyty podsumowań i biomów nie zmieniły hashy. Maksymalny bezwzględny błąd bilansu energii: ${Math.max(...runs.map(r => Math.abs(r.energyImbalance)))}. Hashy FNV-1a używamy jako kontroli regresji, nie dowodu kryptograficznego. Czas: ${report.elapsedSeconds.toFixed(1)} s.\n\nPowtórzenie: \`npm run calibrate -- --seeds ${seeds.join(',')} --ticks ${ticks} --out docs/calibration-0.5\`. Surowe wyniki, metryki sparowane dla populacji średniej/końcowej, narodzin i zgonów: report.json; wszystkie biegi: runs.csv.\n`);
