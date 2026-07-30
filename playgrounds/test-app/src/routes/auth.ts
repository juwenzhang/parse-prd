import {Router} from 'express';

const router = Router();

router.post('/login', async (req, res) => {
  const {username} = req.body;
  res.json({token: 'jwt-token', user: {id: 1, username}});
});

router.post('/register', async (req, res) => {
  const {username, email} = req.body;
  res.status(201).json({id: 1, username, email});
});

router.post('/refresh', async (_req, res) => {
  res.json({token: 'new-jwt-token'});
});

router.post('/logout', async (_req, res) => {
  res.status(204).send();
});

export default router;
