import test from 'node:test';import assert from 'node:assert/strict';import {matchRoster} from './matcher.js';
const roster=[{user_id:'1',full_name:'María José Pérez'},{user_id:'2',full_name:'Juan Carlos Gómez'},{user_id:'3',full_name:'Juan David Ruiz'}];
test('normalizes accents and matches names without speaker identification',()=>{assert.equal(matchRoster('maria jose perez',roster)[0].userId,'1')});
test('returns ambiguous first-name matches for manual selection',()=>{assert.deepEqual(matchRoster('juan',roster).map((x)=>x.userId),['2','3'])});
test('does not propose unrelated roster entries',()=>{assert.deepEqual(matchRoster('presente',roster),[])});