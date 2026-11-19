import test from 'node:test';
import assert from 'node:assert/strict';
import { matchStudents } from './match-students.js';

const students = [{ id: '1', name: 'María José Pérez' }, { id: '2', name: 'Juan Carlos Gómez' }];

test('matches accented names independent of accent and case', () => {
  assert.equal(matchStudents('maria jose perez', students)[0].id, '1');
});

test('returns ambiguous partial matches for manual teacher confirmation', () => {
  assert.equal(matchStudents('juan', students)[0].id, '2');
});

test('returns no candidate for unrelated speech', () => {
  assert.deepEqual(matchStudents('presente', students), []);
});