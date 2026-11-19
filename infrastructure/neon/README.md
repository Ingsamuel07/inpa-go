# Neon PostgreSQL

Provision one Neon Postgres project and select a region near UNINPAHU and the Vercel function region. Never put credentials in the repository or chat.

## Separate runtime roles

The migration creates `NOLOGIN` privilege groups. Create distinct Neon login roles and grant each login role membership only in its corresponding group:

- `inpago_auth_app` -> Auth Service; its secret is `AUTH_DATABASE_URL`.
- `inpago_user_app` -> User Service; `USER_DATABASE_URL`.
- `inpago_academic_app` -> Academic Service; `ACADEMIC_DATABASE_URL`.
- `inpago_attendance_app` -> Attendance Service; `ATTENDANCE_DATABASE_URL`.
- `inpago_location_app` -> Location Service; `LOCATION_DATABASE_URL`.
- `inpago_import_app` -> Import Service; `IMPORT_DATABASE_URL`.

Use a separate migration/admin connection as `NEON_MIGRATION_DATABASE_URL`; never configure it on deployed services. Report and voice services read data through service APIs and do not connect to the database.

## Migration

After creating the Neon project, set `NEON_MIGRATION_DATABASE_URL` in the local shell and run `npm run db:migrate`. The runner records versions and serializes runs with a transaction lock. Inspect the target database before the first run. No Neon project has been connected and no migration has been applied yet.