import { useMemo, useState } from 'react';
import { ROLES, CATEGORIES, roleInfo, type Category } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { show, searchText } from '../catalog/packs.ts';
import { Icon, ProductIcon } from './Icon.tsx';

const CATEGORY_NAMES: Record<Category, string> = {
  client: 'Clients', network: 'Network', compute: 'Compute', storage: 'Storage', database: 'Databases', messaging: 'Messaging', observe: 'Observability', security: 'Security',
};

/** The services palette, grouped by category. Search reads every pack: "s3", "minio" and "bucket" all find Object storage. */
export function Palette() {
  const pack = useEditor((s) => s.pack);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ids = Object.keys(ROLES).filter((id) => id !== 'custom' && (!needle || searchText(id).includes(needle)));
    return CATEGORIES.map((c) => [c, ids.filter((id) => roleInfo(id).category === c)] as const).filter(([, list]) => list.length);
  }, [q]);

  return (
    <aside className="side side--l" aria-label="Services">
      <div className="side-head">
        <div className="search">
          <Icon name="search" />
          <input className="input" type="search" placeholder="Search services" aria-label="Search services" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn--icon search-btn" type="button" aria-label="Search services"><Icon name="search" /></button>
      </div>
      <div className="side-body">
        {groups.length === 0 && <p className="empty">No service matches "{q}". Try a product name such as "postgres" or "s3".</p>}
        {groups.map(([cat, ids]) => (
          <section key={cat}>
            <div className="cat-title"><span>{CATEGORY_NAMES[cat]}</span><span>{ids.length}</span></div>
            {ids.map((id) => {
              const s = show(id, pack);
              return (
                <div key={id} className="pal-item" title={roleInfo(id).name}>
                  <ProductIcon s={s} />
                  <span className="pal-text"><b>{roleInfo(id).name}</b><small>{pack === 'generic' ? '' : s.name}</small></span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
