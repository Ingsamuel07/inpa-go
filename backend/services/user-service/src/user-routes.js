import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../../../shared/authenticate.js';
import { createTeacher, getUser, listUsers, setUserActive } from './user-service.js';

const router = Router();
const teacherSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(180),
  institutionalCode: z.string().trim().min(2).max(50),
});
const activeSchema = z.object({ active: z.boolean() });

router.use(authenticate);
router.get('/', requireRoles('admin'), async (_req, res, next) => {
  try { return res.json(await listUsers()); } catch (error) { return next(error); }
});
router.get('/:id', async (req, res, next) => {
  if (req.auth.role !== 'admin' && req.auth.sub !== req.params.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Solo puedes consultar tu propio perfil.' } });
  try { return res.json(await getUser(req.params.id)); } catch (error) { return next(error); }
});
router.post('/teachers', requireRoles('admin'), async (req, res, next) => {
  const parsed = teacherSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Verifica los datos del docente y usa una contraseña de al menos 12 caracteres.' } });
  try { return res.status(201).json(await createTeacher(parsed.data)); } catch (error) { return next(error); }
});
router.patch('/:id/status', requireRoles('admin'), async (req, res, next) => {
  const parsed = activeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Estado de cuenta no válido.' } });
  try { return res.json(await setUserActive(req.params.id, parsed.data.active)); } catch (error) { return next(error); }
});

export default router;