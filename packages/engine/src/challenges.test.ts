// Every challenge in challenges/ must stay right: it reads, a blank diagram scores 0, the starting diagram scores less than
// full marks, and its reference solution scores full marks (challenges/README.md).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyDiagram, parseDiagram } from './format.ts';
import { evaluateRules, parseRuleset } from './rules.ts';

const DIR = new URL('../../../challenges/', import.meta.url);
const ids = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.solution.json')).map((f) => f.slice(0, -5));

describe.each(ids)('challenge %s', (id) => {
  const c = JSON.parse(readFileSync(new URL(`${id}.json`, DIR), 'utf8'));
  const solution = parseDiagram(JSON.parse(readFileSync(new URL(`${id}.solution.json`, DIR), 'utf8')));
  const rules = parseRuleset(c.rules);
  const start = parseDiagram(c.start);

  it('reads: format, brief, rules, starting diagram and solution', () => {
    expect([c.format, c.version, c.id]).toEqual(['archboard-challenge', 1, id]);
    expect(typeof c.brief?.title === 'string' && typeof c.brief?.text === 'string').toBe(true);
    expect(rules.ok && start.ok && solution.ok).toBe(true);
  });
  it('a blank diagram scores 0, the start less than full, the solution full', () => {
    if (!rules.ok || !start.ok || !solution.ok) throw new Error('does not read');
    const max = rules.ruleset.rules.reduce((s, r) => s + r.points, 0);
    expect(evaluateRules(emptyDiagram(), rules.ruleset).score).toBe(0);
    expect(evaluateRules(start.diagram, rules.ruleset).score).toBeLessThan(max);
    const sol = evaluateRules(solution.diagram, rules.ruleset);
    expect(sol.results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.message}`)).toEqual([]);
    expect(sol.score).toBe(max);
  });
});
