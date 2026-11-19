import ExcelJS from 'exceljs';
import { z } from 'zod';

const userRowSchema = z.object({
  fullName: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(180),
  email: z.string().trim().email('Correo institucional inválido').max(254),
  institutionalCode: z.string().trim().min(2, 'Código institucional inválido').max(50),
  role: z.enum(['student', 'teacher', 'admin'], { message: 'El rol debe ser student, teacher o admin' }),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

const courseRowSchema = z.object({
  code: z.string().trim().min(1, 'Código de materia requerido').max(40),
  name: z.string().trim().min(2, 'Nombre de materia requerido').max(180),
});

export async function parseExcelBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  
  const records = [];
  const errors = [];

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('El archivo Excel no contiene ninguna hoja válida.');
  }

  // Detect headers in row 1
  const headers = {};
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const text = String(cell.value || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents
    if (text.includes('nombre') || text.includes('name')) headers.fullName = colNumber;
    else if (text.includes('correo') || text.includes('email')) headers.email = colNumber;
    else if (text.includes('codigo') || text.includes('code')) headers.institutionalCode = colNumber;
    else if (text.includes('rol') || text.includes('role') || text.includes('tipo')) headers.role = colNumber;
    else if (text.includes('clave') || text.includes('pass') || text.includes('contrasena')) headers.password = colNumber;
    else if (text.includes('materia') || text.includes('asignatura')) headers.courseName = colNumber;
  });

  // Iterate rows starting from row 2
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const getVal = (col) => {
      if (!col) return '';
      const cellVal = row.getCell(col).value;
      if (cellVal && typeof cellVal === 'object' && cellVal.text) return String(cellVal.text).trim();
      return cellVal ? String(cellVal).trim() : '';
    };

    const fullName = getVal(headers.fullName || 1);
    const email = getVal(headers.email || 2);
    const institutionalCode = getVal(headers.institutionalCode || 3);
    let role = getVal(headers.role || 4).toLowerCase();
    const password = getVal(headers.password || 5);

    if (!fullName && !email && !institutionalCode) return; // empty row

    if (role === 'estudiante' || role === 'alumno') role = 'student';
    if (role === 'docente' || role === 'profesor') role = 'teacher';
    if (role === 'administrador') role = 'admin';
    if (!role) role = 'student'; // default to student

    const parsed = userRowSchema.safeParse({ fullName, email, institutionalCode, role, password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          rowNumber,
          fieldName: issue.path.join('.'),
          errorCode: 'SCHEMA_VALIDATION',
          message: issue.message,
        });
      }
    } else {
      records.push({ rowNumber, ...parsed.data });
    }
  });

  return { records, errors, totalRows: records.length + errors.length };
}

export async function processImportRecords({ records, token, userServiceUrl }) {
  const successes = [];
  const errors = [];

  for (const record of records) {
    try {
      const endpoint = record.role === 'teacher' ? '/teachers' : (record.role === 'admin' ? '/admins' : '/students');
      const response = await fetch(new URL(endpoint, userServiceUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fullName: record.fullName,
          email: record.email,
          institutionalCode: record.institutionalCode,
          password: record.password,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        errors.push({
          rowNumber: record.rowNumber,
          fieldName: 'email',
          errorCode: data?.error?.code || 'IMPORT_API_ERROR',
          message: data?.error?.message || `Fallo al crear usuario en la fila ${record.rowNumber}`,
        });
      } else {
        successes.push({ rowNumber: record.rowNumber, id: data.id, email: record.email });
      }
    } catch (err) {
      errors.push({
        rowNumber: record.rowNumber,
        fieldName: 'service',
        errorCode: 'NETWORK_ERROR',
        message: err.message || 'Error comunicándose con el servicio de usuarios',
      });
    }
  }

  return { successes, errors };
}
