import { useEffect, useMemo, useRef, useState } from 'react';
import { ROLES, CATEGORIES, roleInfo, type Category } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { show, searchText } from '../catalog/packs.ts';
import { ROLE_MIME } from '../canvas/Canvas.tsx';
import { Icon, ProductIcon } from './Icon.tsx';

const CATEGORY_NAMES: Record<Category, string> = {
  client: 'Clients', network: 'Network', compute: 'Compute', storage: 'Storage', database: 'Databases', messaging: 'Messaging', observe: 'Observability', security: 'Security',
};
export const PALETTE_SEARCH_ID = 'palette-search';
/** Ask the palette to open (on narrow screens it is a rail) and put the cursor in its search field. */
export const findService = () => window.dispatchEvent(new Event('archboard:find'));

/**
 * The services palette, grouped by category. Search reads every pack: "s3", "minio" and "bucket" all find Object storage.
 * Click (or Enter) adds a block in the middle of the view; dragging an item onto the canvas drops it where it lands.
 */
export function Palette() {
  const pack = useEditor((s) => s.pack);
  const add = useEditor((s) => s.add);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Focus the search field once the palette has rendered open (on a rail it is hidden until then). An effect, not a
  // requestAnimationFrame: animation frames do not run in a background or unfocused page.
  const [focusAsk, setFocusAsk] = useState(0);
  useEffect(() => {
    const onFind = () => { setOpen(true); setFocusAsk((n) => n + 1); };
    window.addEventListener('archboard:find', onFind);
    return () => window.removeEventListener('archboard:find', onFind);
  }, []);
  useEffect(() => { if (focusAsk) input.current?.focus(); }, [focusAsk]);
  const addAndClose = (role: string) => { add(role); setOpen(false); setQ(''); };
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ids = Object.keys(ROLES).filter((id) => id !== 'custom' && (!needle || searchText(id).includes(needle)));
    return CATEGORIES.map((c) => [c, ids.filter((id) => roleInfo(id).category === c)] as const).filter(([, list]) => list.length);
  }, [q]);
  const first = groups[0]?.[1][0];

  return (
    <aside
      className={`side side--l${open ? ' open' : ''}`}
      aria-label="Services"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <div className="side-head">
        <div className="search">
          <Icon name="search" />
          <input
            ref={input}
            id={PALETTE_SEARCH_ID}
            className="input"
            type="search"
            placeholder="Search services"
            aria-label="Search services"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && first) addAndClose(first);
              if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
            }}
          />
        </div>
        <button className="btn btn--icon search-btn" type="button" aria-label="Search services" onClick={findService}>
          <Icon name="search" />
        </button>
      </div>
      <div className="side-body">
        {groups.length === 0 && <p className="empty">No service matches "{q}". Try a product name such as "postgres" or "s3".</p>}
        {groups.map(([cat, ids]) => (
          <section key={cat} aria-label={CATEGORY_NAMES[cat]}>
            <div className="cat-title"><span>{CATEGORY_NAMES[cat]}</span><span>{ids.length}</span></div>
            {ids.map((id) => {
              const s = show(id, pack);
              return (
                <button
                  key={id}
                  type="button"
                  className="pal-item"
                  title={`Add ${roleInfo(id).name}`}
                  aria-label={`Add ${roleInfo(id).name}${pack !== 'generic' ? ` (${s.name})` : ''}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData(ROLE_MIME, id); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => addAndClose(id)}
                >
                  <ProductIcon s={s} />
                  <span className="pal-text"><b>{roleInfo(id).name}</b><small>{pack === 'generic' ? '' : s.name}</small></span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
