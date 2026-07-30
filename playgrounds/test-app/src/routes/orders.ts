import {Router} from 'express';
import {authenticate} from '../middleware/auth';

const router = Router();

router.post('/', authenticate, async (_req, res) => {
  res.status(201).json({orderId: 'ORD-001', status: 'pending'});
});

router.get('/', authenticate, async (_req, res) => {
  res.json({data: [], total: 0});
});

router.get('/:id', authenticate, async (req, res) => {
  res.json({orderId: req.params.id, status: 'pending'});
});

router.post('/:id/refund', authenticate, async (req, res) => {
  res.json({orderId: req.params.id, refundStatus: 'processing'});
});

router.post('/:id/cancel', authenticate, async (req, res) => {
  res.json({orderId: req.params.id, status: 'cancelled'});
});

export default router;
