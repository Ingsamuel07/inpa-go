import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../auth/auth-context.js';
import { checkInWithGps } from '../location/validate-location.js';

// ─── Animated KPI Card ───────────────────────────────────────────────────────
function KpiCard({ icon, label, value, color, delay = 0 }) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, delay, useNativeDriver: true, damping: 12, stiffness: 180 }),
      Animated.timing(opacity, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[st.kpiCard, { borderTopColor: color, transform: [{ scale }], opacity }]}>
      <Text style={st.kpiIcon}>{icon}</Text>
      <Text style={[st.kpiValue, { color }]}>{value}</Text>
      <Text style={st.kpiLabel}>{label}</Text>
    </Animated.View>
  );
}

// ─── Animated Progress Ring (simulado con arco rectangular) ──────────────────
function AttendanceRing({ pct, color }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct / 100, duration: 900, useNativeDriver: false }).start();
  }, [pct]);

  const fillW = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={st.ringWrap}>
      {/* Outer ring container */}
      <View style={[st.ringOuter, { borderColor: color + '25' }]}>
        <View style={[st.ringInner, { borderColor: color }]}>
          <Text style={[st.ringPct, { color }]}>{pct}%</Text>
          <Text style={st.ringLabel}>Asist.</Text>
        </View>
      </View>
      {/* Bar complementaria */}
      <View style={st.ringBar}>
        <Animated.View style={[st.ringBarFill, { width: fillW, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function StudentDashboard() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState([]);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Header fade-in
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(-20)).current;

  async function loadStudentData() {
    try {
      const [g, h, p, s] = await Promise.all([
        apiRequest('/academic/groups'),
        apiRequest('/attendance/history'),
        apiRequest(`/users/${user.id}`),
        apiRequest('/attendance/stats').catch(() => []),
      ]);
      setGroups(g);
      setHistory(h);
      setProfile(p.profile);
      setStats(s);
    } catch (e) {
      setMessage(e.message);
    }
  }

  useEffect(() => {
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role !== 'student') {
      router.replace(user.role === 'admin' ? '/admin' : '/teacher');
      return;
    }
    // Header animation
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(headerSlide, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
    loadStudentData();
  }, [user, router]);

  async function handleSelectGroup(g) {
    setBusy(true);
    setSelectedGroup(g);
    setMessage('');
    setSuccessMessage('');
    try {
      const s = await apiRequest(`/attendance/sessions?groupId=${encodeURIComponent(g.id)}`);
      setSessions(s);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckInAttendance(session) {
    setBusy(true);
    setMessage('');
    setSuccessMessage('');
    try {
      const result = await checkInWithGps(session.id);
      if (result) {
        setSuccessMessage(
          `¡Asistencia confirmada! Ubicado en ${result.validation?.geofence || 'Sede UNINPAHU'} (${result.validation?.distanceMeters} m del aula).`
        );
        await loadStudentData();
        if (selectedGroup) {
          const s = await apiRequest(`/attendance/sessions?groupId=${encodeURIComponent(selectedGroup.id)}`);
          setSessions(s);
        }
      }
    } catch (e) {
      setMessage(e.message || 'No fue posible registrar la asistencia.');
    } finally {
      setBusy(false);
    }
  }

  if (!user || user.role !== 'student') {
    return (
      <View style={st.center}>
        <ActivityIndicator color="#F0440B" size="large" />
      </View>
    );
  }

  const groupLabels = new Map(groups.map((g) => [g.id, `${g.course_name} (${g.code})`]));

  // KPI aggregates from stats
  const totalPresent = stats.reduce((a, b) => a + (b.present || 0), 0);
  const totalSessions = stats.reduce((a, b) => a + (b.totalSessions || 0), 0);
  const totalAbsent = stats.reduce((a, b) => a + (b.absent || 0), 0);
  const globalPct = totalSessions > 0 ? Math.round((totalPresent / totalSessions) * 100) : (stats[0]?.attendancePercentage ?? null);
  const atRiskCount = stats.filter((s) => s.attendancePercentage < 80).length;
  const hasAttendanceStats = stats.length > 0;
  const globalPctColor = globalPct === null ? '#E2E8F0' : globalPct >= 80 ? '#DCFCE7' : '#FEE2E2';
  const globalPctTextColor = globalPct === null ? '#64748B' : globalPct >= 80 ? '#15803D' : '#B91C1C';

  const statusLabel = (s) =>
    s === 'present' ? 'PRESENTE' : s === 'late' ? 'RETARDO' : s === 'absent' ? 'AUSENTE' : 'EXCUSA';
  const statusBadge = (s) =>
    s === 'present' ? st.badgeGreen : s === 'late' ? st.badgeAmber : s === 'absent' ? st.badgeRed : st.badgePurple;

  return (
    <ScrollView contentContainerStyle={st.page}>
      {/* ── HEADER ANIMADO ── */}
      <Animated.View
        style={[st.header, { opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}
      >
        <View>
          <Image source={require('../../assets/logo.jpg')} style={{ width: 140, height: 40, marginBottom: 6 }} resizeMode="contain" />
          <Text style={st.title}>Portal Estudiantil</Text>
          <Text style={st.subtitle}>
            {profile?.full_name || user.email}  ·  Cód: {profile?.institutional_code || 'S/N'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [st.logoutButton, pressed && { opacity: 0.75 }]}
          onPress={async () => { await signOut(); router.replace('/login'); }}
        >
          <Text style={st.logoutText}>Cerrar Sesión</Text>
        </Pressable>
      </Animated.View>

      {/* ── ALERTAS ── */}
      {!!message && (
        <View style={st.alertBoxError}>
          <Text style={st.alertTextError}>⚠ {message}</Text>
        </View>
      )}
      {!!successMessage && (
        <View style={st.alertBoxSuccess}>
          <Text style={st.alertTextSuccess}>✅ {successMessage}</Text>
        </View>
      )}

      {/* ── BANNER DE BIENVENIDA ── */}
      <View style={st.welcomeBanner}>
        <View style={st.welcomeLeft}>
          <Text style={st.welcomeEmoji}>🎓</Text>
          <View>
            <Text style={st.welcomeHello}>¡Hola, {(profile?.full_name || user.email).split(' ')[0]}!</Text>
            <Text style={st.welcomeSub}>Tu resumen académico UNINPAHU 2026-1</Text>
          </View>
        </View>
        <View style={[st.gpaChip, { backgroundColor: globalPctColor }]}>
          <Text style={[st.gpaText, { color: globalPctTextColor }]}>{globalPct === null ? '—' : `${globalPct}%`}</Text>
          <Text style={[st.gpaLabel, { color: globalPctTextColor }]}>Global</Text>
        </View>
      </View>

      {/* ── KPI CARDS ── */}
      <Text style={st.sectionTitle}>📊 Métricas Rápidas</Text>
      <View style={st.kpiRow}>
        <KpiCard icon="✅" label="Clases Asistidas" value={hasAttendanceStats ? totalPresent : '—'} color="#10B981" delay={0} />
        <KpiCard icon="📅" label="Total Sesiones" value={hasAttendanceStats ? totalSessions : '—'} color="#3B82F6" delay={80} />
        <KpiCard icon="❌" label="Ausencias" value={hasAttendanceStats ? totalAbsent : '—'} color="#EF4444" delay={160} />
        <KpiCard icon="⚠️" label="En Riesgo" value={hasAttendanceStats ? atRiskCount : '—'} color="#F59E0B" delay={240} />
      </View>
      {!hasAttendanceStats && (
        <View style={st.emptyStatsBanner}>
          <Text style={st.emptyStatsTitle}>Tus indicadores aparecerán aquí</Text>
          <Text style={st.emptyStatsText}>Aún no hay asistencias registradas para calcular tus estadísticas.</Text>
        </View>
      )}

      {/* ── ESTADÍSTICAS POR ASIGNATURA ── */}
      <Text style={st.sectionTitle}>📈 Asistencia por Asignatura</Text>
      <View style={st.statsGrid}>
        {stats.map((item, idx) => {
          const isAtRisk = item.attendancePercentage < 80;
          const pctColor = item.attendancePercentage >= 80 ? '#10B981' : item.attendancePercentage >= 70 ? '#F59E0B' : '#EF4444';
          return (
            <View key={item.groupId} style={[st.statCard, isAtRisk && st.statCardRisk]}>
              {isAtRisk && <View style={st.riskBadge}><Text style={st.riskBadgeText}>⚠ RIESGO ACADÉMICO</Text></View>}
              <View style={st.statCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={st.statCourseName}>{item.courseName}</Text>
                  <Text style={st.statCourseCode}>{item.courseCode}  ·  Grupo {item.groupCode}  ·  {item.term}</Text>
                </View>
                <AttendanceRing pct={item.attendancePercentage} color={pctColor} />
              </View>

              {/* Barra de progreso gruesa */}
              <View style={st.progressBarTrack}>
                <View
                  style={[st.progressBarFill, { width: `${Math.min(100, item.attendancePercentage)}%`, backgroundColor: pctColor }]}
                />
                <View style={[st.progressThreshold, { left: '80%' }]} />
              </View>
              <Text style={{ fontSize: 10, color: '#94A3B8', marginBottom: 10 }}>Mínimo requerido: 80%</Text>

              {/* Contadores */}
              <View style={st.statCountersRow}>
                <View style={[st.statChip, { backgroundColor: '#DCFCE7' }]}>
                  <Text style={[st.statChipNum, { color: '#10B981' }]}>{item.present}</Text>
                  <Text style={st.statChipLabel}>Presente</Text>
                </View>
                <View style={[st.statChip, { backgroundColor: '#FEF3C7' }]}>
                  <Text style={[st.statChipNum, { color: '#F59E0B' }]}>{item.late}</Text>
                  <Text style={st.statChipLabel}>Retardo</Text>
                </View>
                <View style={[st.statChip, { backgroundColor: '#FEE2E2' }]}>
                  <Text style={[st.statChipNum, { color: '#EF4444' }]}>{item.absent}</Text>
                  <Text style={st.statChipLabel}>Ausente</Text>
                </View>
                <View style={[st.statChip, { backgroundColor: '#F3E8FF' }]}>
                  <Text style={[st.statChipNum, { color: '#7C3AED' }]}>{item.excused ?? 0}</Text>
                  <Text style={st.statChipLabel}>Excusa</Text>
                </View>
              </View>
            </View>
          );
        })}
        {stats.length === 0 && (
          <View style={st.emptyCard}>
            <Text style={st.emptyCardIcon}>📋</Text>
            <Text style={st.emptyCardText}>No hay asignaturas registradas para este periodo.</Text>
          </View>
        )}
      </View>

      {/* ── ASIGNATURAS INSCRITAS ── */}
      <Text style={st.sectionTitle}>📚 Mis Asignaturas</Text>
      <View style={st.courseList}>
        {groups.map((g) => {
          const isSelected = selectedGroup?.id === g.id;
          const statItem = stats.find((s) => s.groupId === g.id);
          const pct = statItem?.attendancePercentage ?? null;
          return (
            <Pressable
              key={g.id}
              style={({ pressed }) => [st.courseCard, isSelected && st.courseCardSelected, pressed && { opacity: 0.85 }]}
              onPress={() => handleSelectGroup(g)}
            >
              <View style={st.courseCardLeft}>
                <View style={[st.courseIcon, { backgroundColor: isSelected ? '#F0440B' : '#07152F' }]}>
                  <Text style={st.courseIconText}>{(g.course_name || 'M')[0]}</Text>
                </View>
                <View>
                  <Text style={[st.courseTitle, isSelected && st.orange]}>{g.course_name}</Text>
                  <Text style={st.courseDetails}>Cód: {g.course_code}  |  Grupo {g.code}  |  {g.term}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {pct !== null && (
                  <Text style={[st.coursePct, { color: pct >= 80 ? '#10B981' : '#EF4444' }]}>{pct}%</Text>
                )}
                <Text style={st.arrowText}>{isSelected ? '▲' : '▼'}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* ── SESIONES ACTIVAS ── */}
      {selectedGroup && (
        <View style={st.card}>
          <Text style={st.cardTitle}>📡 Sesiones · {selectedGroup.course_name}</Text>
          <Text style={st.cardSubtitle}>
            Si tu docente abrió sesión en el aula, valida tu GPS para confirmar asistencia:
          </Text>

          {sessions.map((s) => {
            const isOpen = s.status === 'open';
            const isPaused = s.status === 'paused';
            return (
              <View key={s.id} style={st.sessionItem}>
                <View style={st.rowBetween}>
                  <Text style={st.sessionDateText}>
                    {new Date(s.starts_at).toLocaleString('es-CO')}
                  </Text>
                  <Text style={[st.badge, isOpen ? st.badgeGreen : isPaused ? st.badgeAmber : st.badgeGray]}>
                    {isOpen ? 'SESIÓN ABIERTA' : isPaused ? 'PAUSADA' : 'CERRADA'}
                  </Text>
                </View>

                {isOpen && (
                  <Pressable
                    style={({ pressed }) => [st.gpsButton, pressed && { opacity: 0.85 }]}
                    onPress={() => handleCheckInAttendance(s)}
                    disabled={busy}
                  >
                    {busy ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={st.gpsButtonText}>📍 Validar GPS y Confirmar Asistencia</Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}
          {sessions.length === 0 && (
            <Text style={st.emptyText}>No hay sesiones creadas aún para este grupo.</Text>
          )}
        </View>
      )}

      {/* ── HISTORIAL DETALLADO ── */}
      <Text style={st.sectionTitle}>🗓 Historial de Asistencia</Text>
      <View style={st.card}>
        {history.map((item) => (
          <View key={item.id} style={st.historyRow}>
            <View style={[st.historyDot, statusBadge(item.status)]} />
            <View style={st.grow}>
              <Text style={st.historyCourse}>{groupLabels.get(item.group_id) || 'Asignatura'}</Text>
              <Text style={st.historyDate}>
                {new Date(item.starts_at).toLocaleDateString('es-CO', {
                  weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                })} · {new Date(item.confirmed_at).toLocaleTimeString('es-CO')}
              </Text>
            </View>
            <Text style={[st.badge, statusBadge(item.status)]}>{statusLabel(item.status)}</Text>
          </View>
        ))}
        {history.length === 0 && (
          <View style={st.emptyCard}>
            <Text style={st.emptyCardIcon}>📂</Text>
            <Text style={st.emptyCardText}>Aún no registras asistencias en la plataforma.</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: {
    padding: 20,
    paddingTop: 36,
    paddingBottom: 60,
    backgroundColor: '#F0F4FA',
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F0F4FA' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '900', color: '#07152F', marginTop: 4 },
  subtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  logoutButton: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: '#FEE2E2',
  },
  logoutText: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },

  // ── Alerts ──
  alertBoxError: {
    backgroundColor: '#FEF2F2', borderLeftWidth: 4, borderLeftColor: '#EF4444',
    padding: 12, borderRadius: 10, marginBottom: 14,
  },
  alertTextError: { color: '#991B1B', fontWeight: '600', fontSize: 13 },
  alertBoxSuccess: {
    backgroundColor: '#F0FDF4', borderLeftWidth: 4, borderLeftColor: '#10B981',
    padding: 12, borderRadius: 10, marginBottom: 14,
  },
  alertTextSuccess: { color: '#065F46', fontWeight: '600', fontSize: 13 },

  // ── Welcome Banner ──
  welcomeBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#07152F',
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    shadowColor: '#07152F',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  welcomeLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  welcomeEmoji: { fontSize: 32 },
  welcomeHello: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  welcomeSub: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  gpaChip: { borderRadius: 14, padding: 10, alignItems: 'center', minWidth: 64 },
  gpaText: { fontSize: 22, fontWeight: '900' },
  gpaLabel: { fontSize: 10, fontWeight: '700' },
  emptyStatsBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    padding: 14,
    marginBottom: 8,
  },
  emptyStatsTitle: { color: '#1E3A8A', fontSize: 13, fontWeight: '800' },
  emptyStatsText: { color: '#64748B', fontSize: 12, marginTop: 4, lineHeight: 18 },

  // ── Section Title ──
  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: '#07152F',
    marginTop: 18, marginBottom: 10,
  },
  orange: { color: '#F0440B' },

  // ── KPI Cards ──
  kpiRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6,
  },
  kpiCard: {
    flex: 1, minWidth: 70,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderTopWidth: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  kpiIcon: { fontSize: 22, marginBottom: 6 },
  kpiValue: { fontSize: 26, fontWeight: '900' },
  kpiLabel: { fontSize: 10, color: '#64748B', fontWeight: '600', textAlign: 'center', marginTop: 2 },

  // ── Stat Cards ──
  statsGrid: { marginBottom: 6 },
  statCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#07152F', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  statCardRisk: { borderColor: '#FECACA', borderWidth: 1.5 },
  riskBadge: {
    backgroundColor: '#FEE2E2', paddingVertical: 4, paddingHorizontal: 10,
    borderRadius: 6, alignSelf: 'flex-start', marginBottom: 10,
  },
  riskBadgeText: { color: '#B91C1C', fontSize: 10, fontWeight: '800' },
  statCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  statCourseName: { fontSize: 15, fontWeight: '800', color: '#07152F' },
  statCourseCode: { fontSize: 11, color: '#64748B', marginTop: 3 },

  // ── Ring ──
  ringWrap: { alignItems: 'center', marginLeft: 12 },
  ringOuter: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 6, alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  ringInner: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 4, alignItems: 'center', justifyContent: 'center',
  },
  ringPct: { fontSize: 15, fontWeight: '900' },
  ringLabel: { fontSize: 9, color: '#94A3B8', fontWeight: '700' },
  ringBar: {
    width: 72, height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden',
  },
  ringBarFill: { height: '100%', borderRadius: 3 },

  // Progress bar
  progressBarTrack: {
    height: 12, backgroundColor: '#F1F5F9', borderRadius: 6,
    overflow: 'hidden', marginVertical: 8, position: 'relative',
  },
  progressBarFill: { height: '100%', borderRadius: 6 },
  progressThreshold: {
    position: 'absolute', top: 0, bottom: 0, width: 2,
    backgroundColor: '#94A3B8',
  },

  // Stat chips
  statCountersRow: { flexDirection: 'row', gap: 8 },
  statChip: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: 10,
  },
  statChipNum: { fontSize: 18, fontWeight: '900' },
  statChipLabel: { fontSize: 10, color: '#64748B', fontWeight: '600', marginTop: 2 },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  // ── Course Cards ──
  courseList: { marginBottom: 6 },
  courseCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFFFFF', padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8,
    shadowColor: '#07152F', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  courseCardSelected: { borderColor: '#F0440B', backgroundColor: '#FFF7ED' },
  courseCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  courseIcon: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  courseIconText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  courseTitle: { fontSize: 14, fontWeight: '700', color: '#07152F' },
  courseDetails: { fontSize: 11, color: '#64748B', marginTop: 2 },
  coursePct: { fontSize: 15, fontWeight: '900' },
  arrowText: { fontSize: 12, color: '#94A3B8', marginTop: 2 },

  // ── Session Card ──
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginVertical: 8,
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#07152F', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#07152F' },
  cardSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 12 },
  sessionItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sessionDateText: { fontSize: 13, fontWeight: '600', color: '#07152F' },

  // Badges
  badge: {
    fontSize: 10, fontWeight: '800',
    paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7,
  },
  badgeGreen: { backgroundColor: '#DCFCE7', color: '#15803D' },
  badgeAmber: { backgroundColor: '#FEF3C7', color: '#B45309' },
  badgeRed: { backgroundColor: '#FEE2E2', color: '#B91C1C' },
  badgePurple: { backgroundColor: '#F3E8FF', color: '#6B21A8' },
  badgeGray: { backgroundColor: '#F1F5F9', color: '#64748B' },

  // GPS button
  gpsButton: {
    backgroundColor: '#16803C', paddingVertical: 13, borderRadius: 10,
    alignItems: 'center', marginTop: 10,
    shadowColor: '#16803C', shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  gpsButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  // ── History ──
  historyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
    gap: 10,
  },
  historyDot: { width: 10, height: 10, borderRadius: 5 },
  grow: { flex: 1 },
  historyCourse: { fontSize: 13, fontWeight: '700', color: '#07152F' },
  historyDate: { fontSize: 11, color: '#64748B', marginTop: 2 },

  // ── Empty States ──
  emptyCard: { alignItems: 'center', paddingVertical: 24 },
  emptyCardIcon: { fontSize: 36, marginBottom: 8 },
  emptyCardText: { color: '#94A3B8', fontSize: 13, textAlign: 'center' },
  emptyText: { color: '#94A3B8', fontStyle: 'italic', paddingVertical: 12, textAlign: 'center' },
});
