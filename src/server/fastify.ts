import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { McpServer } from "./mcp.js";
import { StreamableHTTPServerTransport } from "./streamableHttp.js";
import { isInitializeRequest } from "../types.js";

/**
 * Options for the Fastify MCP adapter
 */
export interface FastifyMcpAdapterOptions {
  /**
   * Route path to use for MCP. Default is '/mcp'
   */
  route?: string;

  /**
   * Session ID generator function.
   * Pass undefined to use stateless mode.
   * Default is randomUUID()
   */
  sessionIdGenerator?: (() => string) | undefined;

  /**
   * If true, will use JSON response format instead of SSE streams.
   * Default is false.
   */
  enableJsonResponse?: boolean;

  /**
   * Event store for stream resumability support.
   */
  eventStore?: any; // Using any to avoid circular dependency
}

/**
 * Registers ModelContextProtocol routes with a Fastify instance
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { registerMcpRoutes } from '@modelcontextprotocol/sdk/server/fastify.js';
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 *
 * const fastify = Fastify();
 * const server = new McpServer({
 *   name: 'my-mcp-server',
 *   version: '1.0.0'
 * });
 *
 * // Register MCP routes
 * registerMcpRoutes(fastify, server);
 *
 * // Start Fastify server
 * fastify.listen({ port: 3000 }, (err, address) => {
 *   if (err) throw err;
 *   console.log(`Server listening at ${address}`);
 * });
 * ```
 */
export async function registerMcpRoutes(
  fastify: FastifyInstance,
  mcpServer: McpServer,
  options: FastifyMcpAdapterOptions = {}
): Promise<void> {
  const {
    route = "/mcp",
    sessionIdGenerator = () => randomUUID(),
    enableJsonResponse = false,
    eventStore = undefined,
  } = options;

  // Store transports by session ID for stateful mode
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // Handle POST requests (message sending)
  fastify.post(route, async (request: FastifyRequest, reply: FastifyReply) => {
    // Check for existing session ID
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(request.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator,
        enableJsonResponse,
        eventStore,
        onsessioninitialized:
          sessionIdGenerator !== undefined
            ? (sid: string) => {
                transports[sid] = transport;
              }
            : undefined,
      });

      // Clean up transport when closed
      if (sessionIdGenerator !== undefined) {
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };
      }

      // Connect to the MCP server
      await mcpServer.connect(transport);
    } else {
      // Invalid request
      return reply.status(400).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
    }

    // Handle the request
    await transport.handleRequest(request.raw, reply.raw, request.body);

    // Prevent Fastify from sending a response as it's handled by the transport
    return reply.hijack();
  });

  // Helper function for GET and DELETE requests
  const handleSessionRequest = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;

    if (sessionIdGenerator === undefined) {
      // Stateless mode doesn't support GET/DELETE
      return reply.status(405).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed in stateless mode",
        },
        id: null,
      });
    }

    if (!sessionId || !transports[sessionId]) {
      return reply.status(400).send("Invalid or missing session ID");
    }

    const transport = transports[sessionId];
    await transport.handleRequest(request.raw, reply.raw);

    // Prevent Fastify from sending a response as it's handled by the transport
    return reply.hijack();
  };

  // Handle GET requests for SSE stream
  fastify.get(route, handleSessionRequest);

  // Handle DELETE requests for session termination
  fastify.delete(route, handleSessionRequest);
}

/**
 * Creates a stateless Fastify handler for MCP requests.
 * This is useful for serverless environments or when you don't need session state.
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { createStatelessMcpHandler } from '@modelcontextprotocol/sdk/server/fastify.js';
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 *
 * const fastify = Fastify();
 *
 * // Create the handler function
 * const mcpHandler = createStatelessMcpHandler(() => {
 *   return new McpServer({
 *     name: 'my-stateless-server',
 *     version: '1.0.0'
 *   });
 * });
 *
 * // Register the route
 * fastify.post('/mcp', mcpHandler);
 *
 * // Start Fastify server
 * fastify.listen({ port: 3000 });
 * ```
 */
export function createStatelessMcpHandler(
  getServer: () => McpServer,
  options: Omit<FastifyMcpAdapterOptions, "sessionIdGenerator"> = {}
) {
  const { enableJsonResponse = false, eventStore = undefined } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const server = getServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Explicit stateless mode
        enableJsonResponse,
        eventStore,
      });

      // Clean up when request is done
      request.raw.on("close", () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);

      // Prevent Fastify from sending a response as it's handled by the transport
      return reply.hijack();
    } catch (error) {
      request.log.error("Error handling MCP request:", error);
      if (!reply.sent) {
        return reply.status(500).send({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  };
}
