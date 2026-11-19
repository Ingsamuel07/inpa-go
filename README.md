# Inpa_Go

Inicio desde cero de la aplicación de asistencia académica UNINPAHU, guiado por la ERS IEEE 830 incluida en esta carpeta.

## Implementado como base

- `frontend/`: Expo SDK 58, Expo Router, pantallas iniciales por rol, login, llamadas autenticadas, biometría local, flujo docente de lista/confirmación manual/ubicación e historial de estudiante.
- `backend/api-gateway/`: gateway REST Express.
- `backend/services/`: servicios iniciales Node.js para Auth, Users, Academic, Attendance, Voice, Location y Report.
- `infrastructure/neon/`: esquema PostgreSQL y migración inicial.
- `docs/`: arquitectura y estado real por requisito.

El código usa Neon cuando se configuran las variables de entorno y se aplican las migraciones. Se quitaron los accesos y datos demo para no presentar datos ficticios como reales. Revisa `docs/traceability.md` antes de dar funcionalidades por terminadas.

El panel del admin genera correos para estudiantes y docentes usando `nombre.apellido@uninpahu.edu.co`; el backend asigna un sufijo numérico cuando el correo ya existe. Las escrituras de negocio pueden quedar en una cola local (máximo 20; cada operación JSON hasta 1.800 bytes) y se sincronizan al recuperar conexión con la misma cuenta institucional. Los check-in y la validación GPS, el acceso/registro y el cambio de contraseña requieren conexión. Excel puede quedar en cola hasta 1 MB de contenido base64. En móvil la cola usa almacenamiento seguro del dispositivo; en web usa `localStorage`, así que no uses una sesión administrativa en un equipo compartido.

## Requisitos locales

Node.js 22.13 o superior y npm. No guardes secretos en Git. `.env.example` enumera las variables requeridas por cada servicio. Las migraciones no se ejecutan automáticamente.

## Neon, Vercel y EAS

Para una publicación real:

1. Crea el proyecto de Neon y aplica las migraciones con `NEON_MIGRATION_DATABASE_URL`; luego crea el administrador inicial con `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_CODE` y `BOOTSTRAP_ADMIN_NAME`. No configures la URL de migración en los servicios desplegados.
2. Despliega el gateway y los microservicios en un proveedor con HTTPS. Configura los secretos de base de datos y JWT por servicio; en el gateway configura todas las URLs internas y `CORS_ORIGINS` con el origen HTTPS exacto del frontend. La migración `0002_offline_idempotency` evita altas duplicadas en reintentos.
3. En Vercel configura `EXPO_PUBLIC_API_URL` para el frontend web. En Expo/EAS configura la misma URL HTTPS en los entornos `preview` y `production`. No uses `localhost` en una app publicada.
4. Vincula EAS desde `frontend` con `npx eas-cli@latest login` y `npx eas-cli@latest init`. Los identificadores de tienda son `co.edu.uninpago`. En EAS agrega la URL pública del API al entorno de producción y construye con `npx eas-cli@latest build --platform all --profile production`.
5. Antes del build móvil instala la voz TTS con `npx expo install expo-speech` desde `frontend`. El reconocimiento usa `expo-speech-recognition`; requiere un build nativo, no Expo Go. Para publicar se necesitan cuentas de Google Play y Apple Developer, certificados de firma y una política de privacidad pública que explique el uso de ubicación, micrófono y datos académicos.

Los valores secretos se guardan en Neon/Vercel/EAS o en el entorno local: nunca los envíes por el chat ni los subas a Git. El archivo `frontend/.env.example` es solo para desarrollo local.