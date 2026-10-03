import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { TokenUser } from './auth.js';

let io: Server | null = null;

/**
 * Rooms:
 *  - "dispatch"      admin + dispečeri (všetky jazdy, polohy áut)
 *  - "driver:<id>"   konkrétny vodič (jeho jazdy)
 */
export function attachRealtime(app: FastifyInstance) {
  io = new Server(app.server, { path: '/socket.io', cors: { origin: false } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    try {
      socket.data.user = app.jwt.verify<TokenUser>(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as TokenUser;
    if (user.role === 'driver') socket.join(`driver:${user.id}`);
    else socket.join('dispatch');
  });
}

export function emitDispatch(event: string, data: unknown) {
  io?.to('dispatch').emit(event, data);
}

export function emitDriver(driverId: number, event: string, data: unknown) {
  io?.to(`driver:${driverId}`).emit(event, data);
}
