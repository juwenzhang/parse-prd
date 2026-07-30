import type {NextFunction, Request, Response} from 'express';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({error: 'Unauthorized'});
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req as Record<string, unknown>).userRole as string;
    if (!userRole || !roles.includes(userRole)) {
      res.status(403).json({error: 'Forbidden'});
      return;
    }
    next();
  };
}
