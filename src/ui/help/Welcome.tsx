import { useState } from 'react';
import { Help } from './Help';

const KEY = 'genesis.welcome.v1';

export function shouldShowWelcome(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'seen';
  } catch {
    return true;
  }
}

function remember(): void {
  try {
    localStorage.setItem(KEY, 'seen');
  } catch {
    /* tryb prywatny / zablokowane dane witryny — nic się nie dzieje */
  }
}

/** Ekran powitalny: 3 rzeczy, które warto wiedzieć na starcie. Można go otworzyć ponownie przyciskiem „Nauka”. */
export function Welcome({ onClose, onLessons }: { onClose: () => void; onLessons: () => void }) {
  const [never, setNever] = useState(true);
  const close = (lessons: boolean) => {
    if (never) remember();
    onClose();
    if (lessons) onLessons();
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Witaj w GENESIS" onClick={() => close(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Witaj w GENESIS</h2>
        <p className="lead">
          Laboratorium <b>sztucznego życia</b>. Małe organizmy z genomami i miniaturowymi mózgami żyją w świecie z ograniczoną energią. Nikt ich nie steruje — przeżywają i mnożą się te, którym się uda,
          a ty obserwujesz, jakie strategie z tego wyewoluują.
        </p>
        <div className="modal-cols">
          <div>
            <h3>1 · Patrz</h3>
            <p>Kropki to organizmy. Zielone plamy to pokarm. Kliknij dowolną kropkę, a otworzy się jej karta: geny, mózg, rodowód.</p>
          </div>
          <div>
            <h3>2 · Ingeruj</h3>
            <p>W lewym panelu zmieniasz prawa świata na żywo i wywołujesz susze czy katastrofy. Każda zmiana jest zapisywana, więc eksperyment da się powtórzyć.</p>
          </div>
          <div>
            <h3>3 · Pytaj</h3>
            <p>
              Znak <Help id="ui.learn" /> jest przy prawie wszystkim. Najedź — skrót; kliknij — pełny opis z ciekawostką. Zakładka <b>Nauka</b> ma lekcje i słownik.
            </p>
          </div>
        </div>
        <label className="never">
          <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} /> Nie pokazuj tego okna przy następnych wizytach
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={() => close(false)}>
            Zaczynam
          </button>
          <button className="btn primary" onClick={() => close(true)}>
            Pokaż lekcje →
          </button>
        </div>
      </div>
    </div>
  );
}
