import Fastify from "fastify";
import { z } from "zod";
import { McpServer } from "../../server/mcp.js";
import { registerMcpRoutes } from "../../server/fastify.js";
import { CallToolResult, ReadResourceResult } from "../../types.js";

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

// Run the stateful server
runStatefulServer();
