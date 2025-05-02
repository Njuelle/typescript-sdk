/**
 * Tests for the Fastify adapter
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { McpServer } from "./mcp.js";
import { registerMcpServer } from "./fastify.js";
import fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { CallToolResult, isJSONRPCRequest } from "../types.js";

describe("FastifyAdapter", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    // Create a Fastify app with the MCP server
    app = fastify();

    // Mock console.error to suppress expected error messages in tests
    jest.spyOn(console, "error").mockImplementation(() => {});

    // Register the MCP server
    registerMcpServer(app, {
      path: "/mcp",
      transportOptions: {
        sessionIdGenerator: () => randomUUID(),
      },
      serverFactory: () => {
        const server = new McpServer(
          {
            name: "test-server",
            version: "1.0.0",
          },
          {
            capabilities: {
              tools: {},
            },
          }
        );

        // Add a test tool
        server.tool(
          "echo",
          "A simple echo tool",
          {
            message: z.string().describe("Message to echo"),
          },
          async ({ message }): Promise<CallToolResult> => {
            return {
              content: [
                {
                  type: "text",
                  text: `Echo: ${message}`,
                },
              ],
            };
          }
        );

        return server;
      },
    });

    // Start the server on a random port
    const address = await app.listen({ port: 0 });
    if (typeof address === "string") {
      baseUrl = address;
    } else {
      // The address object returned by Fastify has a port property
      const addressInfo = address as { port: number };
      baseUrl = `http://localhost:${addressInfo.port}`;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("should handle initialization requests", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
          protocolVersion: "2025-03-26",
          capabilities: {},
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["mcp-session-id"]).toBeDefined();

    // Check the response body for the server info
    const messageLines = response.body.split("\n");
    const dataLine = messageLines.find((line: string) =>
      line.startsWith("data:")
    );

    if (!dataLine) {
      throw new Error("No data line found in SSE response");
    }

    const data = JSON.parse(dataLine.substring(5));
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe("1");
    expect(data.result.serverInfo.name).toBe("test-server");
    expect(data.result.capabilities.tools).toBeDefined();
  });

  it("should reject requests without a valid session ID", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "2",
        method: "tools/list",
        params: {},
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should handle tool requests with a valid session ID", async () => {
    // First initialize to get a session ID
    const initResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
          protocolVersion: "2025-03-26",
          capabilities: {},
        },
      },
    });

    const sessionId = initResponse.headers["mcp-session-id"];

    // Now make a tool request with the session ID
    const toolResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      payload: {
        jsonrpc: "2.0",
        id: "2",
        method: "tools/list",
        params: {},
      },
    });

    expect(toolResponse.statusCode).toBe(200);

    // Parse the SSE response to get the tools list
    const messageLines = toolResponse.body.split("\n");
    const dataLine = messageLines.find((line: string) =>
      line.startsWith("data:")
    );

    if (!dataLine) {
      throw new Error("No data line found in SSE response");
    }

    const data = JSON.parse(dataLine.substring(5));
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe("2");
    expect(Array.isArray(data.result.tools)).toBe(true);
    expect(data.result.tools.length).toBe(1);
    expect(data.result.tools[0].name).toBe("echo");
  });

  it("should handle GET requests for SSE streams", async () => {
    // First initialize to get a session ID
    const initResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
          protocolVersion: "2025-03-26",
          capabilities: {},
        },
      },
    });

    const sessionId = initResponse.headers["mcp-session-id"];

    // Try to establish GET SSE stream
    const getResponse = await app.inject({
      method: "GET",
      url: "/mcp",
      headers: {
        Accept: "text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.headers["content-type"]).toContain("text/event-stream");
  }, 10000);

  it("should handle DELETE requests for session termination", async () => {
    // First initialize to get a session ID
    const initResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {
          clientInfo: {
            name: "test-client",
            version: "1.0.0",
          },
          protocolVersion: "2025-03-26",
          capabilities: {},
        },
      },
    });

    const sessionId = initResponse.headers["mcp-session-id"];

    // Try to terminate the session
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: {
        "Mcp-Session-Id": sessionId,
      },
    });

    expect(deleteResponse.statusCode).toBe(200);

    // Verify the session is terminated by trying to use it again
    const toolResponse = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      payload: {
        jsonrpc: "2.0",
        id: "2",
        method: "tools/list",
        params: {},
      },
    });

    // Should fail because the session is terminated
    expect(toolResponse.statusCode).toBe(400);
  }, 10000);
});
