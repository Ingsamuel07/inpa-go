import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { apiRequest } from '../api/client.js';
import { getApiBaseUrl } from '../api/config.js';
import { useAuth } from '../auth/auth-context.js';

export default function AdminDashboard() {
  const router = useRouter();
  const { user, signOut, offlineSync } = useAuth();

  // State: Entities
  const [users, setUsers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [batches, setBatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Tab navigation inside Admin panel
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'academic' | 'enrollment' | 'excel'

  // User form states
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userCode, setUserCode] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('student'); // 'student' | 'teacher' | 'admin'
  const [userRoleFilter, setUserRoleFilter] = useState('all');

  // Academic form states
  const [courseCode, setCourseCode] = useState('');
  const [courseName, setCourseName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupTerm, setGroupTerm] = useState('2026-1');
  const [selectedCourseId, setSelectedCourseId] = useState(null);

  // Linkage / Enrollment states
  const [assignTeacherId, setAssignTeacherId] = useState(null);
  const [enrollStudentId, setEnrollStudentId] = useState(null);
  const [targetGroupId, setTargetGroupId] = useState(null);

  // Excel import states
  const [importSummary, setImportSummary] = useState(null);
  const headerProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerProgress, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, []);

  async function loadAllData() {
    try {
      const [u, c, g, b] = await Promise.all([
        apiRequest('/users'),
        apiRequest('/academic/courses'),
        apiRequest('/academic/groups'),
        apiRequest('/imports/batches'),
      ]);
      setUsers(u);
      setCourses(c);
      setGroups(g);
      setBatches(b);
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => {
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role !== 'admin') {
      router.replace(user.role === 'teacher' ? '/teacher' : '/student');
      return;
    }
    loadAllData();
  }, [user, router]);

  const lastPendingCount = useRef(offlineSync.pendingCount);
  useEffect(() => {
    if (user?.role === 'admin' && lastPendingCount.current > 0 && offlineSync.pendingCount === 0) {
      loadAllData();
    }
    lastPendingCount.current = offlineSync.pendingCount;
  }, [offlineSync.pendingCount, user]);

  // Helper para generar correo institucional automáticamente a partir del nombre
  function handleNameChange(name) {
    setUserName(name);
    if (!name.trim()) {
      setUserEmail('');
      return;
    }
    const clean = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z\s]/g, '')
      .trim()
      .split(/\s+/);
    if (['prof', 'profesor', 'profesora', 'dr', 'dra', 'doctor', 'doctora', 'ing', 'lic'].includes(clean[0])) {
      clean.shift();
    }
    setUserEmail(clean.length ? `${clean[0]}.${clean[clean.length - 1]}@uninpahu.edu.co` : '');
  }

  // RF03: Create User (Student, Teacher, or Admin)
  async function handleCreateUser() {
    if (!userName || !userEmail || !userCode || !userPassword) {
      setMessage('Por favor completa todos los campos del usuario.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const endpoint =
        selectedRole === 'teacher'
          ? '/users/teachers'
          : selectedRole === 'admin'
          ? '/users/admins'
          : '/users/students';

      const created = await apiRequest(endpoint, {
        method: 'POST',
        body: {
          fullName: userName,
          email: userEmail,
          institutionalCode: userCode,
          password: userPassword,
        },
      });

      setUserName('');
      setUserEmail('');
      setUserCode('');
      setUserPassword('');
      setMessage(created.pendingSync
        ? `Alta de ${selectedRole} guardada en este dispositivo y pendiente de sincronización.`
        : `Usuario (${selectedRole}) guardado en Neon: ${created.email || created.institutional_email || userEmail}`);
      await loadAllData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // RF03: Toggle User Active Status
  async function handleToggleUserStatus(targetUser) {
    setBusy(true);
    try {
      const result = await apiRequest(`/users/${targetUser.id}/status`, {
        method: 'PATCH',
        body: { active: !targetUser.active },
      });
      await loadAllData();
      setMessage(result.pendingSync ? 'Cambio de estado pendiente de sincronización.' : 'Estado de cuenta actualizado.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // RF05: Create Course
  async function handleCreateCourse() {
    if (!courseCode || !courseName) {
      setMessage('Indica el código y nombre de la asignatura.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest('/academic/courses', {
        method: 'POST',
        body: { code: courseCode, name: courseName },
      });
      setCourseCode('');
      setCourseName('');
      setMessage(result.pendingSync ? 'Asignatura guardada localmente y pendiente de sincronización.' : 'Asignatura creada exitosamente.');
      await loadAllData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // RF05: Create Group
  async function handleCreateGroup() {
    if (!selectedCourseId || !groupCode || !groupTerm) {
      setMessage('Selecciona una materia e indica el código de grupo y periodo.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest('/academic/groups', {
        method: 'POST',
        body: { courseId: selectedCourseId, code: groupCode, term: groupTerm },
      });
      setGroupCode('');
      setMessage(result.pendingSync ? 'Grupo guardado localmente y pendiente de sincronización.' : 'Grupo académico creado exitosamente.');
      await loadAllData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // RF06: Assign Teacher to Group
  async function handleAssignTeacher() {
    if (!assignTeacherId || !targetGroupId) {
      setMessage('Selecciona un docente y un grupo académico.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest('/academic/assignments', {
        method: 'POST',
        body: { teacherUserId: assignTeacherId, groupId: targetGroupId },
      });
      setMessage(result.pendingSync ? 'Vinculación guardada localmente y pendiente de sincronización.' : 'Docente vinculado como titular del grupo.');
      await loadAllData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // RF06: Enroll Student in Group
  async function handleEnrollStudent() {
    if (!enrollStudentId || !targetGroupId) {
      setMessage('Selecciona un estudiante y un grupo académico para matricular.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest('/academic/enrollments', {
        method: 'POST',
        body: { studentUserId: enrollStudentId, groupId: targetGroupId },
      });
      setMessage(result.pendingSync ? 'Matrícula guardada localmente y pendiente de sincronización.' : 'Estudiante matriculado exitosamente en el grupo.');
      await loadAllData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // RF04: Excel File Upload & Processing
  function handlePickExcelFile() {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx, .xls, .csv';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setMessage(`Cargando archivo ${file.name}...`);
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = String(reader.result).split(',')[1];
            try {
              const res = await apiRequest('/imports/upload', {
                method: 'POST',
                body: { fileName: file.name, fileBase64: base64 },
              });
              setImportSummary(res);
              setMessage(res.pendingSync
                ? `Archivo ${file.name} guardado localmente y pendiente de sincronización.`
                : `¡Carga exitosa! ${res.acceptedRows} filas insertadas, ${res.rejectedRows} con error.`);
              await loadAllData();
            } catch (err) {
              setMessage(`Error en el servidor: ${err.message}`);
            } finally {
              setBusy(false);
            }
          };
          reader.readAsDataURL(file);
        } catch (err) {
          setMessage(`Error al leer archivo: ${err.message}`);
          setBusy(false);
        }
      };
      input.click();
    } else {
      setMessage('La carga de Excel está disponible en el portal web. No se crearon registros.');
    }
  }

  function handleDownloadTemplate() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.open(`${getApiBaseUrl()}/imports/template`, '_blank');
        setMessage('Descargando plantilla oficial de Excel...');
      } catch (error) {
        setMessage(error.message);
      }
    } else {
      setMessage('Descarga la plantilla desde el portal web.');
    }
  }

  if (!user || user.role !== 'admin') {
    return (
      <View style={st.center}>
        <ActivityIndicator color="#F0440B" size="large" />
      </View>
    );
  }

  const filteredUsers = users.filter((u) => {
    if (userRoleFilter === 'all') return true;
    return u.role === userRoleFilter;
  });

  return (
    <ScrollView contentContainerStyle={st.page}>
      {/* Header */}
      <Animated.View
        style={[
          st.header,
          {
            opacity: headerProgress,
            transform: [{ translateY: headerProgress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
          },
        ]}
      >
        <View>
          <Image source={require('../../assets/logo.jpg')} style={{ width: 150, height: 44, marginBottom: 8 }} resizeMode="contain" />
          <Text style={st.title}>Bienestar Institucional</Text>
          <Text style={st.subtitle}>Panel de Administración y Gestión Académica</Text>
        </View>
        <Pressable
          style={st.logoutButton}
          onPress={async () => {
            await signOut();
            router.replace('/login');
          }}
        >
          <Text style={st.logoutText}>Cerrar Sesión</Text>
        </Pressable>
      </Animated.View>

      {/* Navigation Tabs */}
      <View style={st.tabBar}>
        <Pressable
          style={({ pressed }) => [st.tabItem, activeTab === 'users' && st.tabActive, pressed && st.tabPressed]}
          onPress={() => setActiveTab('users')}
        >
          <Text style={[st.tabText, activeTab === 'users' && st.tabTextActive]}>Usuarios ({users.length})</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [st.tabItem, activeTab === 'academic' && st.tabActive, pressed && st.tabPressed]}
          onPress={() => setActiveTab('academic')}
        >
          <Text style={[st.tabText, activeTab === 'academic' && st.tabTextActive]}>Cursos & Grupos</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [st.tabItem, activeTab === 'enrollment' && st.tabActive, pressed && st.tabPressed]}
          onPress={() => setActiveTab('enrollment')}
        >
          <Text style={[st.tabText, activeTab === 'enrollment' && st.tabTextActive]}>Vinculaciones</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [st.tabItem, activeTab === 'excel' && st.tabActive, pressed && st.tabPressed]}
          onPress={() => setActiveTab('excel')}
        >
          <Text style={[st.tabText, activeTab === 'excel' && st.tabTextActive]}>Carga Excel</Text>
        </Pressable>
      </View>

      {/* Feedback Message */}
      {!!message && (
        <View style={st.alertBox}>
          <Text style={st.alertText}>{message}</Text>
        </View>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: GESTIÓN DE USUARIOS (RF03) */}
      {/* ==================================================================== */}
      {activeTab === 'users' && (
        <View>
          {/* Create User Card */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Registrar Nuevo Usuario</Text>
            <Text style={st.cardSubtitle}>Crea cuentas de estudiantes, docentes o administradores.</Text>

            <View style={st.roleSelector}>
              {['student', 'teacher', 'admin'].map((r) => (
                <Pressable
                  key={r}
                  style={({ pressed }) => [st.roleOption, selectedRole === r && st.roleOptionActive, pressed && st.tabPressed]}
                  onPress={() => setSelectedRole(r)}
                >
                  <Text style={[st.roleOptionText, selectedRole === r && st.roleOptionTextActive]}>
                    {r === 'student' ? 'Estudiante' : r === 'teacher' ? 'Docente' : 'Administrador'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={st.input}
              placeholder="Nombre completo (ej. Carlos Gómez)"
              placeholderTextColor="#94A3B8"
              value={userName}
              onChangeText={handleNameChange}
            />
            <TextInput
              style={st.input}
              placeholder={selectedRole === 'admin' ? 'Correo institucional' : 'Correo institucional generado automáticamente'}
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              keyboardType="email-address"
              value={userEmail}
              onChangeText={selectedRole === 'admin' ? setUserEmail : undefined}
              editable={selectedRole === 'admin'}
            />
            <TextInput
              style={st.input}
              placeholder="Código institucional (Ej: EST-2026-001)"
              placeholderTextColor="#94A3B8"
              value={userCode}
              onChangeText={setUserCode}
            />
            <TextInput
              style={st.input}
              placeholder="Contraseña inicial (mínimo 8 caracteres)"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={userPassword}
              onChangeText={setUserPassword}
            />

            <Pressable style={st.primaryButton} onPress={handleCreateUser} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={st.buttonText}>Crear Usuario</Text>}
            </Pressable>
          </View>

          {/* List Users */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Directorio de Usuarios ({filteredUsers.length})</Text>
            <View style={st.filterRowContainer}>
              {['all', 'student', 'teacher', 'admin'].map((f) => (
                <Pressable
                  key={f}
                  style={({ pressed }) => [st.pill, userRoleFilter === f && st.pillActive, pressed && st.tabPressed]}
                  onPress={() => setUserRoleFilter(f)}
                >
                  <Text style={[st.pillText, userRoleFilter === f && st.pillTextActive]}>
                    {f === 'all' ? 'Todos' : f === 'student' ? 'Estudiantes' : f === 'teacher' ? 'Docentes' : 'Administradores'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {filteredUsers.map((u) => (
              <View key={u.id} style={st.userRow}>
                <View style={st.grow}>
                  <Text style={st.nameText}>{u.profile?.full_name || u.institutional_email}</Text>
                  <Text style={st.subText}>
                    {u.institutional_email} · Cód: {u.profile?.institutional_code || 'S/N'}
                  </Text>
                  <View style={st.badgeContainer}>
                    <Text style={[st.badge, u.role === 'admin' ? st.badgeBlue : u.role === 'teacher' ? st.badgePurple : st.badgeGreen]}>
                      {u.role.toUpperCase()}
                    </Text>
                    <Text style={[st.badge, u.pendingSync ? st.badgePending : u.active ? st.badgeActive : st.badgeInactive]}>
                      {u.pendingSync ? 'PENDIENTE' : u.active ? 'ACTIVO' : 'INACTIVO'}
                    </Text>
                  </View>
                </View>

                <Pressable
                  style={[st.actionButton, u.active ? st.actionDeactivate : st.actionActivate]}
                  onPress={() => handleToggleUserStatus(u)}
                >
                  <Text style={[st.actionButtonText, u.active ? st.actionDeactivateText : st.actionActivateText]}>
                    {u.active ? 'Desactivar' : 'Activar'}
                  </Text>
                </Pressable>
              </View>
            ))}
            {filteredUsers.length === 0 && (
              <Text style={st.emptyText}>No hay usuarios registrados con este filtro.</Text>
            )}
          </View>
        </View>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: GESTIÓN DE ASIGNATURAS Y GRUPOS (RF05) */}
      {/* ==================================================================== */}
      {activeTab === 'academic' && (
        <View>
          {/* Create Course */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Registrar Asignatura</Text>
            <TextInput
              style={st.input}
              placeholder="Código de la asignatura (Ej: PROG-301)"
              placeholderTextColor="#94A3B8"
              value={courseCode}
              onChangeText={setCourseCode}
            />
            <TextInput
              style={st.input}
              placeholder="Nombre oficial (Ej: Programación Móvil)"
              placeholderTextColor="#94A3B8"
              value={courseName}
              onChangeText={setCourseName}
            />
            <Pressable style={st.primaryButton} onPress={handleCreateCourse} disabled={busy}>
              <Text style={st.buttonText}>Crear Asignatura</Text>
            </Pressable>
          </View>

          {/* Create Group for Course */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Crear Grupo Académico</Text>
            <Text style={st.cardSubtitle}>1. Selecciona la asignatura:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.horizontalScroll}>
              {courses.map((c) => (
                <Pressable
                  key={c.id}
                  style={[st.courseChip, selectedCourseId === c.id && st.courseChipActive]}
                  onPress={() => setSelectedCourseId(c.id)}
                >
                  <Text style={[st.courseChipCode, selectedCourseId === c.id && st.textWhite]}>{c.code}</Text>
                  <Text style={[st.courseChipName, selectedCourseId === c.id && st.textWhite]}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[st.cardSubtitle, { marginTop: 14 }]}>2. Define código y periodo:</Text>
            <TextInput
              style={st.input}
              placeholder="Código del grupo (Ej: G1, A1, NOCT-1)"
              placeholderTextColor="#94A3B8"
              value={groupCode}
              onChangeText={setGroupCode}
            />
            <TextInput
              style={st.input}
              placeholder="Periodo académico (Ej: 2026-1)"
              placeholderTextColor="#94A3B8"
              value={groupTerm}
              onChangeText={setGroupTerm}
            />
            <Pressable
              style={[st.primaryButton, !selectedCourseId && st.buttonDisabled]}
              onPress={handleCreateGroup}
              disabled={busy || !selectedCourseId}
            >
              <Text style={st.buttonText}>Crear Grupo Académico</Text>
            </Pressable>
          </View>

          {/* List Groups */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Grupos Académicos Configurados ({groups.length})</Text>
            {groups.map((g) => (
              <View key={g.id} style={st.groupItem}>
                <View>
                  <Text style={st.nameText}>{g.course_name}</Text>
                  <Text style={st.subText}>
                    Asignatura: {g.course_code}  |  Grupo: {g.code}  |  Periodo: {g.term}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: VINCULACIÓN DOCENTE Y MATRÍCULA DE ESTUDIANTES (RF06) */}
      {/* ==================================================================== */}
      {activeTab === 'enrollment' && (
        <View>
          <View style={st.card}>
            <Text style={st.cardTitle}>1. Selecciona el Grupo Destino</Text>
            <Text style={st.cardSubtitle}>Selecciona el grupo al que vincularás docentes o matricularás alumnos:</Text>
            {groups.map((g) => (
              <Pressable
                key={g.id}
                style={[st.selectionItem, targetGroupId === g.id && st.selectionItemActive]}
                onPress={() => setTargetGroupId(g.id)}
              >
                <Text style={[st.selectionTitle, targetGroupId === g.id && st.orange]}>
                  {g.course_name} (Grupo {g.code})
                </Text>
                <Text style={st.subText}>Periodo: {g.term} · Código: {g.course_code}</Text>
              </Pressable>
            ))}
          </View>

          {/* Assign Teacher */}
          <View style={st.card}>
            <Text style={st.cardTitle}>2A. Asignar Docente Titular</Text>
            <Text style={st.cardSubtitle}>Docentes activos disponibles:</Text>
            {users
              .filter((u) => u.role === 'teacher' && u.active)
              .map((t) => (
                <Pressable
                  key={t.id}
                  style={[st.selectionItem, assignTeacherId === t.id && st.selectionItemActive]}
                  onPress={() => setAssignTeacherId(t.id)}
                >
                  <Text style={[st.selectionTitle, assignTeacherId === t.id && st.orange]}>
                    {t.profile?.full_name || t.institutional_email}
                  </Text>
                  <Text style={st.subText}>{t.institutional_email} · Cód: {t.profile?.institutional_code || 'S/N'}</Text>
                </Pressable>
              ))}
            <Pressable
              style={[st.primaryButton, (!assignTeacherId || !targetGroupId) && st.buttonDisabled]}
              onPress={handleAssignTeacher}
              disabled={busy || !assignTeacherId || !targetGroupId}
            >
              <Text style={st.buttonText}>Vincular Docente al Grupo</Text>
            </Pressable>
          </View>

          {/* Enroll Student */}
          <View style={st.card}>
            <Text style={st.cardTitle}>2B. Matricular Estudiante</Text>
            <Text style={st.cardSubtitle}>Estudiantes activos disponibles:</Text>
            {users
              .filter((u) => u.role === 'student' && u.active)
              .map((s) => (
                <Pressable
                  key={s.id}
                  style={[st.selectionItem, enrollStudentId === s.id && st.selectionItemActive]}
                  onPress={() => setEnrollStudentId(s.id)}
                >
                  <Text style={[st.selectionTitle, enrollStudentId === s.id && st.orange]}>
                    {s.profile?.full_name || s.institutional_email}
                  </Text>
                  <Text style={st.subText}>{s.institutional_email} · Cód: {s.profile?.institutional_code || 'S/N'}</Text>
                </Pressable>
              ))}
            <Pressable
              style={[st.secondaryButton, (!enrollStudentId || !targetGroupId) && st.buttonDisabled]}
              onPress={handleEnrollStudent}
              disabled={busy || !enrollStudentId || !targetGroupId}
            >
              <Text style={st.buttonText}>Matricular Estudiante en Grupo</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: CARGA MASIVA MEDIANTE EXCEL (RF04) */}
      {/* ==================================================================== */}
      {activeTab === 'excel' && (
        <View>
          <View style={st.card}>
            <Text style={st.cardTitle}>Importación Masiva de Información (Excel / CSV)</Text>
            <Text style={st.cardSubtitle}>
              Sube archivos .xlsx para provisionar masivamente usuarios institucionales, materias y matrículas con validación de integridad.
            </Text>

            <View style={st.excelActionBox}>
              <Text style={st.excelIcon}>📊</Text>
              <Text style={st.excelHeading}>Motor de Procesamiento ExcelJS</Text>
              <Text style={st.excelDescription}>
                El backend procesa hojas de cálculo completas, valida formato de correos institucionales, unicidad de códigos y crea lotes de auditoría en la base de datos.
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 10 }}>
                <Pressable
                  style={[st.primaryButton, { flex: 1, backgroundColor: '#10B981' }]}
                  onPress={handlePickExcelFile}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={st.buttonText}>📂 Seleccionar Excel (.xlsx)</Text>
                  )}
                </Pressable>

                <Pressable
                  style={[st.secondaryButton, { flex: 1, backgroundColor: '#07152F' }]}
                  onPress={handleDownloadTemplate}
                  disabled={busy}
                >
                  <Text style={st.buttonText}>📥 Descargar Plantilla</Text>
                </Pressable>
              </View>

            </View>

            {importSummary && (
              <View style={st.summaryCard}>
                <Text style={st.summaryTitle}>Resultado del Lote de Importación:</Text>
                <Text style={st.summaryRow}>Archivo: {importSummary.fileName}</Text>
                <Text style={st.summaryRow}>Total filas analizadas: {importSummary.totalRows}</Text>
                <Text style={[st.summaryRow, { color: '#16803C' }]}>Filas aceptadas e insertadas: {importSummary.acceptedRows}</Text>
                <Text style={[st.summaryRow, { color: '#B91C1C' }]}>Filas rechazadas / con errores: {importSummary.rejectedRows}</Text>
                <Text style={st.summaryRow}>Estado: {importSummary.status}</Text>
              </View>
            )}
          </View>

          {/* Batches History */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Historial de Lotes de Importación</Text>
            {batches.map((b) => (
              <View key={b.id} style={st.batchItem}>
                <View>
                  <Text style={st.nameText}>{b.file_name}</Text>
                  <Text style={st.subText}>
                    {new Date(b.created_at).toLocaleString('es-CO')} · Aceptados: {b.accepted_rows} / {b.total_rows}
                  </Text>
                </View>
                <Text style={[st.badge, b.pendingSync ? st.badgePending : b.status === 'completed' ? st.badgeActive : st.badgeInactive]}>
                  {b.pendingSync ? 'PENDIENTE' : b.status.toUpperCase()}
                </Text>
              </View>
            ))}
            {batches.length === 0 && (
              <Text style={st.emptyText}>No hay registros de importaciones previas.</Text>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: {
    padding: 24,
    paddingTop: 40,
    paddingBottom: 60,
    backgroundColor: '#F8FAFC',
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  brand: {
    fontSize: 20,
    fontWeight: '900',
    color: '#07152F',
  },
  orange: {
    color: '#F0440B',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#07152F',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  logoutButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  logoutText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#E2E8F0',
    borderRadius: 14,
    padding: 6,
    marginBottom: 16,
    gap: 6,
  },
  tabItem: {
    flex: 1,
    minWidth: 145,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.85,
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#07152F',
    shadowOpacity: 0.1,
    shadowRadius: 7,
    elevation: 3,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
  },
  tabTextActive: {
    color: '#07152F',
    fontWeight: '800',
  },
  alertBox: {
    backgroundColor: '#FEF3C7',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  alertText: {
    color: '#92400E',
    fontWeight: '600',
    fontSize: 13,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#07152F',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#07152F',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
  },
  roleSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  roleOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  roleOptionActive: {
    borderColor: '#F0440B',
    backgroundColor: '#FFF7ED',
  },
  roleOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  roleOptionTextActive: {
    color: '#EA580C',
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#07152F',
    marginBottom: 10,
  },
  primaryButton: {
    backgroundColor: '#F0440B',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  secondaryButton: {
    backgroundColor: '#07152F',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  filterRowContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 14,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    minHeight: 38,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pillActive: {
    backgroundColor: '#07152F',
    borderColor: '#07152F',
  },
  pillText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '700',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  grow: {
    flex: 1,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#07152F',
  },
  subText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  badgeBlue: { backgroundColor: '#DBEAFE', color: '#1E40AF' },
  badgePurple: { backgroundColor: '#F3E8FF', color: '#6B21A8' },
  badgeGreen: { backgroundColor: '#DCFCE7', color: '#166534' },
  badgeActive: { backgroundColor: '#DCFCE7', color: '#15803D' },
  badgeInactive: { backgroundColor: '#FEE2E2', color: '#B91C1C' },
  badgePending: { backgroundColor: '#FEF3C7', color: '#92400E' },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  actionDeactivate: { backgroundColor: '#FEF2F2' },
  actionDeactivateText: { color: '#DC2626', fontSize: 11, fontWeight: '700' },
  actionActivate: { backgroundColor: '#F0FDF4' },
  actionActivateText: { color: '#16A34A', fontSize: 11, fontWeight: '700' },
  emptyText: {
    color: '#94A3B8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  horizontalScroll: {
    marginVertical: 6,
  },
  courseChip: {
    backgroundColor: '#F1F5F9',
    padding: 10,
    borderRadius: 10,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: 140,
  },
  courseChipActive: {
    backgroundColor: '#07152F',
    borderColor: '#07152F',
  },
  courseChipCode: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F0440B',
  },
  courseChipName: {
    fontSize: 12,
    color: '#334155',
    marginTop: 2,
  },
  textWhite: {
    color: '#FFFFFF',
  },
  groupItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  selectionItem: {
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  selectionItemActive: {
    borderColor: '#F0440B',
    backgroundColor: '#FFF7ED',
  },
  selectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#07152F',
  },
  excelActionBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#94A3B8',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginTop: 10,
  },
  excelIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  excelHeading: {
    fontSize: 15,
    fontWeight: '800',
    color: '#07152F',
    marginBottom: 4,
  },
  excelDescription: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 14,
    marginTop: 14,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#07152F',
    marginBottom: 6,
  },
  summaryRow: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  batchItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  bioButton: {
    backgroundColor: '#07152F',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  bioText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
