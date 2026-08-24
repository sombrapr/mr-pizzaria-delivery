'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const start = source.indexOf('  Lanches: [');
const end = source.indexOf('  Porções:', start);

if (start === -1 || end === -1 || end <= start) {
  console.warn('Seção Lanches não localizada; nenhuma alteração aplicada.');
  process.exit(0);
}

const before = source.slice(start, end);
const after = before
  .replace(/queijo, mussarela/g, 'queijo prato')
  .replace(/queijo mussarela/g, 'queijo prato')
  .replace(/presunto, mussarela/g, 'presunto, queijo prato');

if (after !== before) {
  source = source.slice(0, start) + after + source.slice(end);
  fs.writeFileSync(serverPath, source, 'utf8');
  console.log('Lanches atualizados para queijo prato.');
} else {
  console.log('Lanches já estão usando queijo prato.');
}
