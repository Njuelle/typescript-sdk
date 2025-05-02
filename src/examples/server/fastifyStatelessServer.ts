import Fastify from "fastify";
import { z } from "zod";
import { McpServer } from "../../server/mcp.js";
import { createStatelessMcpHandler } from "../../server/fastify.js";
import { CallToolResult } from "../../types.js";

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

// Run the stateless server
runStatelessServer();
