import { describe, expect, it } from 'vitest';
import { isProjectName, packProject, ProjectFileError, unpackProject } from './projectfile';

const buf = async (b: Blob) => await b.arrayBuffer();
const text = async (b: Blob) => await b.text();

describe('archivo de proyecto', () => {
  it('ida y vuelta: el proyecto y sus archivos, con su tipo, tal cual', async () => {
    const files = new Map([
      ['src-a1', new Blob(['%PDF-1.7 hola'], { type: 'application/pdf' })],
      ['px-b2', new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: 'image/png' })],
      ['src-vacio', new Blob([], { type: '' })],
    ]);
    const project = { schema: 1, layers: [{ name: 'Póster ñandú 🦤' }], layout: { paper: 'A4' } };
    const out = unpackProject(await buf(packProject(project, files)));
    expect(out.project).toEqual(project);
    expect([...out.files.keys()]).toEqual(['src-a1', 'px-b2', 'src-vacio']);
    expect(await text(out.files.get('src-a1')!)).toBe('%PDF-1.7 hola');
    expect(out.files.get('src-a1')!.type).toBe('application/pdf');
    expect([...new Uint8Array(await buf(out.files.get('px-b2')!))]).toEqual([137, 80, 78, 71, 0, 255]);
    expect(out.files.get('src-vacio')!.size).toBe(0);
  });
  it('reconoce la extensión', () => {
    expect(isProjectName('mi póster.ENGRANDE')).toBe(true);
    expect(isProjectName('foto.png')).toBe(false);
  });

  /** Cabecera hecha a mano, para probar archivos malformados. */
  const craft = (head: unknown, body: Uint8Array = new Uint8Array(), version = 1) => {
    const h = new TextEncoder().encode(typeof head === 'string' ? head : JSON.stringify(head));
    const pre = new Uint8Array(13);
    pre.set(new TextEncoder().encode('ENGRANDE'));
    pre[8] = version;
    new DataView(pre.buffer).setUint32(9, h.length, true);
    const out = new Uint8Array(pre.length + h.length + body.length);
    out.set(pre); out.set(h, 13); out.set(body, 13 + h.length);
    return out.buffer;
  };
  const bad = (b: ArrayBuffer) => expect(() => unpackProject(b)).toThrow(ProjectFileError);

  it('rechaza lo que no es un proyecto o está dañado', async () => {
    bad(await buf(new Blob(['no soy un proyecto'])));
    bad(new ArrayBuffer(3));
    bad(craft('{ esto no es json'));
    bad(craft({ files: [] })); // sin proyecto
    bad(craft({ project: {}, files: 'x' }));
    expect(() => unpackProject(craft({ project: {}, files: [] }, undefined, 2))).toThrow(/más nueva/);
  });
  it('rechaza archivos que se salen, claves raras y tipos peligrosos', () => {
    const body = new Uint8Array([1, 2, 3]);
    bad(craft({ project: {}, files: [{ key: 'src-a', type: 'image/png', size: 10 }] }, body)); // se sale del archivo
    bad(craft({ project: {}, files: [{ key: '../etc', type: 'image/png', size: 1 }] }, body));
    bad(craft({ project: {}, files: [{ key: '__proto__', type: 'image/png', size: 1 }] }, body));
    bad(craft({ project: {}, files: [{ key: 'src-a', type: 'text/html', size: 1 }] }, body));
    bad(craft({ project: {}, files: [{ key: 'src-a', type: 'image/png', size: -1 }] }, body));
    bad(craft({ project: {}, files: [{ key: 'src-a', type: 'image/png', size: 1 }, { key: 'src-a', type: 'image/png', size: 1 }] }, body));
    // longitud de cabecera mayor que el archivo
    const b = craft({ project: {}, files: [] });
    new DataView(b).setUint32(9, 1e6, true);
    bad(b);
  });
  it('un SVG se admite (se abre como imagen, sin ejecutar su JavaScript)', () => {
    const out = unpackProject(craft({ project: {}, files: [{ key: 'src-s', type: 'image/svg+xml', size: 3 }] }, new Uint8Array([60, 115, 62])));
    expect(out.files.get('src-s')!.type).toBe('image/svg+xml');
  });
});
