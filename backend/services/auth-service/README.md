# Auth Service

Owns credentials, account roles, and sessions. Login accepts only active, provisioned accounts; public registration is disabled. Password hashes use bcrypt, access JWTs last 15 minutes, and random refresh tokens are stored as SHA-256 hashes.

Required environment: `AUTH_DATABASE_URL`, `JWT_ACCESS_SECRET` (at least 32 characters), and `AUTH_INTERNAL_TOKEN` (at least 32 characters). Routes: `GET /health`, `POST /login`, `POST /refresh`, `POST /logout`, plus internal account-management routes protected by the shared secret.