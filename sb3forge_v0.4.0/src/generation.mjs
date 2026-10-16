const NUMBER_PATTERN = /(?<![\w.])-?\d+(?:\.\d+)?/g;

function normalizedInstruction(text) {
  return text.replace(NUMBER_PATTERN, '#').replace(/\s+/g, '');
}

function grams(text) {
  const source = normalizedInstruction(text);
  const counts = new Map();
  for (const size of [2, 3]) {
    for (let index = 0; index + size <= source.length; index++) {
      const gram = source.slice(index, index + size);
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
  }
  return counts;
}

function makeVector(counts, idf) {
  const values = new Map();
  let squaredNorm = 0;
  for (const [gram, count] of counts) {
    const weight = count * (idf.get(gram) ?? 1);
    values.set(gram, weight);
    squaredNorm += weight * weight;
  }
  return { values, norm: Math.sqrt(squaredNorm) || 1 };
}

function cosine(left, right) {
  const smaller = left.values.size < right.values.size ? left : right;
  const larger = smaller === left ? right : left;
  let dotProduct = 0;
  for (const [gram, value] of smaller.values) {
    const other = larger.values.get(gram);
    if (other) dotProduct += value * other;
  }
  return dotProduct / (left.norm * right.norm);
}

function numericTokens(text) {
  return text.match(NUMBER_PATTERN) ?? [];
}

function swapNumbers(code, sourceNumbers, queryNumbers) {
  if (sourceNumbers.length !== queryNumbers.length) {
    return { code, swapped: false };
  }

  const replacements = new Map();
  sourceNumbers.forEach((value, index) => {
    if (!replacements.has(value)) replacements.set(value, queryNumbers[index]);
  });

  return {
    code: code.replace(/(?<![\w."])-?\d+(?:\.\d+)?(?![\w."])/g, (value) => replacements.get(value) ?? value),
    swapped: true
  };
}

export function createSearchIndex(tasks) {
  const train = tasks.filter((task) => task.split === 'train');
  const documents = train.map((task) => grams(task.instruction_ja || ''));
  const documentFrequency = new Map();

  for (const document of documents) {
    for (const gram of document.keys()) {
      documentFrequency.set(gram, (documentFrequency.get(gram) || 0) + 1);
    }
  }

  const idf = new Map(
    [...documentFrequency].map(([gram, count]) => [
      gram,
      Math.log((1 + documents.length) / (1 + count)) + 1
    ])
  );

  return {
    train,
    vectors: documents.map((document) => makeVector(document, idf)),
    idf
  };
}

export function findNearest(instruction, index) {
  if (!index?.train?.length) {
    throw new Error('基礎データが読み込まれていません。');
  }

  const queryVector = makeVector(grams(instruction), index.idf);
  let bestIndex = 0;
  let bestScore = -1;

  index.vectors.forEach((vector, position) => {
    const score = cosine(queryVector, vector);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = position;
    }
  });

  const source = index.train[bestIndex];
  const fromNumbers = numericTokens(source.instruction_ja || '');
  const toNumbers = numericTokens(instruction);
  const swapped = swapNumbers(source.text, fromNumbers, toNumbers);

  return {
    source,
    score: Math.max(0, bestScore),
    dsl: swapped.code,
    numbersSwapped: swapped.swapped,
    queryNumbers: toNumbers.length,
    sourceNumbers: fromNumbers.length
  };
}
