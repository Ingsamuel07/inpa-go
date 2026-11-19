import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseExcelBuffer } from './excel-processor.js';

test('requires a provided password for every imported user', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Usuarios');
  sheet.addRow(['Nombre Completo', 'Correo Institucional', 'Código Institucional', 'Rol', 'Contraseña']);
  sheet.addRow(['Estudiante Uno', 'estudiante@example.edu', 'EST-001', 'estudiante', '']);
  sheet.addRow(['Docente Uno', 'docente@example.edu', 'DOC-001', 'docente', 'ProvidedPass!']);

  const { records, errors } = await parseExcelBuffer(Buffer.from(await workbook.xlsx.writeBuffer()));

  assert.equal(records.length, 1);
  assert.equal(records[0].email, 'docente@example.edu');
  assert.equal(records[0].password, 'ProvidedPass!');
  assert.ok(errors.some((error) => error.rowNumber === 2 && error.fieldName === 'password'));
});
