import { routeAgentRequest } from "agents";
import { env } from "hono/adapter";
import { createMiddleware } from "hono/factory";
//#region src/index.ts
/**
 * Creates a middleware for handling Cloudflare Agents WebSocket and HTTP requests
 * Processes both WebSocket upgrades and standard HTTP requests, delegating them to Cloudflare Agents
 */
function agentsMiddleware(ctx) {
  return createMiddleware(async (c, next) => {
    try {
      const response = await (
        isWebSocketUpgrade(c) ? handleWebSocketUpgrade : handleHttpRequest
      )(c, ctx?.options);
      return response === null ? await next() : response;
    } catch (error) {
      if (ctx?.onError) {
        ctx.onError(error);
        return next();
      }
      throw error;
    }
  });
}
/**
 * Checks if the incoming request is a WebSocket upgrade request
 * Looks for the 'upgrade' header with a value of 'websocket' (case-insensitive)
 */
function isWebSocketUpgrade(c) {
  return c.req.header("upgrade")?.toLowerCase() === "websocket";
}
/**
 * Handles WebSocket upgrade requests
 * Returns a WebSocket upgrade response if successful, null otherwise
 */
async function handleWebSocketUpgrade(c, options) {
  const response = await routeAgentRequest(c.req.raw, env(c), options);
  if (!response?.webSocket) return null;
  return new Response(null, {
    status: 101,
    webSocket: response.webSocket
  });
}
/**
 * Handles standard HTTP requests
 * Forwards the request to Cloudflare Agents and returns the response
 */
async function handleHttpRequest(c, options) {
  return routeAgentRequest(c.req.raw, env(c), options);
}
//#endregion
export { agentsMiddleware };

//# sourceMappingURL=index.js.map
