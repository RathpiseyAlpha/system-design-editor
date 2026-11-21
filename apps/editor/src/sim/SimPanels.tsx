// Simulate mode's panels (design page, Screen E): the scenario on the left, the run bar under the canvas, the results on
// the right, and a selected block's capacity settings above the results. Every number shown comes from the engine's run.
import { useEffect, useRef, type ReactNode } from 'react';
import { defaultsFor, roleInfo, type DNode } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { Icon } from '../ui/Icon.tsx';
import { useSim, type Speed } from './store.ts';
import { clock, describeEvent, parseClock, targets, type ScenarioConfig } from './scenario.ts';

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

// ---------------------------------------------------------------- small fields

function Num({ label, value, onChange, min = 0, max = 1_000_000, step = 1, width = 70 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: number }) {
  return <input className="input" type="number" aria-label={label} value={value} min={min} max={max} step={step} style={{ width }}
    onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v); }} />;
}
function Time({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <input className="input" aria-label={label} defaultValue={clock(value)} key={value} style={{ width: 56 }}
    onBlur={(e) => { const v = parseClock(e.target.value); if (v !== null && v <= 3600) onChange(v); else e.target.value = clock(value); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}
function Pick({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select className="input select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{options.length ? 'Pick…' : 'None in the diagram'}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

function Preset({ title, desc, on, toggle, children }: { title: string; desc: string; on: boolean; toggle: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className={`scn${on ? ' on' : ''}`}>
      <label className="scn-pick"><input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /><b>{title}</b></label>
      <small>{desc}</small>
      {on && children && <span className="fields">{children}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- scenario

export function ScenarioPanel() {
  const d = useEditor((s) => s.diagram);
  const { config: c, custom, errors } = useSim();
  const set = useSim((s) => s.setConfig);
  const t = targets(d);
  const up = <K extends keyof ScenarioConfig>(k: K, patch: Partial<ScenarioConfig[K]>) => set((cfg) => ({ ...cfg, [k]: { ...(cfg[k] as object), ...patch } }));
  const opt = (xs: { id: string; label: string }[]) => xs.map((x) => ({ id: x.id, label: x.label }));
  const edgeOpts = t.edges.map((e) => ({ id: e.id, label: `${d.nodes.find((n) => n.id === e.from)?.label ?? e.from} > ${d.nodes.find((n) => n.id === e.to)?.label ?? e.to}` }));
  return (
    <aside className="side side--scn" aria-label="Scenario">
      <div className="panel-head">
        <h3>Scenario</h3>
        <label className="dur">Length <Time label="Scenario length" value={c.duration} onChange={(v) => set((cfg) => ({ ...cfg, duration: Math.max(10, v) }))} /></label>
      </div>
      {custom ? (
        <div className="scn-file">
          <p>From a file: <b>{custom.title}</b>, {clock(custom.duration)}, {custom.events.length} events.</p>
          <button className="btn btn--sm" type="button" onClick={() => useSim.getState().setCustom(null)}>Use the presets</button>
        </div>
      ) : (
        <div className="scn-list">
          <Preset title="Steady load" desc="Requests per second, all the time" on={c.steady.on} toggle={(on) => set((cfg) => ({ ...cfg, steady: { ...cfg.steady, on }, spike: { ...cfg.spike, on: on ? false : cfg.spike.on } }))}>
            <Num label="Requests per second" value={c.steady.rps} onChange={(rps) => up('steady', { rps })} />req/s
          </Preset>
          <Preset title="Traffic spike" desc="Load jumps, then stays (instead of steady load)" on={c.spike.on} toggle={(on) => set((cfg) => ({ ...cfg, spike: { ...cfg.spike, on }, steady: { ...cfg.steady, on: on ? false : cfg.steady.on } }))}>
            <Num label="From requests per second" value={c.spike.from} onChange={(from) => up('spike', { from })} />to
            <Num label="To requests per second" value={c.spike.to} onChange={(to) => up('spike', { to })} />req/s at
            <Time label="Spike at" value={c.spike.at} onChange={(at) => up('spike', { at })} />
          </Preset>
          <Preset title="Block fails" desc="One block switches off" on={c.blockFail.on} toggle={(on) => up('blockFail', { on })}>
            <Pick label="Block" value={c.blockFail.node} options={opt(t.blocks)} onChange={(node) => up('blockFail', { node })} />at
            <Time label="Fails at" value={c.blockFail.at} onChange={(at) => up('blockFail', { at })} />
          </Preset>
          <Preset title="Zone goes down" desc="Every block inside it switches off" on={c.zoneDown.on} toggle={(on) => up('zoneDown', { on })}>
            <Pick label="Zone" value={c.zoneDown.zone} options={opt(t.zones)} onChange={(zone) => up('zoneDown', { zone })} />at
            <Time label="Down at" value={c.zoneDown.at} onChange={(at) => up('zoneDown', { at })} />
          </Preset>
          <Preset title="Region goes down" desc="A whole region switches off" on={c.regionDown.on} toggle={(on) => up('regionDown', { on })}>
            <Pick label="Region" value={c.regionDown.zone} options={opt(t.regions)} onChange={(zone) => up('regionDown', { zone })} />at
            <Time label="Region down at" value={c.regionDown.at} onChange={(at) => up('regionDown', { at })} />
          </Preset>
          <Preset title="Slow database" desc="Slower and less capacity" on={c.slowDb.on} toggle={(on) => up('slowDb', { on })}>
            <Pick label="Database" value={c.slowDb.node} options={opt(t.databases)} onChange={(node) => up('slowDb', { node })} />
            <Num label="Latency factor" value={c.slowDb.latency} min={0.1} max={100} step={0.5} width={56} onChange={(latency) => up('slowDb', { latency })} />× slower,
            <Num label="Capacity factor" value={c.slowDb.capacity} min={0} max={1} step={0.1} width={56} onChange={(capacity) => up('slowDb', { capacity })} />× capacity at
            <Time label="Slow from" value={c.slowDb.at} onChange={(at) => up('slowDb', { at })} />
          </Preset>
          <Preset title="Cache misses" desc="Hit rate drops" on={c.cacheMiss.on} toggle={(on) => up('cacheMiss', { on })}>
            <Pick label="Cache" value={c.cacheMiss.node} options={opt(t.caches)} onChange={(node) => up('cacheMiss', { node })} />hit rate
            <Num label="Hit rate" value={c.cacheMiss.value} min={0} max={1} step={0.1} width={56} onChange={(value) => up('cacheMiss', { value })} />at
            <Time label="Misses from" value={c.cacheMiss.at} onChange={(at) => up('cacheMiss', { at })} />
          </Preset>
          <Preset title="Queue backlog" desc="Consumers fall behind" on={c.backlog.on} toggle={(on) => up('backlog', { on })}>
            <Pick label="Queue" value={c.backlog.node} options={opt(t.queues)} onChange={(node) => up('backlog', { node })} />consumers at
            <Num label="Consumer speed" value={c.backlog.consumers} min={0} max={1} step={0.1} width={56} onChange={(consumers) => up('backlog', { consumers })} />× from
            <Time label="Backlog from" value={c.backlog.at} onChange={(at) => up('backlog', { at })} />
          </Preset>
          <Preset title="Link cut" desc="One connection stops" on={c.linkCut.on} toggle={(on) => up('linkCut', { on })}>
            <Pick label="Connection" value={c.linkCut.edge} options={edgeOpts} onChange={(edge) => up('linkCut', { edge })} />at
            <Time label="Cut at" value={c.linkCut.at} onChange={(at) => up('linkCut', { at })} />
          </Preset>
        </div>
      )}
      {errors && <div className="scn-errors" role="alert">{errors.map((e, i) => <p key={i}><Icon name="alert" />{e}</p>)}</div>}
      {!custom && (
        <div className="expect">Handles it when errors stay under
          <Num label="Error rate limit in percent" value={c.expect.errorPct} min={0} max={100} step={0.5} width={54} onChange={(errorPct) => set((cfg) => ({ ...cfg, expect: { ...cfg.expect, errorPct } }))} />% and p95 under
          <Num label="p95 limit in milliseconds" value={c.expect.p95} min={1} max={600000} width={64} onChange={(p95) => set((cfg) => ({ ...cfg, expect: { ...cfg.expect, p95 } }))} />ms
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- run bar

export function RunBar() {
  const { result, running, playing, speed, at, ran } = useSim();
  const diagram = useEditor((s) => s.diagram);
  const stale = !!ran && ran.diagram !== diagram;
  const n = result?.ticks.length ?? 0;
  // Playing moves through the computed ticks: speed simulated seconds per real second.
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0, acc = 0;
    const loop = (now: number) => {
      const s = useSim.getState();
      if (!s.playing || !s.result) return;
      if (last.current !== null) acc += ((now - last.current) / 1000) * s.speed;
      last.current = now;
      if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        const end = s.result.ticks.length - 1;
        const next = Math.min(end, s.at + step);
        useSim.setState({ at: next, playing: next < end });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const sim = useSim.getState();
  const primary = running ? 'Running…' : !result || stale ? 'Run' : playing ? 'Pause' : 'Play';
  const onPrimary = () => {
    if (!result || stale) void sim.run(useEditor.getState().diagram);
    else sim.play(!playing);
  };
  const marks = ran ? ran.scenario.events.map((e) => ({ at: e.at, text: describeEvent(e, ran.diagram), bad: e.type === 'fail' || e.type === 'cut' })) : [];
  const dur = ran?.scenario.duration ?? 1;
  return (
    <div className="runbar" role="group" aria-label="Run">
      <button className="btn btn--primary" type="button" disabled={running} onClick={onPrimary}><Icon name={playing ? 'pause' : 'play'} />{primary}</button>
      <button className="btn btn--icon btn--ghost" type="button" aria-label="Back to the start" title="Back to the start" disabled={!result} onClick={() => sim.reset()}><Icon name="back" /></button>
      <div className="seg" role="group" aria-label="Speed">
        {([1, 10, 60] as Speed[]).map((v) => <button key={v} type="button" aria-pressed={speed === v} onClick={() => sim.setSpeed(v)}>×{v}</button>)}
      </div>
      <div className="timeline">
        <span className="track" />
        <span className="done" style={{ width: `${(at / Math.max(1, dur - 1)) * 100}%` }} />
        {marks.map((m, i) => <span key={i} className={`mark${m.bad ? ' bad' : ''}`} style={{ left: `${(m.at / dur) * 100}%` }} title={`${clock(m.at)} ${m.text}`} />)}
        <span className="thumb" style={{ left: `${(at / Math.max(1, dur - 1)) * 100}%` }} />
        <input type="range" aria-label="Scenario time" min={0} max={Math.max(0, n - 1)} value={at} disabled={!result}
          aria-valuetext={`${clock(at)} of ${clock(dur)}`} onChange={(e) => { sim.play(false); sim.seek(Number(e.target.value)); }} />
      </div>
      <span className="clock">{clock(at)} / {clock(ran?.scenario.duration ?? useSim.getState().config.duration)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- results

export function ResultsPanel() {
  const { result, ran, at } = useSim();
  const diagram = useEditor((s) => s.diagram);
  const selected = useEditor((s) => s.selected);
  const node = diagram.nodes.find((x) => x.id === selected);
  const label = (idn: string) => diagram.nodes.find((x) => x.id === idn)?.label ?? diagram.zones.find((z) => z.id === idn)?.label ?? idn;
  const body = (() => {
    if (!result || !ran) return <p className="sim-empty">Tick the problems to try on the left, then press <b>Run</b>. The blocks fill with their load, and the verdict appears here.</p>;
    const s = result.summary, t = result.ticks[at]!, sc = ran.scenario;
    const maxErr = sc.expect.errorRate ?? 0.01, maxP95 = sc.expect.p95 ?? 1000;
    const broke = result.ticks.find((x) => x.errorRate >= maxErr || x.p95 >= maxP95);
    const queues = Object.entries(t.nodes).filter(([, v]) => v.queue !== undefined).sort((a, b) => (b[1].queue ?? 0) - (a[1].queue ?? 0));
    const busiest = Object.entries(t.nodes).filter(([, v]) => !v.failed).sort((a, b) => b[1].util - a[1].util)[0];
    const handles = s.verdict === 'handles';
    return (
      <>
        <div className={`verdict${handles ? ' ok' : ''}`}>
          <span className="row" style={{ gap: 8 }}>
            {handles ? <span className="chip chip--ok"><Icon name="check" />Handles it</span> : <span className="chip chip--bad"><Icon name="x" />Breaks</span>}
            <b className="mono">{handles ? `p95 ${n0(s.p95)} ms, ${pct(s.errorRate)} errors` : broke ? `from ${clock(broke.t)}` : ''}</b>
          </span>
          {handles ? (
            <p>Every problem in the scenario is handled.{busiest ? ` Busiest block now: ${label(busiest[0])} at ${Math.round(busiest[1].util * 100)}%.` : ''}</p>
          ) : (
            <>
              <p>{pct(s.errorRate)} of requests fail over the run{s.p95 >= maxP95 ? `, and p95 is ${n0(s.p95)} ms` : ''}.</p>
              {s.bottleneck && <p><b>Bottleneck:</b> {label(s.bottleneck.node)} at {Math.round(s.bottleneck.peakUtil * 100)}% of its capacity.</p>}
              {s.spofs.length > 0 && <p><b>Single point of failure:</b> {s.spofs.slice(0, 3).map((f) => label(f.id)).join(', ')}{s.spofs.length > 3 ? ` and ${s.spofs.length - 3} more` : ''}.</p>}
              {s.growingQueues.length > 0 && <p><b>Growing queue:</b> {s.growingQueues.map(label).join(', ')}.</p>}
            </>
          )}
          <span className="hint">{s.hints[0] ? `Hint: ${s.hints[0]}` : handles ? 'Next: tick another problem to find what breaks.' : ''}</span>
        </div>
        <h3 className="sim-h">At {clock(at)}</h3>
        <div className="tiles">
          <div className="tile"><small>Throughput</small><b>{n0(t.served)}</b> <span>of {n0(t.offered)} req/s</span></div>
          <div className="tile"><small>Error rate</small><b>{pct(t.errorRate)}</b></div>
          <div className="tile"><small>p95 latency</small><b>{t.served > 0 ? `${n0(t.p95)} ms` : 'none'}</b> <span>target {n0(maxP95)}</span></div>
          <div className="tile"><small>Longest queue</small><b>{queues[0] ? n0(queues[0][1].queue ?? 0) : 'none'}</b> <span>{queues[0] ? label(queues[0][0]) : 'no queues'}</span></div>
          <div className="tile wide">
            <span><small>Users served</small><span>{pct(1 - t.errorRate)} of requests succeed</span></span>
            {t.errorRate < maxErr ? <span className="chip chip--ok"><Icon name="check" />Yes</span> : <span className="chip chip--bad"><Icon name="x" />No</span>}
          </div>
        </div>
        <div>
          <h3 className="sim-h">What happened</h3>
          <ul className="events">
            {[
              { at: 0, text: `${n0(result.ticks[0]!.offered)} req/s offered.` },
              ...sc.events.map((e) => ({ at: e.at, text: describeEvent(e, ran.diagram) })),
              ...(broke ? [{ at: broke.t + 0.5, text: `It breaks: ${n0(broke.served)} of ${n0(broke.offered)} req/s served${broke.p95 >= maxP95 ? `, p95 ${n0(broke.p95)} ms` : ''}.` }] : []),
            ].sort((a, b) => a.at - b.at).map((x, i) => <li key={i}><time>{clock(Math.floor(x.at))}</time><span>{x.text}</span></li>)}
          </ul>
        </div>
      </>
    );
  })();
  const stale = !!ran && ran.diagram !== diagram;
  return (
    <aside className="side side--r sim-results" aria-label="Results" tabIndex={0} data-summary={result ? JSON.stringify(result.summary) : undefined}
      data-trace={result ? result.ticks.map((x) => `${x.served}/${x.p95}`).join(' ') : undefined}>
      <div className="results">
        {node && <CapacityForm node={node} />}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 className="sim-h" style={{ margin: 0 }}>Results{result ? '' : ''}</h3>
          <span className="chip chip--sm">indicative</span>
        </div>
        {stale && <p className="learn-stale" role="status">The diagram changed since this run. Press Run again.</p>}
        {body}
        <p className="indicative">Teaching model: indicative numbers, not a real cloud.</p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- capacity settings (13.1)

function CapacityForm({ node }: { node: DNode }) {
  const def = defaultsFor(node.role), info = roleInfo(node.role), s = node.sim ?? {};
  const update = useEditor((st) => st.update);
  if (info.category === 'client') {
    return <div className="cap"><h3 className="sim-h">{node.label}</h3><p className="note">{info.name} send the scenario's load: they have no capacity of their own.</p></div>;
  }
  const field = (key: 'instances' | 'capacity' | 'latency' | 'hitRate' | 'queueSize', label: string, ph: number | undefined, max: number, step = 1) => (
    <div className="field">
      <label htmlFor={`cap-${key}`}>{label}</label>
      <input className="input" id={`cap-${key}`} type="number" min={0} max={max} step={step} placeholder={ph === undefined ? '' : `${ph} (default)`} value={s[key] ?? ''}
        onChange={(e) => {
          const raw = e.target.value, v = Number(raw), next = { ...s };
          if (raw === '') delete next[key];
          else if (Number.isFinite(v) && v >= 0 && v <= max && (key !== 'capacity' || v > 0)) next[key] = key === 'instances' || key === 'queueSize' ? Math.round(v) : v;
          else return;
          update(node.id, { sim: Object.keys(next).length ? next : undefined }, `sim-${node.id}-${key}`);
        }} />
    </div>
  );
  const compute = info.category === 'compute' && !def.fn;
  const as = s.autoscale;
  const setAs = (patch: Partial<NonNullable<typeof as>> | null) => {
    const next = { ...s };
    if (patch === null) delete next.autoscale;
    else next.autoscale = { min: as?.min ?? def.instances, max: as?.max ?? Math.max(6, def.instances), threshold: as?.threshold ?? 0.7, ...patch };
    update(node.id, { sim: Object.keys(next).length ? next : undefined }, `sim-${node.id}-as`);
  };
  return (
    <div className="cap">
      <h3 className="sim-h">Capacity of {node.label}</h3>
      <p className="note">Optional. An empty field uses the default for a {info.name.toLowerCase()}, shown in grey.</p>
      <div className="cap-grid">
        {!def.fn && field('instances', 'Instances', def.instances, 1000)}
        {field('capacity', 'Capacity, req/s each', def.capacity, 1_000_000)}
        {field('latency', 'Latency, ms', def.latency, 60_000)}
        {def.hitRate !== undefined && field('hitRate', 'Hit rate (0 to 1)', def.hitRate, 1, 0.05)}
        {def.queueSize !== undefined && field('queueSize', 'Queue size', def.queueSize, 1_000_000_000)}
        {compute && (
          <div className="field">
            <label htmlFor="cap-as">Autoscaling</label>
            <select className="input select" id="cap-as" value={as ? 'on' : 'off'} onChange={(e) => setAs(e.target.value === 'on' ? {} : null)}>
              <option value="off">Off</option><option value="on">On</option>
            </select>
          </div>
        )}
        {compute && as && (
          <>
            <div className="field"><label htmlFor="cap-min">Minimum</label><input className="input" id="cap-min" type="number" min={0} max={1000} value={as.min} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 0 && v <= as.max) setAs({ min: v }); }} /></div>
            <div className="field"><label htmlFor="cap-max">Maximum</label><input className="input" id="cap-max" type="number" min={1} max={1000} value={as.max} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= as.min && v <= 1000) setAs({ max: v }); }} /></div>
          </>
        )}
      </div>
    </div>
  );
}
