// Node 22 supplies WebSocket framing, including fragmented messages and ping/pong.
export function openCdpSession(url, { timeoutMs = 10000, Socket = WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Socket(url);
    const pending = new Map();
    const handlers = new Map();
    let nextId = 0;
    const opening = setTimeout(() => {
      reject(new Error("CDP connection timed out"));
      socket.close();
    }, timeoutMs);

    function disconnect() {
      clearTimeout(opening);
      const error = new Error("CDP connection closed");
      reject(error);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
    }
    socket.addEventListener("close", disconnect);
    socket.addEventListener("error", disconnect);
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method) {
        for (const fn of handlers.get(message.method) || []) fn(message.params);
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener("open", () => {
      clearTimeout(opening);
      resolve({
        send(method, params = {}) {
          if (socket.readyState !== Socket.OPEN) return Promise.reject(new Error("CDP connection closed"));
          const id = ++nextId;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(new Error(`CDP command timed out: ${method}`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, fn) {
          if (!handlers.has(method)) handlers.set(method, []);
          handlers.get(method).push(fn);
        },
        close() { socket.close(); }
      });
    });
  });
}
