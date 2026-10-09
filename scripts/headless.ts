/**
 * GENESIS w trybie headless — długie eksperymenty bez interfejsu (Node ≥ 20).
 *
 *   npm run headless -- --ticks 1000000 --seed 7 --out runs/exp1 --checkpoint 100000 --report 20000
 *   npm run headless -- --resume runs/exp1/latest.genesis --ticks 2000000 --out runs/exp1
 *
 * Opcje:
 *   --ticks N         docelowy numer ticku (przy --resume: do którego ticku dobiec)
 *   --seed N          seed (domyślnie 1)
 *   --setup JSON      nadpisania WorldSetup, np. '{"initialPopulation":800,"width":1200,"height":1200}'
 *   --params JSON     nadpisania WorldParams, np. '{"regrowthRate":0.3}'
 *   --out DIR         katalog wyjściowy (checkpointy, stats.csv, experiment.json)
 *   --checkpoint N    zapis punktu kontrolnego co N ticków (domyślnie 100000, 0 = tylko na końcu)
 *   --report N        wydruk postępu co N ticków (domyślnie 5000)
 *   --resume FILE     wznów z pliku .genesis (zapisanego przez UI lub ten skrypt)
 *
 * Pliki .genesis można zaimportować w przeglądarce (Zapisy → Importuj plik).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/engine/world';
import { TRAIT_NAMES } from '../src/engine/constants';
import { deserializeWorld, gunzip, gzip, serializeWorld } from '../src/engine/serialize';
import { exportExperimentJson } from '../src/engine/experiment';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const ticks = Number(arg('ticks', '20000'));
const seed = Number(arg('seed', '1'));
const report = Number(arg('report', '5000'));
const ckEvery = Number(arg('checkpoint', '100000'));
const out = arg('out');
const resume = arg('resume');
const setup = JSON.parse(arg('setup', '{}')!);
const params = JSON.parse(arg('params', '{}')!);

async function main(): Promise<void> {
  let w: World;
  if (resume) {
    w = deserializeWorld(await gunzip(new Uint8Array(readFileSync(resume))));
    console.log(`wznowiono ${resume}: tick=${w.tick} pop=${w.pool.n} seed=${w.setup.seed}`);
  } else {
    w = new World({ seed, ...setup }, params);
    console.log(`nowy świat: seed=${w.setup.seed} ${w.setup.width}x${w.setup.height} założyciele=${w.pool.n}`);
  }
  if (out) mkdirSync(out, { recursive: true });

  const checkpoint = async (final = false) => {
    if (!out) return;
    const bytes = await gzip(serializeWorld(w, `headless @${w.tick}`));
    writeFileSync(join(out, `checkpoint-${w.tick}.genesis`), bytes);
    writeFileSync(join(out, 'latest.genesis'), bytes);
    if (final) {
      writeFileSync(join(out, 'stats.csv'), w.stats.toCsv());
      writeFileSync(join(out, 'experiment.json'), exportExperimentJson(w));
    }
  };

  const t0 = performance.now();
  const startTick = w.tick;
  let nextCk = ckEvery > 0 ? Math.floor(w.tick / ckEvery) * ckEvery + ckEvery : Infinity;
  while (w.tick < ticks && w.status === 'running') {
    w.run(Math.min(report, ticks - w.tick));
    const s = w.stats;
    const traits = TRAIT_NAMES.filter((n) => n !== 'hue').map((n) => `${n.slice(0, 4)}=${s.last('m_' + n).toFixed(2)}`).join(' ');
    const rate = (w.tick - startTick) / ((performance.now() - t0) / 1000);
    console.log(
      `t=${w.tick} pop=${w.pool.n} gen=${s.last('maxGen')} zasoby=${(s.last('foodFrac') * 100).toFixed(0)}% E=${s.last('meanEnergy').toFixed(2)} ` +
        `różn.=${s.last('diversity').toFixed(3)} drap=${(s.last('carnFrac') * 100).toFixed(0)}% zżerani/1000t=${s.recentRate('dPred').toFixed(0)} kl=${s.last('cladeCount')} | ${traits} | ${rate.toFixed(0)} t/s | węzły rodowodu=${w.lineage.liveNodes} | RSS=${Math.round(process.memoryUsage().rss / 1e6)}MB | bilans=${w.energyImbalance().toExponential(1)}`,
    );
    if (w.tick >= nextCk) {
      await checkpoint();
      nextCk += ckEvery;
    }
  }
  await checkpoint(true);
  console.log(w.status === 'extinct' ? `WYMARCIE w ticku ${w.tick}` : `zakończono w ticku ${w.tick}`);
}

void main();
