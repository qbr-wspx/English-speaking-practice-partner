let connection: { httpUrl: string; wsUrl: string; token: string; remote?: boolean } | null = null;
export async function getConnection() {
  if (!connection || connection.remote) connection = await window.desktop?.getConnection() ?? { httpUrl: "http://127.0.0.1:18765", wsUrl: "ws://127.0.0.1:18765/ws/conversation", token: "" };
  return connection;
}
export async function getConversationUrl() {
  const config = await getConnection();
  if (!config.remote) return `${config.wsUrl}?token=${encodeURIComponent(config.token)}`;
  const value = await api<{ ticket: string }>("/v1/ws-ticket", { method: "POST" });
  return `${config.wsUrl}?ticket=${encodeURIComponent(value.ticket)}`;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const config = await getConnection();
  const response = await fetch(config.httpUrl + path, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}`, ...options.headers }, signal: options.signal ?? AbortSignal.timeout(60000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: unknown };
    throw new Error(typeof data.detail === "string" ? data.detail : `请求未完成（${response.status}）`);
  }
  return response.json() as Promise<T>;
}
