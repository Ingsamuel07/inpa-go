import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AudioWaveVisualizer from './audio-wave-visualizer.js';
import { speak } from './tts-helper.js';

// Normalizador fonético local (cero costo, sin tokens)
function normalizeName(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export default function AttendanceVoicePanelWeb({ sessionId, students = [], onConfirmStudent }) {
  // Mode: 'single' (manual trigger) | 'automatic' (auto calling list student by student)
  const [callingMode, setCallingMode] = useState('single'); 
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // States for automated sequential roll-call (Llamado a lista uno por uno)
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [autoStatus, setAutoStatus] = useState('idle'); // 'idle' | 'calling' | 'listening' | 'finished'
  const autoTimeoutRef = useRef(null);
  const recognitionRef = useRef(null);
  const isAutoRunningRef = useRef(false);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  function stopAll() {
    isAutoRunningRef.current = false;
    if (autoTimeoutRef.current) clearTimeout(autoTimeoutRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
    setListening(false);
    setAutoStatus('idle');
    setCurrentIndex(-1);
  }

  // ============================================================================
  // FLUIDO 1: LLAMADO A LISTA AUTOMÁTICO UNO POR UNO (El profe llama, si dice presente -> presente, si no -> ausente)
  // ============================================================================
  async function startAutomaticRollCall() {
    if (!students || students.length === 0) {
      setMessage('No hay estudiantes en el grupo para llamar a lista.');
      return;
    }
    stopAll();
    isAutoRunningRef.current = true;
    setAutoStatus('calling');
    setMessage('Iniciando llamado a lista automatizado...');
    callStudentAtIndex(0);
  }

  async function callStudentAtIndex(index) {
    if (!isAutoRunningRef.current) return;

    if (index >= students.length) {
      setAutoStatus('finished');
      isAutoRunningRef.current = false;
      speak('Llamado a lista finalizado.');
      setMessage('✅ Llamado a lista completado para todos los estudiantes.');
      return;
    }

    const currentStudent = students[index];
    setCurrentIndex(index);
    setAutoStatus('calling');
    setTranscript('');
    setMessage(`Llamando a: ${currentStudent.name}...`);

    // El sistema dice el nombre del estudiante en voz alta
    await speak(`${currentStudent.name}`);

    if (!isAutoRunningRef.current) return;

    // Abrir micrófono por 4 segundos para esperar "Presente"
    startListeningForStudent(index, currentStudent);
  }

  function startListeningForStudent(index, student) {
    if (!isAutoRunningRef.current) return;

    const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognition) {
      setMessage('Tu navegador no soporta micrófono web. Usa Google Chrome o Microsoft Edge.');
      return;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }

      let answeredPresent = false;
      const recognition = new SpeechRecognition();
      recognition.lang = 'es-CO';
      recognition.interimResults = true;
      recognition.continuous = false;

      recognition.onstart = () => {
        setListening(true);
        setAutoStatus('listening');
        setMessage(`🎤 Esperando respuesta de ${student.name.split(' ')[0]}... (Di "Presente")`);
      };

      recognition.onresult = (event) => {
        const text = normalizeName(event.results[0][0].transcript);
        setTranscript(event.results[0][0].transcript);

        // Si dice presente, acá, si, etc.
        if (text.includes('presente') || text.includes('aca') || text.includes('aqui') || text.includes('si')) {
          answeredPresent = true;
        }
      };

      recognition.onend = async () => {
        setListening(false);
        if (!isAutoRunningRef.current) return;

        if (answeredPresent) {
          setMessage(`✅ ${student.name}: Presente`);
          if (onConfirmStudent) await onConfirmStudent(student, 'present');
          await speak(`Presente.`);
        } else {
          setMessage(`❌ ${student.name}: Ausente`);
          if (onConfirmStudent) await onConfirmStudent(student, 'absent');
          await speak(`Ausente.`);
        }

        // Pasar al siguiente estudiante después de 1 segundo de pausa
        if (isAutoRunningRef.current) {
          autoTimeoutRef.current = setTimeout(() => {
            callStudentAtIndex(index + 1);
          }, 1200);
        }
      };

      recognition.onerror = () => {
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();

      // Temporizador de gracia: si nadie habla en 4 segundos, se considera ausente
      autoTimeoutRef.current = setTimeout(() => {
        if (isAutoRunningRef.current && recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
        }
      }, 4500);

    } catch (e) {
      setMessage(`Aviso del micrófono: ${e.message}`);
    }
  }

  // ============================================================================
  // FLUIDO 2: HABLAR POR MICRÓFONO INDIVIDUAL / LIBRE
  // ============================================================================
  function startSingleSpeech() {
    setMessage('');
    const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognition) {
      setMessage('Navegador no compatible con reconocimiento web.');
      return;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
      const recognition = new SpeechRecognition();
      recognition.lang = 'es-CO';
      recognition.interimResults = true;
      recognition.continuous = false;

      recognition.onstart = () => {
        setListening(true);
        setMessage('Escuchando... Di el nombre del estudiante');
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognition.onresult = async (event) => {
        const text = event.results[0][0].transcript;
        setTranscript(text);
        if (event.results[0].isFinal && text.trim()) {
          // Buscar estudiante en la lista
          const clean = normalizeName(text);
          const found = students.find((s) => {
            const sn = normalizeName(s.name);
            return sn.includes(clean) || clean.includes(sn.split(' ')[0]);
          });

          if (found) {
            setMessage(`¡Detectado! Marcando Presente para ${found.name}`);
            if (onConfirmStudent) await onConfirmStudent(found, 'present');
            speak(`Presente: ${found.name}`);
          } else {
            setMessage(`No se encontró "${text}" en la lista de alumnos.`);
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      setMessage(e.message);
    }
  }

  const currentStudentObj = currentIndex >= 0 && currentIndex < students.length ? students[currentIndex] : null;

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

      {/* Visual Indicator of Current Student being called */}
      {currentStudentObj && autoStatus !== 'idle' && (
        <View style={styles.currentCallCard}>
          <Text style={styles.currentCallBadge}>
            Llamando ({currentIndex + 1} de {students.length}):
          </Text>
          <Text style={styles.currentCallName}>{currentStudentObj.name}</Text>
          <Text style={styles.currentCallCode}>Cód: {currentStudentObj.code || 'N/A'}</Text>
          <Text style={styles.currentCallHelp}>
            {autoStatus === 'calling' ? '🗣️ Nombrando al estudiante...' : '👂 Escuchando respuesta... Di "Presente"'}
          </Text>
        </View>
      )}

      {/* Controls */}
      <View style={styles.buttonRow}>
        {autoStatus === 'idle' || autoStatus === 'finished' ? (
          <Pressable style={styles.autoButton} onPress={startAutomaticRollCall}>
            <Text style={styles.autoButtonText}>
              ▶ Iniciar Llamado a Lista Automático (Uno por Uno)
            </Text>
          </Pressable>
        ) : (
          <Pressable style={styles.stopButton} onPress={stopAll}>
            <Text style={styles.stopButtonText}>⏹ Detener Llamado a Lista</Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.singleButton, listening && styles.singleButtonActive]}
          onPress={listening ? stopAll : startSingleSpeech}
        >
          <Text style={styles.singleButtonText}>
            {listening ? '⏹ Detener Mic' : '🎤 Llamar a un Estudiante Directo'}
          </Text>
        </Pressable>
      </View>

      {/* Feedback Messages */}
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
