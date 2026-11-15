/** Catálogo inicial de Google Fonts servido desde este dominio. Licencias: /fonts/licenses/.
 * Cada variante se descarga solo al elegirla. Los identificadores b: conservan proyectos anteriores. */
import font0 from '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff?url';
import font1 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import font2 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff?url';
import font3 from '@fontsource/playfair-display/files/playfair-display-latin-400-italic.woff?url';
import font4 from '@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff?url';
import font5 from '@fontsource/saira-stencil-one/files/saira-stencil-one-latin-400-normal.woff?url';
import font6 from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import font7 from '@fontsource/roboto/files/roboto-latin-700-normal.woff?url';
import font8 from '@fontsource/roboto/files/roboto-latin-400-italic.woff?url';
import font9 from '@fontsource/roboto/files/roboto-latin-700-italic.woff?url';
import font10 from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url';
import font11 from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url';
import font12 from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff?url';
import font13 from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff?url';
import font14 from '@fontsource/lato/files/lato-latin-400-normal.woff?url';
import font15 from '@fontsource/lato/files/lato-latin-700-normal.woff?url';
import font16 from '@fontsource/lato/files/lato-latin-400-italic.woff?url';
import font17 from '@fontsource/lato/files/lato-latin-700-italic.woff?url';
import font18 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url';
import font19 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url';
import font20 from '@fontsource/montserrat/files/montserrat-latin-400-italic.woff?url';
import font21 from '@fontsource/montserrat/files/montserrat-latin-700-italic.woff?url';
import font22 from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import font23 from '@fontsource/oswald/files/oswald-latin-700-normal.woff?url';
import font24 from '@fontsource/poppins/files/poppins-latin-400-normal.woff?url';
import font25 from '@fontsource/poppins/files/poppins-latin-700-normal.woff?url';
import font26 from '@fontsource/poppins/files/poppins-latin-400-italic.woff?url';
import font27 from '@fontsource/poppins/files/poppins-latin-700-italic.woff?url';
import font28 from '@fontsource/raleway/files/raleway-latin-400-normal.woff?url';
import font29 from '@fontsource/raleway/files/raleway-latin-700-normal.woff?url';
import font30 from '@fontsource/raleway/files/raleway-latin-400-italic.woff?url';
import font31 from '@fontsource/raleway/files/raleway-latin-700-italic.woff?url';
import font32 from '@fontsource/nunito/files/nunito-latin-400-normal.woff?url';
import font33 from '@fontsource/nunito/files/nunito-latin-700-normal.woff?url';
import font34 from '@fontsource/nunito/files/nunito-latin-400-italic.woff?url';
import font35 from '@fontsource/nunito/files/nunito-latin-700-italic.woff?url';
import font36 from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';
import font37 from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff?url';
import font38 from '@fontsource/merriweather/files/merriweather-latin-400-italic.woff?url';
import font39 from '@fontsource/merriweather/files/merriweather-latin-700-italic.woff?url';
import font40 from '@fontsource/lora/files/lora-latin-400-normal.woff?url';
import font41 from '@fontsource/lora/files/lora-latin-700-normal.woff?url';
import font42 from '@fontsource/lora/files/lora-latin-400-italic.woff?url';
import font43 from '@fontsource/lora/files/lora-latin-700-italic.woff?url';
import font44 from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff?url';
import font45 from '@fontsource/libre-baskerville/files/libre-baskerville-latin-700-normal.woff?url';
import font46 from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-italic.woff?url';
import font47 from '@fontsource/libre-baskerville/files/libre-baskerville-latin-700-italic.woff?url';
import font48 from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?url';
import font49 from '@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff?url';
import font50 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import font51 from '@fontsource/anton/files/anton-latin-400-normal.woff?url';
import font52 from '@fontsource/abril-fatface/files/abril-fatface-latin-400-normal.woff?url';
import font53 from '@fontsource/lobster/files/lobster-latin-400-normal.woff?url';
import font54 from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';

export interface CatalogFont {
  id: string; name: string; family: string; style: string; weight: number; italic: boolean; url: string; provider: 'google';
}

export const GOOGLE_FONTS: readonly CatalogFont[] = [
  { id: "b:archivo-black", name: "Archivo Black", family: "Archivo Black", style: "Regular", weight: 400, italic: false, url: font0, provider: 'google' },
  { id: "g:playfair-display:400:normal", name: "Playfair Display", family: "Playfair Display", style: "Regular", weight: 400, italic: false, url: font1, provider: 'google' },
  { id: "b:playfair-bold", name: "Playfair Display", family: "Playfair Display", style: "Negrita", weight: 700, italic: false, url: font2, provider: 'google' },
  { id: "g:playfair-display:400:italic", name: "Playfair Display", family: "Playfair Display", style: "Regular cursiva", weight: 400, italic: true, url: font3, provider: 'google' },
  { id: "g:playfair-display:700:italic", name: "Playfair Display", family: "Playfair Display", style: "Negrita cursiva", weight: 700, italic: true, url: font4, provider: 'google' },
  { id: "b:saira-stencil", name: "Saira Stencil", family: "Saira Stencil", style: "Regular", weight: 400, italic: false, url: font5, provider: 'google' },
  { id: "g:roboto:400:normal", name: "Roboto", family: "Roboto", style: "Regular", weight: 400, italic: false, url: font6, provider: 'google' },
  { id: "g:roboto:700:normal", name: "Roboto", family: "Roboto", style: "Negrita", weight: 700, italic: false, url: font7, provider: 'google' },
  { id: "g:roboto:400:italic", name: "Roboto", family: "Roboto", style: "Regular cursiva", weight: 400, italic: true, url: font8, provider: 'google' },
  { id: "g:roboto:700:italic", name: "Roboto", family: "Roboto", style: "Negrita cursiva", weight: 700, italic: true, url: font9, provider: 'google' },
  { id: "g:open-sans:400:normal", name: "Open Sans", family: "Open Sans", style: "Regular", weight: 400, italic: false, url: font10, provider: 'google' },
  { id: "g:open-sans:700:normal", name: "Open Sans", family: "Open Sans", style: "Negrita", weight: 700, italic: false, url: font11, provider: 'google' },
  { id: "g:open-sans:400:italic", name: "Open Sans", family: "Open Sans", style: "Regular cursiva", weight: 400, italic: true, url: font12, provider: 'google' },
  { id: "g:open-sans:700:italic", name: "Open Sans", family: "Open Sans", style: "Negrita cursiva", weight: 700, italic: true, url: font13, provider: 'google' },
  { id: "g:lato:400:normal", name: "Lato", family: "Lato", style: "Regular", weight: 400, italic: false, url: font14, provider: 'google' },
  { id: "g:lato:700:normal", name: "Lato", family: "Lato", style: "Negrita", weight: 700, italic: false, url: font15, provider: 'google' },
  { id: "g:lato:400:italic", name: "Lato", family: "Lato", style: "Regular cursiva", weight: 400, italic: true, url: font16, provider: 'google' },
  { id: "g:lato:700:italic", name: "Lato", family: "Lato", style: "Negrita cursiva", weight: 700, italic: true, url: font17, provider: 'google' },
  { id: "g:montserrat:400:normal", name: "Montserrat", family: "Montserrat", style: "Regular", weight: 400, italic: false, url: font18, provider: 'google' },
  { id: "g:montserrat:700:normal", name: "Montserrat", family: "Montserrat", style: "Negrita", weight: 700, italic: false, url: font19, provider: 'google' },
  { id: "g:montserrat:400:italic", name: "Montserrat", family: "Montserrat", style: "Regular cursiva", weight: 400, italic: true, url: font20, provider: 'google' },
  { id: "g:montserrat:700:italic", name: "Montserrat", family: "Montserrat", style: "Negrita cursiva", weight: 700, italic: true, url: font21, provider: 'google' },
  { id: "g:oswald:400:normal", name: "Oswald", family: "Oswald", style: "Regular", weight: 400, italic: false, url: font22, provider: 'google' },
  { id: "g:oswald:700:normal", name: "Oswald", family: "Oswald", style: "Negrita", weight: 700, italic: false, url: font23, provider: 'google' },
  { id: "g:poppins:400:normal", name: "Poppins", family: "Poppins", style: "Regular", weight: 400, italic: false, url: font24, provider: 'google' },
  { id: "g:poppins:700:normal", name: "Poppins", family: "Poppins", style: "Negrita", weight: 700, italic: false, url: font25, provider: 'google' },
  { id: "g:poppins:400:italic", name: "Poppins", family: "Poppins", style: "Regular cursiva", weight: 400, italic: true, url: font26, provider: 'google' },
  { id: "g:poppins:700:italic", name: "Poppins", family: "Poppins", style: "Negrita cursiva", weight: 700, italic: true, url: font27, provider: 'google' },
  { id: "g:raleway:400:normal", name: "Raleway", family: "Raleway", style: "Regular", weight: 400, italic: false, url: font28, provider: 'google' },
  { id: "g:raleway:700:normal", name: "Raleway", family: "Raleway", style: "Negrita", weight: 700, italic: false, url: font29, provider: 'google' },
  { id: "g:raleway:400:italic", name: "Raleway", family: "Raleway", style: "Regular cursiva", weight: 400, italic: true, url: font30, provider: 'google' },
  { id: "g:raleway:700:italic", name: "Raleway", family: "Raleway", style: "Negrita cursiva", weight: 700, italic: true, url: font31, provider: 'google' },
  { id: "g:nunito:400:normal", name: "Nunito", family: "Nunito", style: "Regular", weight: 400, italic: false, url: font32, provider: 'google' },
  { id: "g:nunito:700:normal", name: "Nunito", family: "Nunito", style: "Negrita", weight: 700, italic: false, url: font33, provider: 'google' },
  { id: "g:nunito:400:italic", name: "Nunito", family: "Nunito", style: "Regular cursiva", weight: 400, italic: true, url: font34, provider: 'google' },
  { id: "g:nunito:700:italic", name: "Nunito", family: "Nunito", style: "Negrita cursiva", weight: 700, italic: true, url: font35, provider: 'google' },
  { id: "g:merriweather:400:normal", name: "Merriweather", family: "Merriweather", style: "Regular", weight: 400, italic: false, url: font36, provider: 'google' },
  { id: "g:merriweather:700:normal", name: "Merriweather", family: "Merriweather", style: "Negrita", weight: 700, italic: false, url: font37, provider: 'google' },
  { id: "g:merriweather:400:italic", name: "Merriweather", family: "Merriweather", style: "Regular cursiva", weight: 400, italic: true, url: font38, provider: 'google' },
  { id: "g:merriweather:700:italic", name: "Merriweather", family: "Merriweather", style: "Negrita cursiva", weight: 700, italic: true, url: font39, provider: 'google' },
  { id: "g:lora:400:normal", name: "Lora", family: "Lora", style: "Regular", weight: 400, italic: false, url: font40, provider: 'google' },
  { id: "g:lora:700:normal", name: "Lora", family: "Lora", style: "Negrita", weight: 700, italic: false, url: font41, provider: 'google' },
  { id: "g:lora:400:italic", name: "Lora", family: "Lora", style: "Regular cursiva", weight: 400, italic: true, url: font42, provider: 'google' },
  { id: "g:lora:700:italic", name: "Lora", family: "Lora", style: "Negrita cursiva", weight: 700, italic: true, url: font43, provider: 'google' },
  { id: "g:libre-baskerville:400:normal", name: "Libre Baskerville", family: "Libre Baskerville", style: "Regular", weight: 400, italic: false, url: font44, provider: 'google' },
  { id: "g:libre-baskerville:700:normal", name: "Libre Baskerville", family: "Libre Baskerville", style: "Negrita", weight: 700, italic: false, url: font45, provider: 'google' },
  { id: "g:libre-baskerville:400:italic", name: "Libre Baskerville", family: "Libre Baskerville", style: "Regular cursiva", weight: 400, italic: true, url: font46, provider: 'google' },
  { id: "g:libre-baskerville:700:italic", name: "Libre Baskerville", family: "Libre Baskerville", style: "Negrita cursiva", weight: 700, italic: true, url: font47, provider: 'google' },
  { id: "g:dancing-script:400:normal", name: "Dancing Script", family: "Dancing Script", style: "Regular", weight: 400, italic: false, url: font48, provider: 'google' },
  { id: "g:dancing-script:700:normal", name: "Dancing Script", family: "Dancing Script", style: "Negrita", weight: 700, italic: false, url: font49, provider: 'google' },
  { id: "g:bebas-neue:400:normal", name: "Bebas Neue", family: "Bebas Neue", style: "Regular", weight: 400, italic: false, url: font50, provider: 'google' },
  { id: "g:anton:400:normal", name: "Anton", family: "Anton", style: "Regular", weight: 400, italic: false, url: font51, provider: 'google' },
  { id: "g:abril-fatface:400:normal", name: "Abril Fatface", family: "Abril Fatface", style: "Regular", weight: 400, italic: false, url: font52, provider: 'google' },
  { id: "g:lobster:400:normal", name: "Lobster", family: "Lobster", style: "Regular", weight: 400, italic: false, url: font53, provider: 'google' },
  { id: "g:pacifico:400:normal", name: "Pacifico", family: "Pacifico", style: "Regular", weight: 400, italic: false, url: font54, provider: 'google' },
];
