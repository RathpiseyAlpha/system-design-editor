import { roleInfo } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { PACKS, show, zoneLabel, ossProducts } from '../catalog/packs.ts';
import { Icon, ProductIcon } from './Icon.tsx';

/** Details of the selected block, editable; the diagram's summary when nothing is selected. */
export function Inspector() {
  const d = useEditor((s) => s.diagram);
  const pack = useEditor((s) => s.pack);
  const selected = useEditor((s) => s.selected);
  const update = useEditor((s) => s.update);
  const remove = useEditor((s) => s.remove);
  const n = d.nodes.find((x) => x.id === selected);

  if (!n) {
    return (
      <aside className="side side--r" aria-label="Details">
        <div className="insp">
          <div><b className="insp-title">{d.title}</b><small className="muted">{d.nodes.length} blocks, {d.edges.length} connections, {d.zones.length} zones</small></div>
          <p className="empty">Select a block to rename it, choose its product and see how it is connected. Add blocks from the list on the left, by click or by dragging them onto the canvas.</p>
        </div>
      </aside>
    );
  }

  const r = roleInfo(n.role);
  const zone = d.zones.find((z) => z.id === n.zone);
  const label = (id: string) => d.nodes.find((x) => x.id === id)?.label ?? id;
  const links = d.edges.filter((e) => e.from === n.id || e.to === n.id);
  const oss = ossProducts(n.role);

  return (
    <aside className="side side--r" aria-label="Details">
      <div className="insp">
        <div className="insp-head">
          <ProductIcon s={show(n.role, pack, n.product, n.icon)} large />
          <span><b>{n.label}</b><small>{r.name}</small></span>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="insp-name">Name</label>
          <input id="insp-name" className="input" value={n.label} maxLength={60} onChange={(e) => update(n.id, { label: e.target.value }, `label:${n.id}`)} />
        </div>
        <div className="field">
          <span className="lbl">Shown as</span>
          <div className="products">
            {PACKS.map((p) => {
              const v = show(n.role, p.id, n.product, n.icon);
              return (
                <div key={p.id} className={p.id === pack ? 'on' : ''}>
                  <ProductIcon s={v} />
                  <span><small>{p.name}</small><b>{v.name}</b></span>
                  {v.licence ? <small className="muted">{v.licence}</small> : <span />}
                </div>
              );
            })}
          </div>
        </div>
        {oss.length > 1 && (
          <div className="field">
            <label className="lbl" htmlFor="insp-oss">Open-source product</label>
            <select id="insp-oss" className="input select" value={n.product?.oss ?? oss[0]!.id} onChange={(e) => update(n.id, { product: { ...n.product, oss: e.target.value } })}>
              {oss.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.licence})</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <span className="lbl">Zone</span>
          <span className="value">{zone ? `${zone.label} (${zoneLabel(zone.kind, zone.access, pack).kind})` : 'None. Drag the block into a zone to put it there.'}</span>
        </div>
        <div className="field">
          <span className="lbl">Connections</span>
          {links.length === 0 ? (
            <span className="value muted">None yet</span>
          ) : (
            <ul className="conn">
              {links.map((e) => (
                <li key={e.id}>
                  <Icon name="arrow" />
                  {e.from === n.id ? `to ${label(e.to)}` : `from ${label(e.from)}`}
                  <span>{e.label ?? e.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="field">
          <label className="lbl" htmlFor="insp-notes">Notes</label>
          <textarea id="insp-notes" className="input" rows={3} maxLength={500} value={n.notes ?? ''} onChange={(e) => update(n.id, { notes: e.target.value || undefined }, `notes:${n.id}`)} />
        </div>
        <button className="btn btn--danger" type="button" onClick={() => remove([n.id])}>Delete {n.label}</button>
      </div>
    </aside>
  );
}
