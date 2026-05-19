#!/usr/bin/env bun
/**
 * HTTP transport entry point for prudent-mcp.
 *
 * Exposes the MCP server over Streamable HTTP at POST/GET /mcp.
 * GET /mcp from a browser returns a human-readable hello page instead of a
 * raw protocol error — the pattern described at
 * https://news.ycombinator.com/item?id=43690993.
 *
 *   bun run serve                   # starts on port 3000
 *   PORT=8080 bun run serve         # custom port
 *   bun run inspect:http            # opens MCP Inspector against this server
 *
 * Each request creates a fresh transport+server instance (stateless mode).
 * For a read-only knowledge layer this is fine; there is no session state to
 * preserve between calls.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createServer } from "../src/server.ts";

const PORT = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : 3000;

function isBrowserRequest(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return (
    accept.includes("text/html") &&
    !accept.includes("application/json") &&
    !accept.includes("text/event-stream")
  );
}

function helloPage(origin: string): Response {
  const mcpUrl = `${origin}/mcp`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>prudent-mcp — IRB Validation Knowledge Server</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8f9fa;
      color: #212529;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0,0,0,.08);
      max-width: 680px;
      width: 100%;
      padding: 2.5rem 3rem;
    }
    .badge {
      display: inline-block;
      background: #e8f4fd;
      color: #0969da;
      font-size: .75rem;
      font-weight: 600;
      letter-spacing: .04em;
      text-transform: uppercase;
      padding: .25rem .6rem;
      border-radius: 4px;
      margin-bottom: 1rem;
    }
    h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: .5rem; }
    .subtitle { color: #6c757d; margin-bottom: 2rem; font-size: .95rem; }
    h2 { font-size: 1rem; font-weight: 600; margin-bottom: .75rem; color: #495057; }
    .endpoint-box {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 2rem;
      display: flex;
      align-items: center;
      gap: .75rem;
    }
    .endpoint-box code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: .9rem;
      word-break: break-all;
      flex: 1;
    }
    .copy-btn {
      flex-shrink: 0;
      background: #0969da;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: .35rem .75rem;
      font-size: .8rem;
      cursor: pointer;
      transition: background .15s;
    }
    .copy-btn:hover { background: #0550ae; }
    .surfaces {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: .75rem;
      margin-bottom: 2rem;
    }
    .surface {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: .75rem 1rem;
    }
    .surface .name { font-weight: 600; font-size: .9rem; margin-bottom: .2rem; }
    .surface .desc { font-size: .78rem; color: #6c757d; }
    .steps { list-style: none; counter-reset: steps; }
    .steps li {
      counter-increment: steps;
      display: flex;
      gap: .75rem;
      margin-bottom: .75rem;
      font-size: .9rem;
    }
    .steps li::before {
      content: counter(steps);
      flex-shrink: 0;
      width: 1.5rem;
      height: 1.5rem;
      background: #0969da;
      color: #fff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: .75rem;
      font-weight: 700;
    }
    footer {
      margin-top: 2rem;
      padding-top: 1.25rem;
      border-top: 1px solid #e9ecef;
      font-size: .8rem;
      color: #6c757d;
    }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">MCP Server</span>
    <h1>prudent-mcp</h1>
    <p class="subtitle">
      IRB credit-risk model validation knowledge base &mdash; structured for AI assistants.
    </p>

    <h2>Server endpoint</h2>
    <div class="endpoint-box">
      <code id="url">${mcpUrl}</code>
      <button class="copy-btn" onclick="copyUrl()">Copy</button>
    </div>

    <h2>Knowledge surfaces</h2>
    <div class="surfaces">
      <div class="surface">
        <div class="name">regulation://</div>
        <div class="desc">Basel, CRR, EBA guidelines with versioning &amp; commentary</div>
      </div>
      <div class="surface">
        <div class="name">test://</div>
        <div class="desc">Statistical tests, acceptance criteria, equivalence families</div>
      </div>
      <div class="surface">
        <div class="name">check://</div>
        <div class="desc">Validation checks traceable to regulatory requirements</div>
      </div>
      <div class="surface">
        <div class="name">playbook://</div>
        <div class="desc">Structured review walkthroughs with phase-by-phase guidance</div>
      </div>
    </div>

    <h2>How to connect</h2>
    <ol class="steps">
      <li>Copy the server endpoint above.</li>
      <li>Open your MCP client (Claude Desktop, Cursor, Continue, etc.).</li>
      <li>Add a new MCP server and paste the URL when prompted.</li>
      <li>The assistant will now have access to the full IRB validation corpus.</li>
    </ol>

    <footer>
      This is an MCP (Model Context Protocol) server endpoint &mdash; it speaks
      JSON-RPC over HTTP, not a regular web page. Opening it in a browser is fine,
      but to use it you need to add the URL to an MCP-compatible AI client.
    </footer>
  </div>
  <script>
    function copyUrl() {
      navigator.clipboard.writeText(document.getElementById('url').textContent);
      const btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const bunServer = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    if (req.method === "GET" && isBrowserRequest(req)) {
      return helloPage(url.origin);
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const mcpServer = createServer();
    await mcpServer.connect(transport);
    return transport.handleRequest(req);
  },
});

console.log(`prudent-mcp HTTP server listening on port ${bunServer.port}`);
console.log(`MCP endpoint: http://localhost:${bunServer.port}/mcp`);
