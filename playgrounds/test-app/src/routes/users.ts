import {Router} from 'express';
import {authenticate} from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (_req, res) => {
  res.json({data: []});
});

router.post('/', authenticate, async (req, res) => {
  const {name, email, role} = req.body;
  res.status(201).json({id: 1, name, email, role});
});

router.get('/:id', authenticate, async (req, res) => {
  res.json({id: req.params.id, name: 'test', email: 'test@example.com'});
});

router.put('/:id', authenticate, async (req, res) => {
  res.json({id: req.params.id, ...req.body});
});

router.delete('/:id', authenticate, async (_req, res) => {
  res.status(204).send();
});

export default router;
