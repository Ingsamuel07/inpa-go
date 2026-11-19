const DOMAIN = 'uninpahu.edu.co';
const TITLES = new Set(['prof', 'profesor', 'profesora', 'dr', 'dra', 'doctor', 'doctora', 'ing', 'lic']);

function emailPart(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function institutionalEmailBase(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (TITLES.has(emailPart(parts[0] || ''))) parts.shift();
  const firstName = emailPart(parts[0] || '');
  const surname = emailPart(parts[parts.length - 1] || '');
  if (!firstName || !surname) {
    throw Object.assign(new Error('El nombre no permite generar un correo institucional.'), {
      status: 400,
      code: 'INVALID_NAME',
    });
  }
  return `${firstName}.${surname}@${DOMAIN}`;
}

export async function generateUniqueInstitutionalEmail(fullName, isTaken) {
  const base = institutionalEmailBase(fullName);
  const [localPart, domain] = base.split('@');
  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    const email = `${localPart}${suffix === 1 ? '' : suffix}@${domain}`;
    if (!await isTaken(email)) return email;
  }
  throw Object.assign(new Error('No fue posible asignar un correo institucional único.'), {
    status: 409,
    code: 'EMAIL_COLLISION_LIMIT',
  });
}
