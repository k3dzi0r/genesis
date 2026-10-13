export type PresentationProfile = 'observe' | 'learn' | 'experiment';
export type ToolTab = 'stats' | 'org' | 'gen' | 'cmp' | 'log' | 'learn' | 'history' | 'atlas' | 'lab' | 'biomes';
export const TOOL_LABELS: [ToolTab,string][] = [['stats','Statystyki'],['org','Organizm'],['biomes','Biomy'],['log','Dziennik'],['learn','Nauka'],['history','Historia'],['atlas','Atlas'],['lab','Laboratorium'],['gen','Genealogia'],['cmp','Porównanie']];
export const PRESENTATION_PROFILES: { id: PresentationProfile; label: string; tabs: ToolTab[] }[] = [
  { id: 'observe', label: 'Obserwuj', tabs: ['stats','org','biomes','log','learn','history'] },
  { id: 'learn', label: 'Ucz się', tabs: ['stats','org','biomes','learn','history','atlas'] },
  { id: 'experiment', label: 'Eksperymentuj', tabs: TOOL_LABELS.map(([id])=>id) },
];
export interface Presentation { profile: PresentationProfile; tabs: ToolTab[] }
export function readPresentation(): Presentation {
  try {
    const value = JSON.parse(localStorage.getItem('genesis-presentation-v1') ?? 'null');
    if (value && PRESENTATION_PROFILES.some(p=>p.id===value.profile) && Array.isArray(value.tabs)) return { profile:value.profile, tabs:TOOL_LABELS.map(([id])=>id).filter(id=>value.tabs.includes(id) || id==='stats' || id==='org' || id==='learn') };
  } catch { /* preferences are optional */ }
  return { profile:'observe', tabs:[...PRESENTATION_PROFILES[0].tabs] };
}
export function PresentationPanel({ value, onChange }: { value: Presentation; onChange: (value: Presentation)=>void }) {
  return <div className="panel-body"><section className="card"><header><h4>Widok aplikacji</h4></header>
    <p className="note">To tylko widoczność narzędzi. Żadna mechanika świata nie zostaje wyłączona. Biologię zmieniasz w zakładce Moduły.</p>
    <div className="btn-grid">{PRESENTATION_PROFILES.map(p=><button className={`btn sm ${value.profile===p.id?'primary':''}`} key={p.id} onClick={()=>onChange({profile:p.id,tabs:[...p.tabs]})}>{p.label}</button>)}</div>
    <h5>Widoczne zakładki</h5>{TOOL_LABELS.map(([id,label])=><label className="presentation-tool" key={id}><input type="checkbox" checked={value.tabs.includes(id)} disabled={['stats','org','learn'].includes(id)} onChange={e=>onChange({...value,tabs:e.target.checked?[...value.tabs,id]:value.tabs.filter(x=>x!==id)})}/>{label}</label>)}
    <p className="note">Preferencje pozostają na tym urządzeniu. Link z pomocy może odsłonić potrzebną zakładkę.</p>
  </section></div>;
}
