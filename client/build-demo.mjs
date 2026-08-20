/**
 * Junta o build da demonstracao em um unico HTML autocontido, do jeito que o
 * visualizador de Artifacts exige: sem requisicoes externas e sem <html>/<head>/<body>,
 * que sao adicionados na publicacao.
 *
 *   node client/build-demo.mjs [arquivo-de-saida]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist-demo');
const out = process.argv[2] || path.join(here, 'taskcontrol-demo.html');

const css = fs.readFileSync(path.join(dist, 'app.css'), 'utf8');
const js = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');

if (js.includes('</script')) {
  throw new Error('O bundle contém </script> e quebraria o HTML embutido.');
}

fs.writeFileSync(
  out,
  `<meta charset="utf-8">
<title>TaskControl</title>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`,
  'utf8',
);

console.log(`${out} — ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
