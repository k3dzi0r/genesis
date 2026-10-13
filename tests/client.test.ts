import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldClient } from '../src/ui/client';
import type { FromWorker, ToWorker } from '../src/worker/protocol';
import type { LabRequest } from '../src/engine/lab';

class FakeWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: ToWorker[] = [];
  postMessage(message: ToWorker): void { this.messages.push(message); }
  terminate(): void {}
  deliver(message: FromWorker): void { this.onmessage?.({ data: message } as MessageEvent<FromWorker>); }
  req(): number { return (this.messages.at(-1) as { req: number }).req; }
}
beforeEach(() => { vi.stubGlobal('Worker', FakeWorker); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const client = () => new WorldClient('test', 'Test', () => {});
const fake = (c: WorldClient) => c.worker as unknown as FakeWorker;

describe('żądania klienta workera', () => {
  it('zapis dla rozwidlenia kończy Promise i zachowuje bytes/tick z odpowiedzi', async () => {
    const c = client();
    const pending = c.save('fork', 'fork');
    const w = fake(c), bytes = new Uint8Array([1, 2, 3]);
    w.deliver({ t: 'saved', req: w.req(), reason: 'fork', label: 'fork', bytes, tick: 87, pop: 12, seed: 7, engine: '0.4.0' });
    await expect(pending).resolves.toMatchObject({ tick: 87, bytes });
    c.dispose();
  });
  it('błąd wskazanego żądania odrzuca Promise, pozostałe żądanie może się zakończyć', async () => {
    const c = client(), w = fake(c);
    const first = c.inspect(12); const id = w.req();
    const second = c.exportText('stats-csv'); const secondId = w.req();
    w.deliver({ t: 'error', req: id, message: 'Nie ma organizmu.' });
    await expect(first).rejects.toThrow('Nie ma organizmu.');
    w.deliver({ t: 'export', req: secondId, kind: 'stats-csv', text: 'tick,pop\n0,12' });
    await expect(second).resolves.toBe('tick,pop\n0,12');
    c.dispose();
  });
  it('awaria i zamknięcie workera odrzucają oczekujące żądania', async () => {
    const c = client(), w = fake(c);
    const request = c.historySeek(100);
    w.onerror?.({ message: 'Awaria workera' } as ErrorEvent);
    await expect(request).rejects.toThrow('Awaria workera');
    const request2 = c.historicalWorldBytes(1);
    c.dispose();
    await expect(request2).rejects.toThrow('zamknięty');
  });
  it('postęp i anulowanie laboratorium kończą żądanie bez trwałego błędu świata', async () => {
    const c = client(), w = fake(c), progress = vi.fn();
    const request = c.lab({ mode: 'memory' } as LabRequest, progress); const id = w.req();
    w.deliver({ t: 'labProgress', req: id, done: 1, total: 4 });
    expect(progress).toHaveBeenCalledWith(1, 4);
    c.cancelLab();
    expect(w.messages.at(-1)).toEqual({ t: 'cancelLab', req: id });
    w.deliver({ t: 'error', req: id, code: 'cancelled', message: 'Anulowano próbę laboratoryjną.' });
    await expect(request).rejects.toThrow('Anulowano');
    expect(c.error).toBeNull();
    const next = c.lab({ mode: 'memory' } as LabRequest, progress); const nextId = w.req();
    c.cancelLab();
    w.deliver({ t: 'error', req: nextId, code: 'cancelled', message: 'Anulowano.' });
    await expect(next).rejects.toThrow();
    c.dispose();
  });
  it('późne anulowanie starej próby po resecie nie usuwa nowego żądania', async () => {
    const c = client(), w = fake(c), progress = vi.fn();
    const old = c.lab({ mode: 'memory' } as LabRequest, progress); const oldId = w.req();
    c.init({}, {});
    await expect(old).rejects.toThrow('zresetowany');
    const current = c.lab({ mode: 'memory' } as LabRequest, progress); const currentId = w.req();
    w.deliver({ t: 'error', req: oldId, code: 'cancelled', message: 'Anulowano starą próbę.' });
    c.cancelLab();
    expect(w.messages.at(-1)).toEqual({ t: 'cancelLab', req: currentId });
    w.deliver({ t: 'error', req: currentId, code: 'cancelled', message: 'Anulowano nową próbę.' });
    await expect(current).rejects.toThrow('nową');
    c.dispose();
  });

});
