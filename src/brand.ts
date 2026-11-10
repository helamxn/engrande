/** Identidad pública. Las claves históricas del almacenamiento se conservan por compatibilidad. */
const name = 'engrande';

export const BRAND = {
  name,
  title: `${name} · Pósters por hojas, a tu medida`,
  tagline: 'Dale espacio a lo que imaginas.',
  description: 'Convierte imágenes y PDF en pósters para imprimir por hojas A4, A3 o Carta. Decide las medidas, revisa las hojas y descarga el PDF con marcas de corte y solape.',
  image: '/og.png?v=3',
  imageAlt: 'engrande: «Dale espacio a lo que imaginas», con un ave de papel rosa y azul que desborda el marco de la imagen.',
  themeColor: '#0f1418',
} as const;
