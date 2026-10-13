import { HELP } from '../help/content';
import { B1_OFF, B2_OFF, INPUT_LABELS, N_HID, N_IN, N_OUT, N_TRAITS, OUTPUT_LABELS, W1_OFF, W2_OFF } from '../../engine/constants';

interface Props {
  genome: Float32Array;
  inputs?: number[];
  hidden?: number[];
  outputs?: number[];
}

const X = [150, 290, 430];
const act = (v: number | undefined) => {
  if (v === undefined) return 'var(--panel2)';
  const a = Math.min(1, Math.abs(v));
  return v >= 0 ? `rgba(61,224,197,${0.15 + a * 0.85})` : `rgba(255,107,122,${0.15 + a * 0.85})`;
};

/** Schemat sieci: krawędzie = przekazane wagi (genom lub stan efektywny) (turkus + / czerwony −), węzły = bieżąca aktywacja. */
export function BrainDiagram({ genome, inputs, hidden, outputs }: Props) {
  const yIn = (i: number) => 14 + i * (378 / (N_IN - 1));
  const yHid = (h: number) => 30 + h * (340 / (N_HID - 1));
  const yOut = (o: number) => 34 + o * (312 / (N_OUT - 1));
  const edges: JSX.Element[] = [];
  for (let h = 0; h < N_HID; h++)
    for (let i = 0; i < N_IN; i++) {
      const w = genome[W1_OFF + h * N_IN + i];
      if (Math.abs(w) < 0.25) continue;
      edges.push(<line key={`a${h}-${i}`} x1={X[0]} y1={yIn(i)} x2={X[1]} y2={yHid(h)} stroke={w > 0 ? '#3de0c5' : '#ff6b7a'} strokeOpacity={Math.min(0.9, 0.12 + Math.abs(w) * 0.28)} strokeWidth={0.3 + Math.min(2, Math.abs(w)) * 0.7} />);
    }
  for (let o = 0; o < N_OUT; o++)
    for (let h = 0; h < N_HID; h++) {
      const w = genome[W2_OFF + o * N_HID + h];
      if (Math.abs(w) < 0.25) continue;
      edges.push(<line key={`b${o}-${h}`} x1={X[1]} y1={yHid(h)} x2={X[2]} y2={yOut(o)} stroke={w > 0 ? '#3de0c5' : '#ff6b7a'} strokeOpacity={Math.min(0.9, 0.12 + Math.abs(w) * 0.28)} strokeWidth={0.3 + Math.min(2, Math.abs(w)) * 0.7} />);
    }
  return (
    <svg viewBox="0 0 560 410" className="brain">
      {edges}
      {Array.from({ length: N_IN }, (_, i) => (
        <g key={`i${i}`}>
          <title>{HELP[`input.${i}`]?.short}</title><circle cx={X[0]} cy={yIn(i)} r={5} fill={act(inputs?.[i])} stroke="var(--line)" />
          <text x={X[0] - 10} y={yIn(i) + 3} textAnchor="end">
            {INPUT_LABELS[i]}
          </text>
        </g>
      ))}
      {Array.from({ length: N_HID }, (_, h) => (
        <circle key={`h${h}`} cx={X[1]} cy={yHid(h)} r={6} fill={act(hidden?.[h])} stroke="var(--line)">
          <title>{`bias ${genome[B1_OFF + h].toFixed(2)}`}</title>
        </circle>
      ))}
      {Array.from({ length: N_OUT }, (_, o) => (
        <g key={`o${o}`}>
          <circle cx={X[2]} cy={yOut(o)} r={7} fill={act(outputs?.[o])} stroke="var(--line)">
            <title>{`${HELP[`output.${o}`]?.short} Bias ${genome[B2_OFF + o].toFixed(2)}`}</title>
          </circle>
          <text x={X[2] + 12} y={yOut(o) + 3}>
            {OUTPUT_LABELS[o]}
            {outputs ? ` ${outputs[o].toFixed(2)}` : ''}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Pasek genomu: każda komórka = jeden gen (cechy, potem wagi); podświetla różnice względem `against`. */
export function GenomeStrip({ genome, against }: { genome: Float32Array; against?: Float32Array | null }) {
  const cells: JSX.Element[] = [];
  for (let g = 0; g < genome.length; g++) {
    const v = genome[g];
    const diff = against ? Math.abs(against[g] - v) > 1e-6 : false;
    let bg: string;
    if (g < N_TRAITS) bg = `hsl(190 60% ${15 + v * 55}%)`;
    else bg = v >= 0 ? `rgba(61,224,197,${Math.min(1, Math.abs(v) / 2.5)})` : `rgba(255,107,122,${Math.min(1, Math.abs(v) / 2.5)})`;
    cells.push(<i key={g} className={diff ? 'diff' : ''} style={{ background: bg }} title={`gen ${g}: ${v.toFixed(3)}`} />);
  }
  return <div className="strip">{cells}</div>;
}
