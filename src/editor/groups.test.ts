import { describe, expect, it } from 'vitest';
import {
  childOf, commonPath, freshGroups, groupOf, nextGid, nextGroupName, normalizeGroups, pathExists, scopeOf,
  splitPaths, unitAt, type GroupRef,
} from './groups';

type T = { name: string; gpath: GroupRef[] };
/** Imagen con su cadena de grupos: L('a', 1, 2) = a en el grupo 2, que está dentro del 1. */
const L = (name: string, ...ids: number[]): T => ({ name, gpath: ids.map((id) => ({ id, name: `Grupo ${id}` })) });
const names = (ls: { name: string }[]) => ls.map((l) => l.name).join(',');
const path = (l: T) => l.gpath.map((g) => g.id).join('>');

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
    expect(out.find((l) => l.name === 'a')!.gpath).toEqual([]);
    expect(out.filter((l) => path(l) === '2')).toHaveLength(2);
  });
  it('sin grupos no cambia nada', () => {
    const ls = [L('a'), L('b'), L('c')];
    expect(names(normalizeGroups(ls))).toBe('a,b,c');
  });
});

describe('grupos dentro de grupos', () => {
  // grupo 1 = { a, grupo 2 = { b, c } }, y d suelta
  const tree = () => [L('a', 1), L('b', 1, 2), L('d'), L('c', 1, 2)];
  it('junta cada subgrupo dentro de su grupo', () => {
    expect(names(normalizeGroups(tree()))).toBe('d,a,b,c');
  });
  it('un grupo con un solo elemento (un subgrupo) se deshace y el subgrupo sube', () => {
    const out = normalizeGroups([L('b', 1, 2), L('c', 1, 2), L('d')]);
    expect(out.map(path)).toEqual(['2', '2', '']);
  });
  it('un subgrupo y una imagen suelta del grupo cuentan como dos elementos', () => {
    const out = normalizeGroups(tree());
    expect(out.map(path)).toEqual(['', '1', '1>2', '1>2']);
  });
  it('clic: desde el póster, el grupo de más afuera; dentro del grupo 1, el subgrupo 2 o la imagen', () => {
    const ls = normalizeGroups(tree()), [d, a, b] = [ls[0]!, ls[1]!, ls[2]!];
    expect(names(unitAt(ls, b, null))).toBe('a,b,c');
    expect(names(unitAt(ls, b, 1))).toBe('b,c');
    expect(names(unitAt(ls, a, 1))).toBe('a');
    expect(names(unitAt(ls, d, null))).toBe('d');
    expect(childOf(d, 1)).toBeUndefined(); // d no está en el grupo 1
  });
  it('qué grupo está seleccionado y en qué nivel se está', () => {
    const ls = normalizeGroups(tree()), [, a, b, c] = ls as [T, T, T, T];
    expect(groupOf(ls, [a, b, c])).toBe(1);
    expect(scopeOf(ls, [a, b, c])).toBeNull(); // el grupo 1 entero: se está en el póster
    expect(groupOf(ls, [b, c])).toBe(2);
    expect(scopeOf(ls, [b, c])).toBe(1); // el subgrupo 2: se está dentro del 1
    expect(scopeOf(ls, [b])).toBe(2); // una imagen sola del 2: se entró en el 2
    expect(groupOf(ls, [a, b])).toBeNull();
    expect(commonPath([b, c]).map((g) => g.id)).toEqual([1, 2]);
  });
  it('las ocultas o bloqueadas no cuentan para saber si el grupo está entero', () => {
    const ls = normalizeGroups(tree()), [, a, b, c] = ls as [T, T, T, T];
    expect(groupOf(ls, [b, c], (l) => l !== a)).toBe(2);
    expect(groupOf(ls, [b, c], (l) => l !== c)).toBeNull(); // c no se puede elegir: [b, c] no es la selección posible
  });
});

describe('nombres y números de grupo', () => {
  it('«Grupo N»: uno más que el mayor en uso', () => {
    expect(nextGroupName([])).toBe('Grupo 1');
    const ls = [L('a', 1), L('b', 1), L('c', 4), L('d', 4)];
    expect(nextGroupName(ls)).toBe('Grupo 5');
    ls[2]!.gpath[0]!.name = 'Logo'; ls[3]!.gpath[0]!.name = 'Logo';
    expect(nextGroupName(ls)).toBe('Grupo 2');
  });
  it('el número nuevo no repite ninguno, a ninguna profundidad', () => {
    expect(nextGid([L('a', 3, 7), L('b')])).toBe(8);
  });
});

describe('copias de grupos', () => {
  const ls = normalizeGroups([L('a', 1), L('b', 1, 2), L('c', 1, 2), L('d')]);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => ls.find((l) => l.name === n)!) as [T, T, T, T];
  it('copiar el subgrupo 2: se copia entero y las copias se quedan dentro del grupo 1', () => {
    const sp = splitPaths([b, c], ls);
    expect(sp.map((s) => s.keep.map((g) => g.id))).toEqual([[1], [1]]);
    expect(sp.map((s) => s.whole.map((g) => g.id))).toEqual([[2], [2]]);
  });
  it('copiar el grupo 1 entero: todo se copia, nada queda alrededor', () => {
    const sp = splitPaths([a, b, c], ls);
    expect(sp.every((s) => !s.keep.length)).toBe(true);
    expect(sp.map((s) => s.whole.map((g) => g.id).join('>'))).toEqual(['1', '1>2', '1>2']);
  });
  it('una imagen sola de un grupo: la copia se queda en sus grupos', () => {
    expect(splitPaths([b], ls)[0]).toEqual({ keep: b.gpath, whole: [] });
  });
  it('los grupos copiados enteros reciben números nuevos, iguales entre las copias, con el mismo nombre', () => {
    const [p1, p2, p3] = freshGroups([a.gpath, b.gpath, d.gpath], ls);
    expect(p1![0]!.id).not.toBe(1);
    expect(p1![0]!.id).toBe(p2![0]!.id);
    expect(p2![1]!.id).not.toBe(2);
    expect(p2![1]!.name).toBe('Grupo 2');
    expect(p3).toEqual([]);
  });
  it('pegar dentro del grupo de origen solo si sigue existiendo', () => {
    expect(pathExists(ls, [{ id: 1, name: '' }])).toBe(true);
    expect(pathExists(ls, [{ id: 9, name: '' }])).toBe(false);
    expect(pathExists(ls, [])).toBe(true);
  });
});
