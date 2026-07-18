import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.adminId) {
    return res.redirect('/admin/login');
  }
  // Make role available to all views (e.g. sidebar shows/hides links)
  res.locals.adminRole = req.session.adminRole || 'admin';
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.adminId) {
    return res.redirect('/admin/login');
  }
  if (req.session.adminRole !== 'super') {
    req.session.flash = { type: 'error', message: 'Only the super admin can manage admin users' };
    return res.redirect('/admin');
  }
  res.locals.adminRole = 'super';
  next();
}
