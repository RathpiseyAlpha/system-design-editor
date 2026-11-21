import { describe, expect, it } from 'vitest';
import { fromTemplate, serializeDiagram } from '@archboard/engine';
import { readEmbed, readHostMessage, validOrigin } from './protocol.ts';

describe('embed address', () => {
  it('the editor itself is not an embed', () => {
    expect(readEmbed('/', '').embed).toBe(false);
    expect(readEmbed('/index.html', '?x=1').embed).toBe(false);
  });
  it('/embed with a valid origin starts in view mode', () => {
    for (const path of ['/embed', '/embed/', '/app/embed/index.html']) {
      expect(readEmbed(path, '?mode=view&origin=https://lab.example.org')).toEqual({ embed: true, mode: 'view', origin: 'https://lab.example.org', problem: null });
    }
  });
  it('refuses to start without a valid host origin, or in a mode that does not exist', () => {
    expect(readEmbed('/embed/', '?mode=view').problem).toMatch(/origin/);
    expect(readEmbed('/embed/', '?mode=view&origin=*').problem).toMatch(/origin/);
    expect(readEmbed('/embed/', '?mode=admin&origin=https://a.org').problem).toMatch(/mode=view, mode=edit or mode=learn/);
  });
  it('edit and learn modes start like view', () => {
    expect(readEmbed('/embed/', '?mode=edit&origin=https://a.org')).toMatchObject({ mode: 'edit', problem: null });
    expect(readEmbed('/embed/', '?mode=learn&origin=https://a.org')).toMatchObject({ mode: 'learn', problem: null });
  });
  it('only https origins (or http on this computer), with no path', () => {
    expect(validOrigin('https://a.org')).toBe('https://a.org');
    expect(validOrigin('http://localhost:8765')).toBe('http://localhost:8765');
    for (const bad of ['http://a.org', 'https://a.org/', 'https://a.org/x', 'javascript:alert(1)', 'null', '*', '']) expect(validOrigin(bad), bad).toBeNull();
  });
});

describe('host messages', () => {
  const d = fromTemplate('three-tier');
  it('load takes a diagram object or its text, through the file schema', () => {
    const a = readHostMessage({ type: 'load', v: 1, diagram: JSON.parse(serializeDiagram(d)), show: 'aws' });
    expect(a.ok && a.msg.type === 'load' && a.msg.diagram.nodes.length === d.nodes.length && a.msg.show === 'aws').toBe(true);
    const b = readHostMessage({ type: 'load', v: 1, diagram: serializeDiagram(d), show: 'nope' });
    expect(b.ok && b.msg.type === 'load' && b.msg.show === null).toBe(true);
  });
  it('a broken diagram, an oversized one, another version or an unknown type is an error, not an action', () => {
    expect(readHostMessage({ type: 'load', v: 1, diagram: { format: 'archboard', version: 1, nodes: [{ id: 'a' }] } }).ok).toBe(false);
    expect(readHostMessage({ type: 'load', v: 1, diagram: 'x'.repeat(300 * 1024) }).ok).toBe(false);
    expect(readHostMessage({ type: 'load', v: 2, diagram: serializeDiagram(d) }).ok).toBe(false);
    expect(readHostMessage({ type: 'eval', v: 1, code: '1' }).ok).toBe(false);
    expect(readHostMessage('load').ok).toBe(false);
    expect(readHostMessage(null).ok).toBe(false);
  });
  it('hello and requestSave carry nothing; load may carry readOnly, a brief and rules, each checked', () => {
    expect(readHostMessage({ type: 'hello', v: 1 })).toEqual({ ok: true, msg: { type: 'hello' } });
    expect(readHostMessage({ type: 'requestSave', v: 1 })).toEqual({ ok: true, msg: { type: 'requestSave' } });
    const rules = { format: 'archboard-rules', version: 1, rules: [{ id: 'a', points: 1, text: 'One VM', rule: { count: { role: 'vm', min: 1 } } }] };
    const a = readHostMessage({ type: 'load', v: 1, diagram: serializeDiagram(d), readOnly: true, brief: { label: 'Challenge 1', title: 'Shop', text: '# Hi' }, rules });
    expect(a.ok && a.msg.type === 'load' && a.msg.readOnly && a.msg.brief?.title === 'Shop' && a.msg.rules?.rules.length === 1).toBe(true);
    const plain = readHostMessage({ type: 'load', v: 1, diagram: serializeDiagram(d) });
    expect(plain.ok && plain.msg.type === 'load' && !plain.msg.readOnly && plain.msg.brief === null && plain.msg.rules === null).toBe(true);
    expect(readHostMessage({ type: 'load', v: 1, diagram: serializeDiagram(d), brief: { title: 'x', text: 'y'.repeat(5001) } }).ok).toBe(false);
    expect(readHostMessage({ type: 'load', v: 1, diagram: serializeDiagram(d), brief: '<img src=x onerror=alert(1)>' }).ok).toBe(false);
    expect(readHostMessage({ type: 'load', v: 1, diagram: serializeDiagram(d), rules: { ...rules, rules: [{ id: 'a', points: 1, text: 't', rule: { label: 'x' } }] } })).toMatchObject({ ok: false, errors: [expect.stringMatching(/^rules: /)] });
  });
  it('setTheme takes only the three themes', () => {
    expect(readHostMessage({ type: 'setTheme', v: 1, theme: 'dark' })).toEqual({ ok: true, msg: { type: 'setTheme', theme: 'dark' } });
    expect(readHostMessage({ type: 'setTheme', v: 1, theme: 'red' }).ok).toBe(false);
  });
});
