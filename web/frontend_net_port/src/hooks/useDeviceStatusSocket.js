import { useMemo } from 'react';
import { useRealtimeSocket } from './useRealtimeSocket';

export function useDeviceStatusSocket({ token, enabled, onDeviceUpdated, onDeviceRemoved }) {
  const handlers = useMemo(() => ({
    'device:updated': onDeviceUpdated,
    'device:removed': onDeviceRemoved
  }), [onDeviceUpdated, onDeviceRemoved]);

  return useRealtimeSocket({ token, enabled, handlers });
}
