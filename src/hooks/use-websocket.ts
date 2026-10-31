import { useEffect, useRef, useState, useCallback } from "react";
import { WS_BASE } from "@/lib/api";

export type WebSocketEvent = {
  stage?: string;
  status?: string;
  message?: string;
  progress_percent?: number;
  timestamp?: string;
  duration_ms?: number;
  rows_processed?: number;
  rows_per_sec?: number;
  event?: string;
  total_runs?: number;
  avg_quality_score?: number;
  total_rows_cleaned?: number;
  score?: number;
  threshold?: number;
};

export function useRunWebSocket(runId: number | null, onMessage?: (event: WebSocketEvent) => void) {
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<any>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback(() => {
    if (!runId) return;

    try {
      const socket = new WebSocket(`${WS_BASE}/ws/runs/${runId}`);
      wsRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
      };

      socket.onmessage = (e) => {
        try {
          const parsed: WebSocketEvent = JSON.parse(e.data);
          setLastEvent(parsed);
          if (onMessageRef.current) onMessageRef.current(parsed);
        } catch (err) {
          console.error("Failed to parse websocket event:", err);
        }
      };

      socket.onclose = () => {
        setConnected(false);
        // Auto-reconnect if run still active
        reconnectTimeout.current = setTimeout(() => {
          if (runId && wsRef.current?.readyState !== WebSocket.OPEN) {
            connect();
          }
        }, 1500);
      };

      socket.onerror = (err) => {
        console.warn("WebSocket error:", err);
        socket.close();
      };
    } catch (e) {
      console.error("WebSocket setup error:", e);
    }
  }, [runId]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeout.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { lastEvent, connected };
}

export function useDashboardWebSocket(onDashboardUpdate?: (stats: any) => void) {
  const [stats, setStats] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onUpdateRef = useRef(onDashboardUpdate);

  useEffect(() => {
    onUpdateRef.current = onDashboardUpdate;
  }, [onDashboardUpdate]);

  useEffect(() => {
    let reconnectTimer: any;
    const connect = () => {
      try {
        const socket = new WebSocket(`${WS_BASE}/ws/dashboard`);
        wsRef.current = socket;

        socket.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            setStats(data);
            if (onUpdateRef.current) onUpdateRef.current(data);
          } catch (err) {
            console.error("Dashboard websocket parse error:", err);
          }
        };

        socket.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000);
        };
      } catch (err) {
        console.error("Dashboard websocket error:", err);
      }
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return stats;
}
