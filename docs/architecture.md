# Arquitectura inicial

## Decisiones

- Cliente: React Native con Expo SDK 58 y Expo Router; Android es el objetivo principal de la ERS.
- Backend: JavaScript sobre Node.js 22 y Express 5, con servicios separados por dominio.
- Entrada cliente: API Gateway REST con enrutamiento, límites de petición, validación de origen e identificador de solicitud.
- Persistencia: PostgreSQL en Neon con esquema por dominio y migraciones SQL versionadas. Se usa el driver oficial `@neondatabase/serverless` con consultas parametrizadas. Esta alternativa a Prisma favorece consultas HTTP de corta duración en funciones serverless y conserva la separación explícita de datos por servicio.
- Despliegue: Vercel para gateway/servicios Express de corta duración; cada servicio se despliega como proyecto independiente con su directorio raíz. Expo EAS para builds móviles. Ninguna URL se declara desplegada hasta verificarla.
- Comunicación: REST sobre HTTPS; timeouts, request ID y tokens de usuario validados en cada servicio. Los servicios no consultan tablas ajenas.

## Servicios y propiedad de dominio

| Servicio | Dominio | Datos que posee |
|---|---|---|
| Auth | credenciales, roles básicos, sesiones | `auth.users`, refresh tokens hasheados |
| Users | perfiles institucionales | perfiles de estudiante/docente y administración |
| Academic | asignaturas, grupos, matrículas | `academic.*` |
| Attendance | sesiones y asistencia | `attendance.*` |
| Voice | resolución de texto reconocido | no guarda biometría vocal |
| Location | sedes y validaciones | `location.*` |
| Import | lotes y errores | `imports.*` |
| Report | generación PDF | consulta datos por API; no lee tablas ajenas |
| Gateway | enrutamiento y políticas | no es propietario de datos de negocio |

## Privacidad

El reconocimiento de voz sirve para comparar nombres del listado y siempre requiere confirmación docente ante ambigüedad. No identifica al hablante. La ubicación se solicita solo en el flujo que la necesita y se valida en servidor. La biometría del dispositivo protege el acceso local a la sesión; nunca reemplaza la autenticación del backend.

## Diferencias entre la ERS y la instrucción vigente

La ERS menciona MySQL y navegador en algunas secciones; la instrucción actual del usuario exige PostgreSQL en Neon y app móvil Expo. Se toma la instrucción actual como decisión tecnológica, manteniendo los requisitos funcionales académicos.

## Límite de Vercel

Express puede desplegarse en Vercel como una función serverless. Cada app Express se publica por separado. Procesamiento prolongado de importaciones o colas persistentes necesitaría un worker dedicado; no se introduce hasta que el volumen lo justifique.