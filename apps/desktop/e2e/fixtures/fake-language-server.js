// A stand-in language server for tests (crates/mobius-host/src/code_lsp.rs and e2e/code.spec.ts): it speaks the
// protocol over its input and output and answers from the text it was sent, without knowing any language.
// Problems: each line with TODO. Completion: toFixed and toString. Hover: `const <word>: number`. Definition: the
// word's first place. Rename: every place of the word. Formatting: trailing spaces removed.
const texts = new Map();
let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function wordAt(text, line, character) {
  const row = text.split('\n')[line] ?? '';
  let from = character;
  let to = character;
  while (from > 0 && /\w/.test(row[from - 1])) from--;
  while (to < row.length && /\w/.test(row[to])) to++;
  return row.slice(from, to);
}

function places(text, word) {
  const found = [];
  text.split('\n').forEach((row, line) => {
    for (const m of row.matchAll(new RegExp(`\\b${word}\\b`, 'g'))) found.push({ start: { line, character: m.index }, end: { line, character: m.index + word.length } });
  });
  return found;
}

function problems(uri) {
  const diagnostics = [];
  (texts.get(uri) ?? '').split('\n').forEach((row, line) => {
    const at = row.indexOf('TODO');
    if (at >= 0) diagnostics.push({ range: { start: { line, character: at }, end: { line, character: at + 4 } }, severity: 1, source: 'fake', message: 'Finish this TODO' });
  });
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}

function answer(message) {
  const { id, method, params } = message;
  const text = params?.textDocument ? texts.get(params.textDocument.uri) ?? '' : '';
  const word = params?.position ? wordAt(text, params.position.line, params.position.character) : '';
  switch (method) {
    case 'initialize': return send({ id, result: { capabilities: { textDocumentSync: 1, completionProvider: { triggerCharacters: ['.'] }, hoverProvider: true, definitionProvider: true, renameProvider: true, documentFormattingProvider: true } } });
    case 'initialized': return;
    case 'textDocument/didOpen': texts.set(params.textDocument.uri, params.textDocument.text); return problems(params.textDocument.uri);
    case 'textDocument/didChange': texts.set(params.textDocument.uri, params.contentChanges.at(-1).text); return problems(params.textDocument.uri);
    case 'textDocument/didClose': texts.delete(params.textDocument.uri); return;
    case 'textDocument/completion': return send({ id, result: { isIncomplete: false, items: [
      { label: 'toFixed', kind: 2, detail: '(digits?: number) => string', insertTextFormat: 2, insertText: 'toFixed(${1:digits})', sortText: '0' },
      { label: 'toString', kind: 2, detail: '() => string', insertText: 'toString()', sortText: '1' },
    ] } });
    case 'textDocument/hover': return send({ id, result: word ? { contents: { kind: 'markdown', value: '```ts\nconst ' + word + ': number\n```' } } : null });
    case 'textDocument/definition': { const first = places(text, word)[0]; return send({ id, result: first ? { uri: params.textDocument.uri, range: first } : null }); }
    case 'textDocument/rename': return send({ id, result: { changes: { [params.textDocument.uri]: places(text, word).map((range) => ({ range, newText: params.newName })) } } });
    case 'textDocument/formatting': return send({ id, result: text.split('\n').flatMap((row, line) => {
      const kept = row.trimEnd().length;
      return kept < row.length ? [{ range: { start: { line, character: kept }, end: { line, character: row.length } }, newText: '' }] : [];
    }) });
    case 'shutdown': return send({ id, result: null });
    case 'exit': return process.exit(0);
    default: if (id !== undefined) send({ id, error: { code: -32601, message: `no ${method}` } });
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
    if (buffer.length < end + 4 + length) return;
    answer(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8')));
    buffer = buffer.subarray(end + 4 + length);
  }
});
process.stdin.on('end', () => process.exit(0));
