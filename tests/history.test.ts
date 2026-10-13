import { describe, expect, it } from 'vitest';
import { WorldHistory } from '../src/engine/history';
import { deserializeWorld, gunzip, gzip, serializeWorld, stateHash } from '../src/engine/serialize';
import type { World } from '../src/engine/world';
import { smallWorld } from './helpers';

function expectExact(actual: World, expected: World): void {
  expect(stateHash(actual)).toBe(stateHash(expected));
  expect(actual.tick).toBe(expected.tick);
  expect(actual.params).toEqual(expected.params);
  expect(actual.commandLog).toEqual(expected.commandLog);
  expect(actual.eventLog).toEqual(expected.eventLog);
  expect(actual.activeEvents).toEqual(expected.activeEvents);
  expect(actual.paramHistory).toEqual(expected.paramHistory);
  expect(actual.ledger).toEqual(expected.ledger);
  expect(actual.rng.getState()).toEqual(expected.rng.getState());
  expect(actual.envRng.getState()).toEqual(expected.envRng.getState());
  expect(actual.lineage.exportState().meta).toEqual(expected.lineage.exportState().meta);
  expect(actual.pinned).toBe(expected.pinned);
  expect(actual.schedIdx).toBe(expected.schedIdx);
}
function editArchive(bytes: Uint8Array, edit: (header: any) => void): Uint8Array {
  const oldLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + oldLength)));
  edit(header);
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(bytes.length - oldLength + json.length);
  out.set(bytes.subarray(0, 8)); new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12); out.set(bytes.subarray(12 + oldLength), 12 + json.length);
  return out;
}

describe('dokładna historia świata', () => {
  it('odtwarza dowolny tick, komendy tego samego ticku i zdarzenia planowane', () => {
    const w = smallWorld(901, { schedule: [{ tick: 23, spec: { kind: 'drought', severity: 0.2, duration: 31 } }] });
    const h = new WorldHistory(w, { interval: 40, maxCheckpoints: 8 });
    h.run(17);
    h.command({ type: 'setParam', key: 'mutationRate', value: 0.1 });
    h.command({ type: 'addFood', amount: 1234 });
    const at17 = deserializeWorld(serializeWorld(w));
    h.run(23); // checkpoint tick 40 precedes these two actions
    h.command({ type: 'event', spec: { kind: 'coldSnap', severity: 0.3, duration: 11 } });
    h.command({ type: 'setParam', key: 'mutationStrength', value: 0.2 });
    const at40 = deserializeWorld(serializeWorld(w));
    h.run(15);
    const at55 = deserializeWorld(serializeWorld(w));
    h.run(72);
    expectExact(h.worldAt(17), at17);
    expectExact(h.worldAt(40), at40);
    expectExact(h.worldAt(55), at55);
    expectExact(h.worldAt(w.tick), w);
    expect(h.info.events.some(e => e.text.includes('drought'))).toBe(true);
  });

  it('podgląd i jego zaznaczenia nie zmieniają teraźniejszości; rozwidlenie ma dawny genom', () => {
    const w = smallWorld(902);
    const h = new WorldHistory(w, { interval: 100 });
    h.run(65);
    const id = w.pool.id[0];
    const genome = Array.from(w.lineage.reconstruct(w.lineage.indexOf(id))!);
    const past = deserializeWorld(serializeWorld(w));
    h.run(80);
    const current = deserializeWorld(serializeWorld(w));
    const preview = h.seek(65);
    expectExact(preview, past);
    h.select(id);
    expectExact(w, current);
    expect(() => h.command({ type: 'addFood', amount: 100 })).toThrow(/Podgląd/);
    expect(() => h.run(1)).toThrow(/Podgląd/);
    const branch = deserializeWorld(serializeWorld(h.displayed));
    expect(Array.from(branch.lineage.reconstruct(branch.lineage.indexOf(id))!)).toEqual(genome);
    const control = deserializeWorld(serializeWorld(preview));
    branch.run(30); control.run(30);
    expectExact(branch, control);
    expect(h.returnLive()).toBe(w);
    expectExact(w, current);
  });

  it('odtwarza piny genealogii przy przycinaniu oraz custom retencję', () => {
    const w = smallWorld(903, {}, { predationPower: 0 });
    w.lineageRetention = 10;
    w.lineageMaxRecords = 20000;
    const h = new WorldHistory(w, { interval: 700 });
    h.select(w.pool.id[0]);
    h.run(999);
    h.select(w.pool.id[w.pool.n - 1]);
    h.run(1);
    const at1000 = deserializeWorld(serializeWorld(w));
    h.run(1);
    h.select(null);
    h.run(36);
    const replay = h.worldAt(1000);
    expectExact(replay, at1000);
    expect(replay.lineageRetention).toBe(10);
    expect(replay.lineageMaxRecords).toBe(20000);
    expectExact(h.worldAt(1037), w);
  });

  it('zatrzymuje odtwarzanie przy wymarciu i pozwala wrócić przed katastrofę', () => {
    const w = smallWorld(904);
    const h = new WorldHistory(w, { interval: 50 });
    h.run(25);
    const past = deserializeWorld(serializeWorld(w));
    h.run(1);
    h.command({ type: 'event', spec: { kind: 'cull', severity: 1 } });
    h.run(1000);
    expect(w.status).toBe('extinct');
    expectExact(h.worldAt(w.tick), w);
    expectExact(h.worldAt(25), past);
    expect(() => h.worldAt(w.tick + 1)).toThrow(/poza/);
  });

  it('limituje liczbę, bajty i dziennik punktów; pokazuje realny zakres', () => {
    const h = new WorldHistory(smallWorld(905), { interval: 10, maxCheckpoints: 3 });
    h.run(85);
    expect(h.info.checkpoints).toBe(3);
    expect(h.info.minTick).toBe(60);
    expect(() => h.worldAt(59)).toThrow(/poza/);
    expectExact(h.worldAt(85), h.live);
    const budget = new WorldHistory(smallWorld(906), { interval: 10, maxBytes: 1 });
    budget.run(35);
    expect(budget.info.checkpoints).toBe(1); // always retain one complete anchor, even above the soft byte budget
    expect(budget.info.minTick).toBe(30);
    const actions = new WorldHistory(smallWorld(907), { maxActions: 2 });
    actions.command({ type: 'addFood', amount: 1 });
    actions.run(5);
    actions.select(actions.live.pool.id[0]);
    actions.select(null);
    expect(actions.info.minTick).toBe(5);
    expectExact(actions.worldAt(5), actions.live);
  });

  it('archiwum przenosi pełny zakres, genealogię, interwencje i teraźniejszość', async () => {
    const original = smallWorld(908); original.lineageRetention = 17;
    const h = new WorldHistory(original, { interval: 50 });
    h.run(33);
    h.command({ type: 'event', spec: { kind: 'blight', severity: 0.2 } });
    h.select(h.live.pool.id[0]);
    const past = deserializeWorld(serializeWorld(h.live));
    h.run(87);
    const source = deserializeWorld(serializeWorld(h.live));
    h.seek(33);
    const archive = await gzip(h.serializeArchive());
    const restored = WorldHistory.fromArchive(await gunzip(archive));
    expect(restored.info.minTick).toBe(h.info.minTick);
    expect(restored.info.maxTick).toBe(120);
    expect(restored.preview).toBe(false);
    expectExact(restored.live, source);
    expectExact(restored.worldAt(33), past);
    expect(restored.worldAt(33).lineageRetention).toBe(17);
    expectExact(restored.worldAt(120), source);
    restored.run(11);
    h.returnLive(); h.run(11);
    expectExact(restored.live, h.live);
  });

  it('odrzuca uszkodzone archiwa, nieskończone ticki i niepełne dzienniki', () => {
    const h = new WorldHistory(smallWorld(909), { interval: 20 });
    h.run(5); h.command({ type: 'addFood', amount: 11 }); h.run(36);
    const archive = h.serializeArchive();
    expect(() => WorldHistory.fromArchive(new Uint8Array(10))).toThrow();
    expect(() => WorldHistory.fromArchive(archive.subarray(0, archive.length - 1))).toThrow();
    expect(() => WorldHistory.fromArchive(editArchive(archive, x => { x.checkpoints[1].tick = 0; }))).toThrow();
    expect(() => WorldHistory.fromArchive(editArchive(archive, x => { x.actions[0].ordinal = 100; }))).toThrow();
    expect(() => WorldHistory.fromArchive(editArchive(archive, x => { x.actions[0].cmd.amount = null; }))).toThrow();
    expect(() => WorldHistory.fromArchive(editArchive(archive, x => { x.options.maxCheckpoints = 100000; }))).toThrow();
    expect(() => h.worldAt(NaN)).toThrow();
    expect(() => h.worldAt(Infinity)).toThrow();
    expect(() => h.run(-1)).toThrow();
  });

  it('wczytany stan rozpoczyna historię od własnego ticku', () => {
    const w = smallWorld(910); w.run(123);
    const h = new WorldHistory(deserializeWorld(serializeWorld(w)));
    expect(h.info.minTick).toBe(123);
    expect(() => h.worldAt(122)).toThrow();
    expectExact(h.worldAt(123), w);
  });
});
