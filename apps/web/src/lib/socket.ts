import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './api';

type Handlers = Record<string, (data: never) => void>;

/** Socket.IO spojenie s JWT; handlery sa môžu meniť bez reconnectu. */
export function useSocket(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s: Socket = io({
      path: '/socket.io',
      auth: { token: tokenStore.get() },
      transports: ['websocket'],
    });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.onAny((event: string, data: unknown) =>
      (ref.current[event] as ((d: unknown) => void) | undefined)?.(data),
    );
    return () => {
      s.disconnect();
    };
  }, []);

  return connected;
}
