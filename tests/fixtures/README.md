# Original GENESIS v2 save

`world-v2.genesis` was generated using the actual unmodified 0.3.0 TypeScript engine at commit `66bbad06515a9c2a75e623b6b276bf9b43193cd7`, copied to an isolated temporary directory. It was not constructed by the v3 serializer or by reversing the new layout. The JSON file records original living genomes, IDs, population history and size deviations for independent comparisons.

Generation configuration:

```ts
const world = new World({
  seed: 123, width: 400, height: 400, initialPopulation: 50, capacity: 150,
  fertilityPattern: 'uniform', founderDietMax: 0, founderWeightSd: 0.6,
}, {
  sexual: 1, mutationRate: 0.08, accidentRate: 0,
  basalCoef: 0, moveCoef: 0, turnCoef: 0, senseCoef: 0,
  brainCoef: 0, eatCoef: 0, coldUpkeepCoef: 0, attackCoef: 0,
});
world.run(1000);
```

The fixture contains 150 living organisms, multiple generations, 11,379 recorded mutation entries, sexual ancestry, original 218-float genomes, and original 50-column statistics. Migration tests check mapping every original gene and reconstructing all living genomes from migrated founders and mutation records, before testing resumed v3 determinism.

## Original GENESIS v3 save

`world-v3.genesis` was captured directly with the unmodified local 0.4.0 engine on 13 October 2026, before the 0.5 engine edits. It is not a v4 save with removed fields. `world-v3.json` records its original totals, tick, population, ledger, mating counters and 67-column statistics stride.

Configuration: seed 731, 240×240 world, cell size 12, capacity 120, 40 founders, uniform fertility; `plantBShare=.6`, `communication=1`, `mateChoice=1`, `sexual=1`, `plasticityRate=.001`, `nicheRate=.5`, `obstacles=1`, `viewCos=0`, `accidentRate=0`, `mutationRate=.08`. The engine ran 240 ticks, leaving 31 organisms and 13 statistics rows. Original state hash: 2880473167. Energy imbalance: −2.55e−11.

Migration tests compare every original binary section byte for byte and all original statistics columns, then check deterministic resumed v4 execution. A separate header-only intervention reproduces the old B-disabled-with-leftovers condition and verifies its energy-preserving repair.
