import { roleInfo, ZONE_KIND_IDS, type Diagram, type DEdge, type DNode, type DZone, type EdgeKind } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { PACKS, show, zoneLabel, ossProducts, type PackId } from '../catalog/packs.ts';
import { Icon, ProductIcon } from './Icon.tsx';

/** Details of what is selected (a block, a zone or a connection), editable; the diagram's summary when nothing is. */
export function Inspector() {
  const d = useEditor((s) => s.diagram);
  const pack = useEditor((s) => s.pack);
  const selected = useEditor((s) => s.selected);
  const node = d.nodes.find((x) => x.id === selected);
  const zone = d.zones.find((x) => x.id === selected);
  const edge = d.edges.find((x) => x.id === selected);
  return (
    <aside className="side side--r" aria-label="Details">
      <div className="insp">
        {node ? <NodeDetails d={d} n={node} pack={pack} /> : zone ? <ZoneDetails d={d} z={zone} pack={pack} /> : edge ? <EdgeDetails d={d} e={edge} /> : <Summary d={d} />}
      </div>
    </aside>
  );
}

function Summary({ d }: { d: Diagram }) {
  return (
    <>
      <div><b className="insp-title">{d.title}</b><small className="muted">{d.nodes.length} blocks, {d.edges.length} connections, {d.zones.length} zones</small></div>
      <p className="empty">
        Add blocks and zones from the list on the left, by click or by dragging them onto the canvas. Select a block to rename it or connect it;
        drag a zone by its name tab to move it with everything inside.
      </p>
      <div className="field">
        <span className="lbl">Notes</span>
        <small className="muted">{d.notes ? `${d.notes.trim().split(/\s+/).length} words in Markdown.` : 'None yet: say why the diagram looks like this.'}</small>
        <button className="btn btn--sm" type="button" onClick={() => { const s = useEditor.getState(); s.setSide('notes'); s.setLayout('split'); }}>
          <Icon name="note" />{d.notes ? 'Open notes' : 'Write notes'}
        </button>
      </div>
    </>
  );
}

function NodeDetails({ d, n, pack }: { d: Diagram; n: DNode; pack: PackId }) {
  const { update, remove, setConnectFrom, connectFrom } = useEditor.getState();
  const connecting = useEditor((s) => s.connectFrom === n.id);
  const r = roleInfo(n.role);
  const zone = d.zones.find((z) => z.id === n.zone);
  const label = (id: string) => d.nodes.find((x) => x.id === id)?.label ?? id;
  const links = d.edges.filter((e) => e.from === n.id || e.to === n.id);
  const oss = ossProducts(n.role);
  return (
    <>
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
        {links.length > 0 && (
          <ul className="conn">
            {links.map((e) => (
              <li key={e.id}>
                <button type="button" className="linklike" onClick={() => useEditor.getState().select(e.id)}>
                  <Icon name="arrow" />
                  {e.from === n.id ? `to ${label(e.to)}` : `from ${label(e.from)}`}
                </button>
                <span>{e.label ?? e.kind}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="btn" type="button" aria-pressed={connecting} onClick={() => setConnectFrom(connectFrom === n.id ? null : n.id)}>
          <Icon name="arrow" />{connecting ? 'Pick the other block…' : 'Connect to…'}
        </button>
        <small className="muted">Or drag from an orange port on the selected block to another block.</small>
      </div>
      <div className="field">
        <label className="lbl" htmlFor="insp-notes">Notes</label>
        <textarea id="insp-notes" className="input" rows={3} maxLength={500} value={n.notes ?? ''} onChange={(e) => update(n.id, { notes: e.target.value || undefined }, `notes:${n.id}`)} />
      </div>
      <button className="btn btn--danger" type="button" onClick={() => remove([n.id])}>Delete {n.label}</button>
    </>
  );
}

const KIND_NAMES: Record<string, string> = { region: 'Region', network: 'Network', zone: 'Failure zone', subnet: 'Subnet', group: 'Group' };

function ZoneDetails({ d, z, pack }: { d: Diagram; z: DZone; pack: PackId }) {
  const { updateZone, remove } = useEditor.getState();
  const blocks = d.nodes.filter((n) => n.zone === z.id).length;
  const inner = d.zones.filter((o) => o.parent === z.id).length;
  const parent = d.zones.find((o) => o.id === z.parent);
  return (
    <>
      <div className="insp-head">
        <span className="ico ico--lg zone-ico"><Icon name={z.kind === 'subnet' ? (z.access === 'public' ? 'split' : 'lock') : z.kind === 'region' ? 'globe' : z.kind === 'zone' ? 'shield' : z.kind === 'group' ? 'flat' : 'layout'} /></span>
        <span><b>{z.label}</b><small>{zoneLabel(z.kind, z.access, pack).kind}</small></span>
      </div>
      <div className="field">
        <label className="lbl" htmlFor="insp-zname">Name</label>
        <input id="insp-zname" className="input" value={z.label} maxLength={60} onChange={(e) => updateZone(z.id, { label: e.target.value }, `zlabel:${z.id}`)} />
      </div>
      <div className="field">
        <label className="lbl" htmlFor="insp-zkind">Kind</label>
        <select id="insp-zkind" className="input select" value={z.kind} onChange={(e) => updateZone(z.id, { kind: e.target.value as DZone['kind'] })}>
          {ZONE_KIND_IDS.map((k) => <option key={k} value={k}>{KIND_NAMES[k]}{pack === 'aws' && zoneLabel(k, 'private', 'aws').kind !== KIND_NAMES[k] && k !== 'subnet' ? ` (AWS: ${zoneLabel(k, 'private', 'aws').kind})` : ''}</option>)}
        </select>
      </div>
      {z.kind === 'subnet' && (
        <div className="field">
          <span className="lbl">Access</span>
          <div className="seg" role="group" aria-label="Access">
            <button type="button" aria-pressed={z.access === 'public'} onClick={() => updateZone(z.id, { access: 'public' })}>Public</button>
            <button type="button" aria-pressed={z.access !== 'public'} onClick={() => updateZone(z.id, { access: 'private' })}>Private</button>
          </div>
        </div>
      )}
      <div className="field">
        <span className="lbl">Holds</span>
        <span className="value">{blocks} blocks{inner ? `, ${inner} zones` : ''}{parent ? `, inside ${parent.label}` : ''}</span>
        <small className="muted">Drag the name tab to move it with everything inside; drag the corner handle to resize.</small>
      </div>
      <button className="btn btn--danger" type="button" onClick={() => remove([z.id])}>Delete zone {z.label}</button>
      <small className="muted">Its blocks stay where they are.</small>
    </>
  );
}

const EDGE_KINDS: { id: EdgeKind; name: string; hint: string }[] = [
  { id: 'request', name: 'Request', hint: 'waits for an answer (HTTP, SQL)' },
  { id: 'async', name: 'Async', hint: 'through a queue or topic' },
  { id: 'data', name: 'Data', hint: 'replication, backup, sync' },
];

function EdgeDetails({ d, e }: { d: Diagram; e: DEdge }) {
  const { updateEdge, remove, select } = useEditor.getState();
  const name = (id: string) => d.nodes.find((x) => x.id === id)?.label ?? id;
  return (
    <>
      <div className="insp-head">
        <span className="ico ico--lg zone-ico"><Icon name="arrow" /></span>
        <span><b>{name(e.from)} → {name(e.to)}</b><small>Connection</small></span>
      </div>
      <div className="field">
        <span className="lbl">Kind</span>
        <div className="seg" role="group" aria-label="Connection kind">
          {EDGE_KINDS.map((k) => <button key={k.id} type="button" aria-pressed={e.kind === k.id} title={k.hint} onClick={() => updateEdge(e.id, { kind: k.id })}>{k.name}</button>)}
        </div>
        <small className="muted">{EDGE_KINDS.find((k) => k.id === e.kind)?.hint}</small>
      </div>
      <div className="field">
        <label className="lbl" htmlFor="insp-elabel">Label</label>
        <input id="insp-elabel" className="input" placeholder="For example HTTPS or SQL" value={e.label ?? ''} maxLength={60} onChange={(ev) => updateEdge(e.id, { label: ev.target.value }, `elabel:${e.id}`)} />
      </div>
      <div className="field">
        <span className="lbl">Ends</span>
        <span className="row-btns">
          <button className="btn" type="button" onClick={() => select(e.from)}>{name(e.from)}</button>
          <button className="btn" type="button" onClick={() => select(e.to)}>{name(e.to)}</button>
        </span>
      </div>
      <button className="btn btn--danger" type="button" onClick={() => remove([e.id])}>Delete connection</button>
    </>
  );
}
