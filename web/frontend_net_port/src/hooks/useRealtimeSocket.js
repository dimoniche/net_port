import { useEffect, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../consts';

const AUTH_PATH = '/api/v1/authentication';

export function useRealtimeSocket({ token, enabled, handlers = {} }) {
  const socketRef = useRef(null);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handlerKeys = useMemo(
    () => Object.keys(handlers).sort().join('\0'),
    [handlers]
  );

  useEffect(() => {
    if (!enabled || !token) {
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
      auth: {
        strategy: 'jwt',
        accessToken: token
      },
      extraHeaders: {
        Authorization: `Bearer ${token}`
      }
    });

    socketRef.current = socket;

    const authenticate = () => {
      socket.emit('create', AUTH_PATH, {
        strategy: 'jwt',
        accessToken: token
      }, (error) => {
        if (error) {
          console.error('WebSocket authentication failed:', error);
        }
      });
    };

    socket.on('connect', authenticate);
    socket.io.on('reconnect', authenticate);

    return () => {
      socket.off('connect', authenticate);
      socket.io.off('reconnect', authenticate);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, token]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !enabled || !token) {
      return undefined;
    }

    const eventNames = handlerKeys ? handlerKeys.split('\0') : [];
    const wrappedHandlers = eventNames.map((eventName) => {
      const listener = (payload) => {
        handlersRef.current[eventName]?.(payload);
      };
      socket.on(eventName, listener);
      return { eventName, listener };
    });

    return () => {
      wrappedHandlers.forEach(({ eventName, listener }) => {
        socket.off(eventName, listener);
      });
    };
  }, [enabled, token, handlerKeys]);

  return socketRef;
}
