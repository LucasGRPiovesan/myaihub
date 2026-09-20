import { describe, expect, it } from 'vitest';
import {
  extractColors,
  extractFonts,
  extractLogoUrls,
  extractRadii,
  extractWebFonts,
  readVisualIdentity,
} from './visual-identity.js';

describe('extractColors', () => {
  it('conta a frequência e guarda ONDE a cor foi usada', () => {
    const cores = extractColors(`
      .botao { background: #1f6feb; color: #ffffff; }
      .cabecalho { background-color: #1f6feb; }
      .borda { border: 1px solid #e3e7ef; }
    `);

    const marca = cores.find((cor) => cor.hex === '#1f6feb');
    expect(marca?.count).toBe(2);
    expect(marca?.roles).toContain('fundo');

    expect(cores.find((cor) => cor.hex === '#e3e7ef')?.roles).toContain('borda');
    expect(cores.find((cor) => cor.hex === '#ffffff')?.roles).toContain('texto');
  });

  it('normaliza hexadecimal de 3 dígitos para 6', () => {
    const cores = extractColors('.a { color: #fff; } .b { background: #FFFFFF; }');

    expect(cores).toHaveLength(1);
    expect(cores[0]?.hex).toBe('#ffffff');
    expect(cores[0]?.count).toBe(2);
  });

  it('lê rgb() e ignora o quase transparente — sombra não é cor de marca', () => {
    const cores = extractColors(`
      .a { background: rgb(31, 111, 235); }
      .sombra { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
    `);

    expect(cores.map((cor) => cor.hex)).toContain('#1f6feb');
    expect(cores.map((cor) => cor.hex)).not.toContain('#000000');
  });
});

describe('extractFonts', () => {
  it('pega só a PRIMEIRA da pilha — o resto é o plano B do próprio site', () => {
    const fontes = extractFonts(`body { font-family: 'Poppins', Arial, sans-serif; }`);

    expect(fontes).toHaveLength(1);
    expect(fontes[0]?.family).toBe('Poppins');
  });

  it('marca a fonte declarada para títulos', () => {
    const fontes = extractFonts(`
      body { font-family: Inter, sans-serif; }
      h1, h2 { font-family: Poppins, sans-serif; }
    `);

    expect(fontes.find((fonte) => fonte.family === 'Poppins')?.heading).toBe(true);
    expect(fontes.find((fonte) => fonte.family === 'Inter')?.heading).toBe(false);
  });

  it('descarta as genéricas: elas não são a fonte de ninguém', () => {
    const fontes = extractFonts('a { font-family: sans-serif; } b { font-family: system-ui; }');

    expect(fontes).toEqual([]);
  });
});

describe('extractWebFonts', () => {
  it('lê as famílias do link do provedor — o sinal mais forte que existe', () => {
    const familias = extractWebFonts(
      `<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&amp;family=Inter&display=swap" rel="stylesheet">`,
    );

    expect(familias).toEqual(['Poppins', 'Inter']);
  });

  /*
    Medido no site real da Sankar: ele carrega Montserrat e Material Symbols do
    mesmo link. A segunda é um alfabeto de pictogramas — e uma página de
    atendimento escrita em símbolos é uma falha que ninguém testa antes de
    publicar.
  */
  it('descarta fonte de ÍCONE, que vem no mesmo link da fonte de marca', () => {
    const familias = extractWebFonts(
      `<link href="https://fonts.googleapis.com/css2?family=Montserrat&family=Material+Symbols+Outlined" rel="stylesheet">`,
    );

    expect(familias).toEqual(['Montserrat']);
  });

  it('lê o nome declarado num @font-face próprio', () => {
    const familias = extractWebFonts(`<style>@font-face { font-family: 'Sankar Sans'; }</style>`);

    expect(familias).toEqual(['Sankar Sans']);
  });
});

describe('extractRadii', () => {
  it('converte rem para px e ordena por frequência', () => {
    const raios = extractRadii(`
      .a { border-radius: 8px; }
      .b { border-radius: 8px; }
      .c { border-radius: 0.5rem; }
      .d { border-radius: 999px; }
    `);

    expect(raios[0]).toEqual({ px: 8, count: 3 });
    // 999px é "pílula", não uma medida de forma: fica fora por ser > 200.
    expect(raios.map((raio) => raio.px)).not.toContain(999);
  });
});

describe('extractLogoUrls', () => {
  it('resolve caminho relativo contra a página e prefere og:image', () => {
    const urls = extractLogoUrls(
      `<meta property="og:image" content="/img/marca.png">
       <link rel="apple-touch-icon" href="/icone.png">`,
      'https://exemplo.com.br/home',
    );

    expect(urls[0]).toBe('https://exemplo.com.br/img/marca.png');
    expect(urls).toContain('https://exemplo.com.br/icone.png');
  });

  it('descarta esquema que não é http(s)', () => {
    const urls = extractLogoUrls(
      `<meta property="og:image" content="javascript:alert(1)">`,
      'https://exemplo.com.br/',
    );

    expect(urls).toEqual([]);
  });
});

describe('readVisualIdentity', () => {
  it('junta o style da página, o atributo style e o CSS externo', () => {
    const evidencia = readVisualIdentity(
      `<html>
         <head>
           <meta name="theme-color" content="#0b5cd5">
           <meta property="og:site_name" content="Sankar">
           <style>.topo { background: #0b5cd5; }</style>
         </head>
         <body><div style="border-radius: 12px">oi</div></body>
       </html>`,
      `body { font-family: 'Roboto Slab', serif; } .btn { background: #0b5cd5; }`,
      'https://sankar.com.br/',
    );

    expect(evidencia.themeColor).toBe('#0b5cd5');
    expect(evidencia.siteName).toBe('Sankar');
    expect(evidencia.colors.find((cor) => cor.hex === '#0b5cd5')?.count).toBe(2);
    expect(evidencia.fonts[0]?.family).toBe('Roboto Slab');
    expect(evidencia.radii[0]?.px).toBe(12);
  });
});
