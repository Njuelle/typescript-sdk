import Fastify, { FastifyInstance } from "fastify";
import { McpServer } from "./mcp.js";
import { registerMcpRoutes, createStatelessMcpHandler } from "./fastify.js";
import { z } from "zod";
import { CallToolResult } from "../types.js";

describe("Fastify MCP adapter", () => {
  let fastify: FastifyInstance;
  let server: McpServer;

  beforeEach(() => {
    // Create a new Fastify instance for each test
    fastify = Fastify({ logger: false });

    // Create a new MCP server for each test
    server = new McpServer(
      {
        name: "test-server",
        version: "1.0.0",
      },
      { capabilities: { tools: {} } }
    );

    // Add a simple tool
    server.tool(
      "echo",
      "A simple echo tool",
      {
        message: z.string().describe("Message to echo"),
      },
      async ({ message }): Promise<CallToolResult> => {
        return {
          content: [{ type: "text", text: message }],
        };
      }
    );
  });

  afterEach(async () => {
    await fastify.close();
  });

  test("should register MCP routes with Fastify", async () => {
    // Register MCP routes
    await registerMcpRoutes(fastify, server, {
      route: "/mcp",
    });

    // Check that routes are registered
    const routes = fastify.printRoutes();
    expect(routes).toContain("mcp (POST");
    expect(routes).toContain("mcp (");
    expect(routes).toContain("GET");
    expect(routes).toContain("DELETE");
  });

  test("should create a stateless MCP handler", async () => {
    // Create a stateless handler
    const handler = createStatelessMcpHandler(() => {
      return server;
    });

    // Register the route
    fastify.post("/stateless", handler);

    // Check that the route is registered
    const routes = fastify.printRoutes();
    expect(routes).toContain("stateless (POST)");
  });
});
