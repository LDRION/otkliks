// «Собери сам»: заглушки вместо стека — это «бери из резюме», а поисковые запросы
// составляются по резюме с кешем на полсуток (не каждый круг) и паузой после неудачи.
const test = require('node:test');
const assert = require('node:assert');
const { cleanProfileList, deriveSearchQueries } = require('../src/resumeProfile');

test('заглушки в стеке считаются «не задано»', () => {
  assert.deepStrictEqual(cleanProfileList(['Собери сам']), []);
  assert.deepStrictEqual(cleanProfileList(['Никаких']), []);
  assert.deepStrictEqual(cleanProfileList(['Node.js', '-', 'TypeScript']), ['Node.js', 'TypeScript']);
});

test('запросы по резюме: один вызов, дальше кеш без загрузки резюме', async () => {
  let asks = 0;
  let loads = 0;
  const llmClient = { ask: async () => { asks += 1; return { text: '["LLM инженер", "Python разработчик", "AI / LLM инженер"]' }; } };
  const args = { cacheKey: 'r1', resumeTitle: 'AI / LLM инженер', llmClient, loadResumeText: async () => { loads += 1; return 'резюме'; } };
  const first = await deriveSearchQueries(args);
  assert.deepStrictEqual(first, { queries: ['LLM инженер', 'Python разработчик'], fresh: true });
  const second = await deriveSearchQueries(args);
  assert.deepStrictEqual(second, { queries: ['LLM инженер', 'Python разработчик'], fresh: false });
  assert.strictEqual(asks, 1);
  assert.strictEqual(loads, 1);
});

test('после неудачи модель не дёргается каждый круг', async () => {
  let asks = 0;
  const llmClient = { ask: async () => { asks += 1; throw new Error('провайдер занят'); } };
  const args = { cacheKey: 'r2', resumeTitle: 'X', llmClient, loadResumeText: async () => 'резюме' };
  await assert.rejects(deriveSearchQueries(args));
  assert.deepStrictEqual(await deriveSearchQueries(args), { queries: [], fresh: false });
  assert.strictEqual(asks, 1);
});
