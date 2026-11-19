function normalize(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSimilarity(left, right) {
  const a = new Set(left.split(' '));
  const b = new Set(right.split(' '));
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((token) => b.has(token)).length;
  return (2 * common) / (a.size + b.size);
}

export function matchStudents(transcript, students) {
  const normalizedTranscript = normalize(transcript);
  if (!normalizedTranscript) return [];
  return students
    .map((student) => ({ student, score: tokenSimilarity(normalizedTranscript, normalize(student.name)) }))
    .filter(({ score }) => score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map(({ student, score }) => ({ ...student, score }));
}