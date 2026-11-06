import { describe, expect, it } from 'vitest';
import { nextGid, normalizeGroups, regroupCopies } from './groups';

const L = (name: string, gid: number | null = null) => ({ name, gid });
const names = (ls: { name: string }[]) => ls.map((l) => l.name).join(',');

describe('grupos de imágenes', () => {
  it('junta las imágenes de un grupo a la altura de la que está más al frente', () => {
    // orden de dibujo: a (fondo) … e (frente); el grupo 1 son b y d
    const ls = [L('a'), L('b', 1), L('c'), L('d', 1), L('e')];
    expect(names(normalizeGroups(ls))).toBe('a,c,b,d,e');
  });
  it('mantiene el orden relativo dentro del grupo', () => {
    const ls = [L('d', 1), L('a'), L('b', 1), L('c', 1)];
    expect(names(normalizeGroups(ls))).toBe('a,d,b,c');
  });
  it('un grupo que se queda con una sola imagen deja de existir', () => {
    const ls = [L('a', 1), L('b'), L('c', 2), L('d', 2)];
    const out = normalizeGroups(ls);
    expect(out.find((l) => l.name === 'a')!.gid).toBeNull();
    expect(out.filter((l) => l.gid === 2)).toHaveLength(2);
  });
  it('al deshacerse un grupo, su imagen suelta pierde también el nombre del grupo', () => {
    const ls = [{ name: 'a', gid: 4, gname: 'Logo' }, { name: 'b', gid: null, gname: '' }];
    normalizeGroups(ls);
    expect(ls[0]).toEqual({ name: 'a', gid: null, gname: '' });
  });
  it('sin grupos no cambia nada', () => {
    const ls = [L('a'), L('b'), L('c')];
    expect(names(normalizeGroups(ls))).toBe('a,b,c');
  });
  it('las copias forman grupos nuevos, sin mezclarse con el original', () => {
    const used = [L('a', 1), L('b', 1), L('c', 3), L('d', 3)];
    const copies = [L('a2', 1), L('b2', 1), L('c2', 3), L('x')];
    regroupCopies(copies, used);
    expect(copies[0]!.gid).toBe(copies[1]!.gid);
    expect(copies[0]!.gid).not.toBe(1);
    expect(copies[2]!.gid).not.toBe(3);
    expect(copies[2]!.gid).not.toBe(copies[0]!.gid);
    expect(copies[3]!.gid).toBeNull();
    expect(nextGid([...used, ...copies])).toBeGreaterThan(Math.max(copies[0]!.gid!, copies[2]!.gid!));
  });
});
