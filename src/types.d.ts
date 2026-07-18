import 'express-session';

declare module 'express-session' {
  interface SessionData {
    adminId?: number;
    adminUsername?: string;
    adminRole?: 'super' | 'admin';
    flash?: { type: 'success' | 'error'; message: string };
  }
}
