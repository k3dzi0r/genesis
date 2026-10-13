import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeWorld, gunzip, readHeader, serializeWorld, stateHash } from '../src/engine/serialize';
import { WorldHistory } from '../src/engine/history';
import { smallWorld } from './helpers';
import type { FromWorker, ToWorker } from '../src/worker/protocol';

let messages: FromWorker[];
let context: { onmessage: ((event: MessageEvent<ToWorker>) => void) | null; postMessage: (message: FromWorker) => void };
let waiters: { req: number; resolve: (m: FromWorker) => void }[];
const send = (message: ToWorker) => context.onmessage!({ data: message } as MessageEvent<ToWorker>);
const response = (req: number) => messages.find(m => 'req' in m && m.req === req)!;
const nextResponse = (req: number) => new Promise<FromWorker>(resolve => waiters.push({ req, resolve }));
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); messages = []; waiters = [];
  context = { onmessage: null, postMessage: message => {
    messages.push(message);
    if ('req' in message) for (const waiter of waiters.filter(w => w.req === message.req)) waiter.resolve(message);
  } };
  vi.stubGlobal('self', context);
  await import('../src/worker/sim.worker');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('integracja historii z workerem', () => {
  it('acknowledges a complete same-tick batch, rejects invalid batches before mutation, and sends local maps', async () => {
    const original = smallWorld(923);
    send({ t: 'load', bytes: serializeWorld(original) });
    send({ t: 'commands', req: 40, commands: [{ type: 'setParam', key: 'biomes', value: 1 }, { type: 'setParam', key: 'biomeContrast', value: 0.8 }] });
    expect(response(40)).toMatchObject({ t: 'commands', tick: 0, applied: 2 });
    const status = messages.filter(m => m.t === 'status').at(-1)!;
    expect(status).toMatchObject({ biomes: { enabled: true, contrast: 0.8 } });
    send({ t: 'historicalWorld', tick: 0, req: 41 });
    const valid = response(41);
    if (valid.t !== 'historyBytes') throw new Error('No world');
    const baseline = stateHash(deserializeWorld(valid.bytes));
    send({ t: 'commands', req: 42, commands: [{ type: 'setParam', key: 'biomes', value: 0 }, { type: 'setParam', key: 'biomeContrast', value: NaN }] });
    expect(response(42)).toMatchObject({ t: 'error' });
    send({ t: 'historicalWorld', tick: 0, req: 43 });
    const unchanged = response(43);
    if (unchanged.t !== 'historyBytes') throw new Error('No world');
    expect(stateHash(deserializeWorld(unchanged.bytes))).toBe(baseline);
    await vi.advanceTimersByTimeAsync(30);
    const frame = messages.find(m => m.t === 'frame');
    if (!frame || frame.t !== 'frame') throw new Error('No frame');
    expect(frame.biome).toBeInstanceOf(Uint8Array);
    expect(frame.localTemperature?.length).toBe(original.grid.cells);
    expect(frame.localTemperature?.every(Number.isFinite)).toBe(true);
    send({ t: 'historySeek', tick: 0, req: 44 });
    send({ t: 'commands', req: 45, commands: [{ type: 'setParam', key: 'biomes', value: 0 }] });
    expect(response(45)).toMatchObject({ t: 'error', req: 45 });
  });

  it('podgląd blokuje zmiany, rozwidla stan z metadanymi tego samego ticku i zachowuje live', async () => {
    const original = smallWorld(920);
    send({ t: 'load', bytes: serializeWorld(original) });
    send({ t: 'step', n: 17 }); original.run(17);
    const cmd = { type: 'addFood' as const, amount: 777 };
    send({ t: 'command', cmd }); original.applyCommand(cmd);
    const at17 = deserializeWorld(serializeWorld(original));
    send({ t: 'step', n: 36 }); original.run(36);
    send({ t: 'historySeek', tick: 17, req: 10 });
    expect(response(10)).toMatchObject({ t: 'history', info: { preview: true, viewTick: 17, maxTick: 53 } });
    send({ t: 'step', n: 100 });
    send({ t: 'command', cmd });
    expect(messages.filter(m => m.t === 'error')).toHaveLength(2);
    const fork = nextResponse(11); send({ t: 'save', req: 11, reason: 'fork', label: 'dawny świat' });
    // World navigation proceeds while compression is asynchronous; metadata must match serialized tick 17.
    send({ t: 'historyLive', req: 12 });
    const saved = await fork;
    expect(saved.t).toBe('saved');
    if (saved.t !== 'saved') throw new Error('Brak zapisu.');
    expect(saved.tick).toBe(17);
    expect(saved.pop).toBe(at17.pool.n);
    const raw = await gunzip(saved.bytes);
    expect(readHeader(raw).tick).toBe(17);
    expect(stateHash(deserializeWorld(raw))).toBe(stateHash(at17));
    send({ t: 'historicalWorld', tick: 53, req: 13 });
    const state = response(13);
    if (state.t !== 'historyBytes') throw new Error('Brak stanu.');
    const live = deserializeWorld(state.bytes);
    expect(stateHash(live)).toBe(stateHash(original));
    expect(live.commandLog).toEqual(original.commandLog);
    send({ t: 'historySeek', tick: -1, req: 14 });
    expect(response(14)).toMatchObject({ t: 'error', req: 14 });
  });

  it('atlas/okaz używają podglądu, anulowanie próby odpowiada na request, archiwum można wczytać', async () => {
    const original = smallWorld(921), history = new WorldHistory(original, { interval: 40 });
    history.run(17); const id = original.pool.id[0]; history.run(50);
    send({ t: 'loadHistory', bytes: history.serializeArchive(), req: 20 });
    expect(response(20)).toMatchObject({ t: 'history', info: { minTick: 0, maxTick: 67 } });
    send({ t: 'historySeek', tick: 17, req: 21 });
    send({ t: 'atlas', req: 22 });
    expect(response(22)).toMatchObject({ t: 'atlas', atlas: { tick: 17 } });
    send({ t: 'captureSpecimen', id, req: 23 });
    const capture = response(23);
    if (capture.t !== 'specimen') throw new Error('Brak okazu.');
    expect(capture.specimen.sourceTick).toBe(17);
    send({ t: 'lab', req: 24, request: { mode: 'memory', specimenA: capture.specimen, seeds: [1, 2], ticks: 100, environments: [] } });
    expect(response(24)).toMatchObject({ t: 'labProgress', req: 24 });
    send({ t: 'cancelLab', req: 24 });
    await vi.advanceTimersByTimeAsync(1);
    expect(messages.find(m => m.t === 'error' && m.req === 24)).toMatchObject({ code: 'cancelled' });
    send({ t: 'captureSpecimen', id: Number.MAX_SAFE_INTEGER, req: 25 });
    expect(response(25)).toMatchObject({ t: 'error', req: 25 });
    send({ t: 'historyLive', req: 26 });
    send({ t: 'historicalWorld', tick: 67, req: 27 });
    const bytes = response(27);
    if (bytes.t !== 'historyBytes') throw new Error('Brak stanu.');
    expect(stateHash(deserializeWorld(bytes.bytes))).toBe(stateHash(history.live));
  });
  it('reset pozwala natychmiast zacząć nową próbę; anulowanie starej nie anuluje nowej', async () => {
    const original = smallWorld(922);
    send({ t: 'load', bytes: serializeWorld(original) });
    send({ t: 'captureSpecimen', id: original.pool.id[0], req: 30 });
    const capture = response(30);
    if (capture.t !== 'specimen') throw new Error('Brak okazu.');
    const request = { mode: 'memory' as const, specimenA: capture.specimen, seeds: [1, 2], ticks: 100, environments: [] };
    send({ t: 'lab', req: 31, request });
    send({ t: 'init', setup: { width: 400, height: 400, capacity: 1500, initialPopulation: 150 }, params: {} });
    send({ t: 'lab', req: 32, request });
    await vi.advanceTimersByTimeAsync(1);
    expect(messages.find(m => m.t === 'error' && m.req === 31)).toMatchObject({ code: 'cancelled' });
    expect(messages.find(m => m.t === 'lab' && m.req === 32)).toMatchObject({ result: { mode: 'memory' } });
    expect(messages.find(m => m.t === 'error' && m.req === 32)).toBeUndefined();
  });

});
