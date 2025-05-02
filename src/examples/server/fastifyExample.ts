import Fastify from "fastify";
import { z } from "zod";
import { McpServer } from "../../server/mcp.js";
import {
  registerMcpRoutes,
  createStatelessMcpHandler,
} from "../../server/fastify.js";
import { CallToolResult, ReadResourceResult } from "../../types.js";

// Example 1: Stateful server with session management
async function runStatefulServer() {
  // Create Fastify instance
  const fastify = Fastify({
    logger: true,
  });

  // Create MCP server
  const server = new McpServer(
    {
      name: "fastify-mcp-server",
      version: "1.0.0",
    },
    { capabilities: { logging: {}, tools: {} } }
  );

  // Register a simple tool that returns a greeting
  server.tool(
    "greet",
    "A simple greeting tool",
    {
      name: z.string().describe("Name to greet"),
    },
    async ({ name }): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: `Hello, ${name}!`,
          },
        ],
      };
    }
  );

  // Add a simple resource
  server.resource(
    "example",
    "https://example.com/resource",
    { mimeType: "text/plain", description: "Example resource" },
    async (): Promise<ReadResourceResult> => {
      return {
        contents: [
          {
            uri: "https://example.com/resource",
            text: "This is an example resource.",
          },
        ],
      };
    }
  );

  // Register MCP routes
  await registerMcpRoutes(fastify, server, {
    route: "/mcp",
  });

  // Add a simple route to explain usage
  fastify.get("/", async () => {
    return {
      message: "Fastify MCP Server Example",
      usage: [
        "POST /mcp - Send messages to MCP server",
        "GET /mcp - Establish SSE stream (with Mcp-Session-Id header)",
        "DELETE /mcp - Terminate session (with Mcp-Session-Id header)",
      ],
    };
  });

  // Start the server
  try {
    await fastify.listen({ port: 3000 });
    console.log("Server running at http://localhost:3000");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Example 2: Stateless server for simpler use cases
async function runStatelessServer() {
  // Create Fastify instance
  const fastify = Fastify({
    logger: true,
  });

  // Create a stateless MCP handler
  const mcpHandler = createStatelessMcpHandler(() => {
    const server = new McpServer(
      {
        name: "fastify-stateless-mcp-server",
        version: "1.0.0",
      },
      { capabilities: { logging: {}, tools: {} } }
    );

    // Register a simple tool that returns a greeting
    server.tool(
      "greet",
      "A simple greeting tool",
      {
        name: z.string().describe("Name to greet"),
      },
      async ({ name }): Promise<CallToolResult> => {
        return {
          content: [
            {
              type: "text",
              text: `Hello, ${name}!`,
            },
          ],
        };
      }
    );

    return server;
  });

  // Register the route
  fastify.post("/mcp", mcpHandler);

  // Add a simple route to explain usage
  fastify.get("/", async () => {
    return {
      message: "Fastify Stateless MCP Server Example",
      usage: [
        "POST /mcp - Send messages to MCP server (stateless mode)",
        "Note: GET and DELETE requests are not supported in stateless mode",
      ],
    };
  });

  // Start the server
  try {
    await fastify.listen({ port: 3001 });
    console.log("Stateless server running at http://localhost:3001");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Run the example (choose one or both)
const serverType = process.env.SERVER_TYPE || "stateful";

if (serverType === "stateless") {
  runStatelessServer();
} else if (serverType === "stateful") {
  runStatefulServer();
} else if (serverType === "both") {
  runStatefulServer();
  runStatelessServer();
}
