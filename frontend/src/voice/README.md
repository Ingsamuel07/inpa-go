# Reconocimiento de voz

Usa `expo-speech-recognition` con permiso explícito. El audio no se almacena ni se envía al backend desde este módulo; la transcripción se compara con el listado recibido por props. El resultado siempre queda como sugerencia y exige selección/confirmación docente. La coincidencia no prueba identidad del hablante.

La biblioteca nativa exige un development build de Expo; Expo Go no basta para validar micrófono y reconocimiento. Android 12 y anteriores no admiten reconocimiento continuo, por eso se configura una captura por frase.