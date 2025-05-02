import fastify from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "../../server/mcp.js";
import { registerMcpServer } from "../../server/fastify.js";
import { CallToolResult } from "../../types.js";

/**
 * Example showing how to use the Fastify adapter for MCP
 *
 * This creates a simple Fastify server with MCP functionality
 * exposed through the /mcp endpoint.
 */

// Create a Fastify app
const app = fastify();

// Create a server factory function
// This will be called for each new MCP session
const createMcpServer = () => {
  const server = new McpServer(
    {
      name: "fastify-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        logging: {},
        tools: {},
      },
    }
  );

  // Register a simple greeting tool
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
            text: `Hello, ${name} from the Fastify MCP server!`,
          },
        ],
      };
    }
  );

  // Register a tool that sends multiple notifications
  server.tool(
    "multi-greet",
    "A tool that sends multiple greetings with notifications",
    {
      name: z.string().describe("Name to greet"),
      count: z.number().describe("Number of greetings").default(3),
    },
    async ({ name, count }, { sendNotification }): Promise<CallToolResult> => {
      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      await sendNotification({
        method: "notifications/message",
        params: {
          level: "info",
          data: `Starting multi-greet for ${name} with ${count} greetings`,
        },
      });

      for (let i = 0; i < count; i++) {
        await sleep(500); // Wait a bit between notifications

        await sendNotification({
          method: "notifications/message",
          params: {
            level: "info",
            data: `Greeting ${i + 1}/${count} for ${name}`,
          },
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `Sent ${count} greetings to ${name}!`,
          },
        ],
      };
    }
  );

  return server;
};

// Add a basic hello endpoint
app.get("/", async (request, reply) => {
  return { message: "Hello! The MCP server is available at /mcp" };
});

// Register the MCP server with Fastify
registerMcpServer(app, {
  path: "/mcp",
  transportOptions: {
    sessionIdGenerator: () => randomUUID(),
  },
  serverFactory: createMcpServer,
});

// Start the server
const PORT = 3000;
app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`MCP Fastify Server running at http://localhost:${PORT}`);
  console.log(`MCP endpoint available at http://localhost:${PORT}/mcp`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  await app.close();
  console.log("Server shutdown complete");
  process.exit(0);
});
