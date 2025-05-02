/**
 * Fastify adapter for MCP servers
 *
 * This file provides utilities for integrating MCP servers with Fastify,
 * allowing you to add MCP functionality to your Fastify application.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "./streamableHttp.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "./mcp.js";
import { isInitializeRequest } from "../types.js";

export interface FastifyMcpOptions {
  /**
   * Path at which the MCP endpoint will be exposed
   * @default '/mcp'
   */
  path?: string;

  /**
   * Options for StreamableHTTPServerTransport
   */
  transportOptions?: {
    /**
     * Function that generates a session ID for the transport.
     * If undefined, stateless mode will be used.
     */
    sessionIdGenerator?: () => string;

    /**
     * If true, the server will return JSON responses instead of starting an SSE stream.
     * @default false
     */
    enableJsonResponse?: boolean;
  };

  /**
   * Factory function to create MCP server instances
   * This lets you reuse the same server creation logic for each new session
   */
  serverFactory: () => McpServer;
}

/**
 * Register MCP server functionality with a Fastify instance
 *
 * This creates handlers for GET (SSE streams), POST (requests), and DELETE (session termination)
 * at the specified path, implementing the MCP Streamable HTTP protocol.
 *
 * @example
 * ```typescript
 * import fastify from 'fastify';
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { registerMcpServer } from '@modelcontextprotocol/sdk/server/fastify.js';
 * import { randomUUID } from 'crypto';
 *
 * const app = fastify();
 *
 * // Register MCP server with Fastify
 * registerMcpServer(app, {
 *   path: '/mcp',
 *   transportOptions: {
 *     sessionIdGenerator: () => randomUUID(),
 *   },
 *   serverFactory: () => {
 *     const server = new McpServer({
 *       name: 'fastify-mcp-server',
 *       version: '1.0.0'
 *     });
 *     // Add your server resources, tools, etc. here
 *     return server;
 *   }
 * });
 *
 * app.listen({ port: 3000 });
 * ```
 */
export function registerMcpServer(
  fastify: FastifyInstance,
  options: FastifyMcpOptions
): void {
  const path = options.path || "/mcp";
  const transportMap: Record<string, StreamableHTTPServerTransport> = {};

  // Handle POST requests for JSON-RPC messages
  fastify.post(path, async (request, reply) => {
    try {
      const sessionId = request.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transportMap[sessionId]) {
        transport = transportMap[sessionId];
      } else if (!sessionId && isInitializeRequest(request.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: options.transportOptions?.sessionIdGenerator,
          enableJsonResponse: options.transportOptions?.enableJsonResponse,
          onsessioninitialized: (sid) => {
            if (sid) {
              transportMap[sid] = transport;
            }
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transportMap[sid]) {
            delete transportMap[sid];
          }
        };

        const server = options.serverFactory();
        await server.connect(transport);

        await handleFastifyRequest(transport, request, reply);
        return;
      } else {
        reply.code(400).send({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      await handleFastifyRequest(transport, request, reply);
    } catch (error) {
      if (!reply.sent) {
        reply.code(500).send({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  // Handle GET requests for SSE streams
  fastify.get(path, async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transportMap[sessionId]) {
      reply.code(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transportMap[sessionId];

    // Set appropriate headers for SSE
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...(transport.sessionId ? { "mcp-session-id": transport.sessionId } : {}),
    });

    const rawRequest = request.raw as IncomingMessage;
    const rawReply = reply.raw as ServerResponse;

    try {
      await transport.handleRequest(rawRequest, rawReply);

      if (!reply.sent && !rawReply.writableEnded) {
        reply.raw.end();
      }
    } catch (error) {
      if (!reply.sent && !rawReply.writableEnded) {
        reply.raw.end();
      }
    }
  });

  // Handle DELETE requests for session termination
  fastify.delete(path, async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transportMap[sessionId]) {
      reply.code(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transportMap[sessionId];

    try {
      await transport.close();
      delete transportMap[sessionId];

      const rawReply = reply.raw as ServerResponse;

      rawReply.statusCode = 200;

      if (!reply.sent && !rawReply.writableEnded) {
        rawReply.end();
      }
    } catch (error) {
      if (!reply.sent) {
        reply.code(500).send("Error processing session termination");
      }
    }
  });

  // Handle server shutdown
  fastify.addHook("onClose", async () => {
    for (const sessionId in transportMap) {
      try {
        await transportMap[sessionId].close();
        delete transportMap[sessionId];
      } catch (error) {
        // Silently ignore errors during shutdown
      }
    }
  });
}

/**
 * Adapter function to convert between Fastify and Node.js HTTP interfaces
 */
async function handleFastifyRequest(
  transport: StreamableHTTPServerTransport,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const rawRequest = request.raw as IncomingMessage;
  const rawReply = reply.raw as ServerResponse;

  await transport.handleRequest(rawRequest, rawReply, request.body);
}
