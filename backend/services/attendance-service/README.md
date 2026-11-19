# Attendance Service

Posee sesiones e historial. Un registro solo puede confirmarse para una sesión abierta y por el docente responsable. La restricción única `(session_id, student_user_id)` evita duplicados; la inserción condicionada por `status = open` protege contra carreras al cerrar sesiones. El estudiante consulta únicamente su historial autenticado.