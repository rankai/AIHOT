// Verifies MCP with the official SDK client: handshake, list the five tools, call each once.
// node scripts/mcp-check.ts [url]
import { Client, INVALID_PARAMS, ProtocolError, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_TOOL_NAMES as T } from "@aihot/contracts/mcp";
const url = new URL(process.argv[2] ?? "http://127.0.0.1:3001/api/mcp");
const client = new Client({ name: "aihot-mcp-check", version: "1.0.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(url));
  const info = client.getServerVersion?.();
  console.log("server:", JSON.stringify(info));
  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));
  for (const name of Object.values(T)) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Missing expected tool: ${name}`);
  }
  const calls: Array<[string, Record<string, unknown>]> = [
    [T.latest, { limit: 2 }],
    [T.search, { q: "OpenAI", limit: 2 }],
    [T.hot, { limit: 3 }],
    [T.daily, {}],
  ];
  for (const [name, args] of calls) {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    const structured = r.structuredContent as { error?: { code?: string }; items?: Array<{ links: { story: string } }> } | undefined;
    const emptyDaily = name === T.daily && r.isError && structured?.error?.code === "not_found";
    console.log(`${name} ${JSON.stringify(args)} → ${emptyDaily ? "empty" : r.isError ? "ERROR" : "ok"} | ${text.replace(/\n/g, " ").slice(0, 140)}`);
    if (r.isError && !emptyDaily) throw new Error(`${name} failed`);
    if (name === T.hot) {
      const storyId = structured?.items?.[0]?.links?.story?.split("/").pop();
      if (storyId) calls.push([T.story, { public_id: storyId, report_limit: 3 }]);
      else if (structured?.items?.length === 0) console.log(`${T.story} → SKIP (no hot topics)`);
      else throw new Error(`${T.hot} did not return a story link or an empty items list`);
    }
  }

  // This deliberately invalid request must fail validation, rather than fail for any other reason.
  try {
    const r = await client.callTool({ name: T.latest, arguments: { limit: 99 } });
    const code = (r.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
    const text = (r.content as Array<{ type: string; text?: string }>).map((item) => item.text ?? "").join(" ");
    const validation = code ? code === "invalid_request" || code === "invalid_params"
      : text.startsWith(`Input validation error: Invalid arguments for tool ${T.latest}:`);
    if (!r.isError || !validation) throw new Error(`${T.latest} limit=99 did not return a validation error`);
  } catch (error) {
    if (!(error instanceof ProtocolError && error.code === INVALID_PARAMS)) throw error;
  }
  console.log(`${T.latest} {"limit":99} → expected invalid parameters`);
} finally {
  await client.close();
}
