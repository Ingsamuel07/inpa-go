import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AudioWaveVisualizer from './audio-wave-visualizer.js';
import { speak } from './tts-helper.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function getErrorMessage(error) {
  if (error?.code === 'speech-module-unavailable') {
    return 'El reconocimiento de voz requiere instalar la app con un build nativo; no está disponible en Expo Go.';
  }
  return error?.message || 'No fue posible iniciar el reconocimiento de voz.';
}

export default function AttendanceVoicePanelNative({ students = [], onConfirmStudent }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [message, setMessage] = useState('');
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [autoStatus, setAutoStatus] = useState('idle');
  const moduleRef = useRef(null);
  const permissionGrantedRef = useRef(false);
  const listenersRef = useRef([]);
  const studentsRef = useRef(students);
  const confirmRef = useRef(onConfirmStudent);
  const modeRef = useRef('idle');
  const autoRunningRef = useRef(false);
  const transcriptRef = useRef('');
  const recognitionErrorRef = useRef(null);
  const singleHandledRef = useRef(false);
  const currentIndexRef = useRef(-1);
  const sequenceTimeoutRef = useRef(null);
  const responseTimeoutRef = useRef(null);

  studentsRef.current = students;
  confirmRef.current = onConfirmStudent;

  useEffect(() => () => {
    autoRunningRef.current = false;
    modeRef.current = 'idle';
    clearTimeout(sequenceTimeoutRef.current);
    clearTimeout(responseTimeoutRef.current);
    if (moduleRef.current) {
      try {
        moduleRef.current.abort();
      } catch {}
    }
    listenersRef.current.forEach((listener) => listener.remove());
  }, []);

  async function getSpeechModule() {
    if (!moduleRef.current) {
      let loaded;
      try {
        loaded = await import('expo-speech-recognition');
      } catch {
        const error = new Error('El módulo nativo de voz no está instalado.');
        error.code = 'speech-module-unavailable';
        throw error;
      }

      const speechModule = loaded.ExpoSpeechRecognitionModule;
      if (
        !speechModule ||
        typeof speechModule.requestPermissionsAsync !== 'function' ||
        typeof speechModule.start !== 'function' ||
        typeof speechModule.addListener !== 'function'
      ) {
        const error = new Error('El módulo nativo de voz no está disponible en esta instalación.');
        error.code = 'speech-module-unavailable';
        throw error;
      }

      moduleRef.current = speechModule;
      attachListeners(speechModule);
    }

    if (!permissionGrantedRef.current) {
      const permission = await moduleRef.current.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Autoriza el uso del micrófono y del reconocimiento de voz en el dispositivo.');
      }
      permissionGrantedRef.current = true;
    }
    return moduleRef.current;
  }

  function attachListeners(speechModule) {
    listenersRef.current = [
      speechModule.addListener('start', () => {
        setListening(true);
        if (modeRef.current === 'automatic') {
          setAutoStatus('listening');
        }
      }),
      speechModule.addListener('result', (event) => {
        const recognized = (event.results || [])
          .map((result) => result.transcript)
          .filter(Boolean)
          .join(' ')
          .trim();
        if (!recognized) return;

        const currentTranscript = [transcriptRef.current, recognized].filter(Boolean).join(' ');
        setTranscript(currentTranscript);

        if (event.isFinal) {
          transcriptRef.current = currentTranscript;
          if (modeRef.current === 'single' && !singleHandledRef.current) {
            handleSingleResult(currentTranscript);
          }
        }
      }),
      speechModule.addListener('error', (event) => {
        if (event.error !== 'aborted') {
          recognitionErrorRef.current = event;
          setMessage(event.message || 'No se pudo escuchar la respuesta.');
        }
      }),
      speechModule.addListener('end', () => {
        setListening(false);
        clearTimeout(responseTimeoutRef.current);
        if (modeRef.current === 'automatic' && autoRunningRef.current) {
          finishAutomaticCall();
        } else if (modeRef.current === 'single') {
          modeRef.current = 'idle';
        }
      }),
    ];
  }

  async function handleSingleResult(text) {
    const normalized = normalizeText(text);
    if (!normalized) return;
    const match = studentsRef.current.find((student) => {
      const normalizedName = normalizeText(student.name);
      return normalizedName.includes(normalized) || normalized.includes(normalizedName.split(' ')[0]);
    });

    if (!match) {
      setMessage(`No se encontró "${text}" en la lista de estudiantes.`);
      return;
    }

    singleHandledRef.current = true;
    modeRef.current = 'idle';
    moduleRef.current?.stop();
    setMessage(`¡Detectado! Marcando presente a ${match.name}.`);
    try {
      await confirmRef.current?.(match, 'present');
      speak(`Presente: ${match.name}`);
    } catch (error) {
      setMessage(error?.message || `No se pudo marcar presente a ${match.name}.`);
    }
  }

  async function startRecognition(mode) {
    const speechModule = await getSpeechModule();
    modeRef.current = mode;
    transcriptRef.current = '';
    recognitionErrorRef.current = null;
    singleHandledRef.current = false;
    setTranscript('');
    setMessage(mode === 'single' ? 'Escuchando... di el nombre del estudiante.' : 'Escuchando respuesta... di "Presente".');

    speechModule.start({
      lang: 'es-CO',
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      contextualStrings: studentsRef.current.map((student) => student.name).filter(Boolean),
    });

    responseTimeoutRef.current = setTimeout(() => {
      if (modeRef.current === mode) {
        try {
          speechModule.stop();
        } catch {}
      }
    }, mode === 'automatic' ? 4500 : 12000);
  }

  async function startAutomaticRollCall() {
    if (!studentsRef.current.length) {
      setMessage('No hay estudiantes en el grupo para llamar a lista.');
      return;
    }

    stopAll();
    try {
      await getSpeechModule();
      autoRunningRef.current = true;
      setAutoStatus('calling');
      setMessage('Iniciando llamado a lista automatizado...');
      callStudentAtIndex(0);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  async function callStudentAtIndex(index) {
    if (!autoRunningRef.current) return;
    if (index >= studentsRef.current.length) {
      autoRunningRef.current = false;
      modeRef.current = 'idle';
      setAutoStatus('finished');
      setCurrentIndex(-1);
      speak('Llamado a lista finalizado.');
      setMessage('Llamado a lista completado para todos los estudiantes.');
      return;
    }

    currentIndexRef.current = index;
    setCurrentIndex(index);
    setAutoStatus('calling');
    setTranscript('');
    transcriptRef.current = '';
    setMessage(`Llamando a: ${studentsRef.current[index].name}...`);
    try {
      const voiceAvailable = await speak(studentsRef.current[index].name);
      if (!voiceAvailable) {
        autoRunningRef.current = false;
        modeRef.current = 'idle';
        setAutoStatus('idle');
        setMessage('La voz de llamado no está disponible. Instala expo-speech y genera un build nativo para usar el llamado automático.');
        return;
      }
    } catch (error) {
      autoRunningRef.current = false;
      modeRef.current = 'idle';
      setAutoStatus('idle');
      setMessage(error?.message || 'No se pudo reproducir el nombre del estudiante.');
      return;
    }

    const nameLength = studentsRef.current[index].name.split(/\s+/).length;
    sequenceTimeoutRef.current = setTimeout(() => {
      if (!autoRunningRef.current) return;
      startRecognition('automatic').catch((error) => {
        autoRunningRef.current = false;
        modeRef.current = 'idle';
        setAutoStatus('idle');
        setMessage(getErrorMessage(error));
      });
    }, Math.min(2400, Math.max(1000, nameLength * 350)));
  }

  async function finishAutomaticCall() {
    const recognitionError = recognitionErrorRef.current;
    recognitionErrorRef.current = null;
    if (
      recognitionError &&
      recognitionError.error !== 'no-speech' &&
      recognitionError.error !== 'speech-timeout'
    ) {
      autoRunningRef.current = false;
      modeRef.current = 'idle';
      setAutoStatus('idle');
      setMessage(getErrorMessage(recognitionError));
      return;
    }

    const student = studentsRef.current[currentIndexRef.current];
    if (!student) return;
    const response = normalizeText(transcriptRef.current);
    const isPresent = ['presente', 'aqui', 'aca', 'si', 'estoy'].some((word) => response.includes(word));
    const status = isPresent ? 'present' : 'absent';
    const label = isPresent ? 'Presente' : 'Ausente';

    modeRef.current = 'idle';
    setMessage(`${student.name}: ${label}.`);
    try {
      await confirmRef.current?.(student, status);
      speak(label);
    } catch (error) {
      setMessage(error?.message || `No se pudo registrar la asistencia de ${student.name}.`);
      autoRunningRef.current = false;
      setAutoStatus('idle');
      return;
    }

    const nextIndex = currentIndexRef.current + 1;
    sequenceTimeoutRef.current = setTimeout(() => callStudentAtIndex(nextIndex), 1200);
  }

  async function startSingleSpeech() {
    if (listening) {
      stopAll();
      return;
    }
    if (autoRunningRef.current) stopAll();
    try {
      await startRecognition('single');
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  function stopAll() {
    autoRunningRef.current = false;
    modeRef.current = 'idle';
    clearTimeout(sequenceTimeoutRef.current);
    clearTimeout(responseTimeoutRef.current);
    setListening(false);
    setAutoStatus('idle');
    setCurrentIndex(-1);
    try {
      moduleRef.current?.abort();
    } catch {}
  }

  const currentStudent = currentIndex >= 0 ? students[currentIndex] : null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>🎙️ Llamado Inteligente por Voz Automatizado</Text>
          <Text style={styles.copy}>
            El docente inicia el llamado: el sistema nombra al estudiante en audio, si responde <Text style={{ fontWeight: 'bold' }}>"Presente"</Text> se marca presente; si no responde a tiempo, se marca <Text style={{ fontWeight: 'bold' }}>Ausente</Text> automáticamente.
          </Text>
        </View>
      </View>

      <AudioWaveVisualizer active={listening} />

      {currentStudent && autoStatus !== 'idle' && autoStatus !== 'finished' && (
        <View style={styles.currentCallCard}>
          <Text style={styles.currentCallBadge}>
            Llamando ({currentIndex + 1} de {students.length}):
          </Text>
          <Text style={styles.currentCallName}>{currentStudent.name}</Text>
          <Text style={styles.currentCallCode}>Cód: {currentStudent.code || 'N/A'}</Text>
          <Text style={styles.currentCallHelp}>
            {autoStatus === 'calling' ? '🗣️ Nombrando al estudiante...' : '👂 Escuchando respuesta... Di "Presente"'}
          </Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        {autoStatus === 'idle' || autoStatus === 'finished' ? (
          <Pressable style={styles.autoButton} onPress={startAutomaticRollCall}>
            <Text style={styles.autoButtonText}>▶ Iniciar Llamado a Lista Automático (Uno por Uno)</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.stopButton} onPress={stopAll}>
            <Text style={styles.stopButtonText}>⏹ Detener Llamado a Lista</Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.singleButton, listening && styles.singleButtonActive]}
          onPress={startSingleSpeech}
        >
          <Text style={styles.singleButtonText}>
            {listening ? '⏹ Detener Mic' : '🎤 Llamar a un Estudiante Directo'}
          </Text>
        </Pressable>
      </View>

      {!!transcript && (
        <View style={styles.transcriptContainer}>
          <Text style={styles.transcriptLabel}>Audio detectado en micrófono:</Text>
          <Text style={styles.transcript}>“{transcript}”</Text>
        </View>
      )}

      {!!message && (
        <View style={styles.messageBox}>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  heading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#07152F',
    marginBottom: 4,
  },
  copy: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  currentCallCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#F0440B',
    alignItems: 'center',
  },
  currentCallBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F0440B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  currentCallName: {
    fontSize: 19,
    fontWeight: '900',
    color: '#07152F',
    marginTop: 4,
  },
  currentCallCode: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  currentCallHelp: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0284C7',
    marginTop: 8,
    textAlign: 'center',
  },
  buttonRow: {
    marginTop: 14,
    gap: 10,
  },
  autoButton: {
    backgroundColor: '#F0440B',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  autoButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  stopButton: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  singleButton: {
    backgroundColor: '#07152F',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  singleButtonActive: {
    backgroundColor: '#DC2626',
  },
  singleButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
  },
  transcriptContainer: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  transcriptLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  transcript: {
    fontSize: 14,
    color: '#07152F',
    fontStyle: 'italic',
  },
  messageBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 4,
    borderLeftColor: '#F0440B',
  },
  messageText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
});
