import { Client, StreamableHTTPClientTransport, type FetchLike } from "@modelcontextprotocol/client";
import { ProviderRejectedError, type CallOutcome } from "../receipts.ts";
import { AGENTKEY_MAX_RESPONSE_BYTES, AGENTKEY_TIMEOUT_MS, agentKeyConfig } from "./config.ts";
import { agentKeyOutcome, explicitAgentKeyError, object, parseLosslessJson, redactEvidence, wireMessage, type AgentKeyResponse, type WireEvidence } from "./response.ts";
import { douyinSearchRoute } from "./douyin-contract.ts";
import { agentKeyRouteInput, type AgentKeyRoute } from "./routes.ts";

export interface AgentKeyTransportOptions { env?: NodeJS.ProcessEnv; fetch?: FetchLike }

/** One SDK tools/call, no auth refresh, reconnect, fallback provider, or implicit replay. */
export function agentKeyTransport(options: AgentKeyTransportOptions = {}) {
  const { key, url } = agentKeyConfig(options.env);
  return {
    endpoint: url.href,
    async execute(input: unknown, route: AgentKeyRoute = douyinSearchRoute): Promise<CallOutcome> {
      const params = agentKeyRouteInput(route,input);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AGENTKEY_TIMEOUT_MS);
      let toolRequestId: unknown;
      let lastRequestId: unknown;
      let sentTool = false;
      let lastWire: WireEvidence | undefined;
      let toolWire: WireEvidence | undefined;
      let deterministicRejection: ProviderRejectedError | undefined;
      const boundedFetch: FetchLike = async (input, init) => {
        if (new URL(input instanceof Request ? input.url : String(input)).href !== url.href) {
          throw new ProviderRejectedError("AgentKey endpoint changed", null, false);
        }
        let isTool = false;
        if (typeof init?.body === "string") {
          const request = object(parseLosslessJson(init.body));
          lastRequestId = request?.id;
          if (request?.method === "tools/call") {
            if (sentTool) throw new ProviderRejectedError("AgentKey automatic replay blocked", null, false);
            sentTool = true;
            isTool = true;
            toolRequestId = request.id;
          }
        }
        const response = await (options.fetch ?? fetch)(input, { ...init, redirect: "manual",
          signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
        const wire: WireEvidence = { status: response.status, contentType: response.headers.get("content-type") ?? "",
          body: "", complete: !response.body, requestId: response.headers.get("x-request-id") ?? undefined,
          retryAfter: response.headers.get("retry-after") ?? undefined };
        lastWire = wire;
        if (isTool) toolWire = wire;
        if (Number(response.headers.get("content-length")) > AGENTKEY_MAX_RESPONSE_BYTES) {
          await response.body?.cancel();
          deterministicRejection = new ProviderRejectedError("AgentKey response exceeds byte limit", response.status, false);
          throw deterministicRejection;
        }
        if (!response.body) return response;
        let bytes = 0;
        const decoder = new TextDecoder();
        const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, stream) {
            bytes += chunk.byteLength;
            if (bytes > AGENTKEY_MAX_RESPONSE_BYTES) {
              controller.abort();
              deterministicRejection = new ProviderRejectedError("AgentKey response exceeds byte limit", response.status, false);
              throw deterministicRejection;
            }
            wire.body += decoder.decode(chunk, { stream: true });
            stream.enqueue(chunk);
          },
          flush() { wire.body += decoder.decode(); wire.complete = true; },
        }));
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      };
      const transport = new StreamableHTTPClientTransport(url, { fetch: boundedFetch,
        requestInit: { headers: { Authorization: `Bearer ${key}` }, redirect: "manual" },
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 0, maxReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 },
        onInsufficientScope: "throw", maxStepUpRetries: 0 });
      const client = new Client({ name: "aihot-agentkey", version: "1" }, { capabilities: {}, versionNegotiation: { mode: "legacy" } });
      try {
        await client.connect(transport, { timeout: AGENTKEY_TIMEOUT_MS, signal: controller.signal });
        const result = await client.callTool({ name: "execute_tool", arguments: { name: route.tool, params } },
          { timeout: AGENTKEY_TIMEOUT_MS, signal: controller.signal });
        // The SDK authorizes protocol success; captured JSON supplies unrounded integer tokens.
        const raw = wireMessage(toolWire, toolRequestId);
        const outcome = agentKeyOutcome(raw?.result ?? result, toolWire, key);
        if (explicitAgentKeyError(raw?.result ?? result, (outcome.response as AgentKeyResponse).envelope)) {
          throw new ProviderRejectedError("AgentKey returned a complete tool rejection; review response", toolWire?.status ?? 200, false, outcome);
        }
        return outcome;
      } catch (error) {
        if (error instanceof ProviderRejectedError) throw error;
        if (deterministicRejection) throw deterministicRejection;
        // After execute_tool is sent, auxiliary GET/handshake evidence cannot classify the tool call.
        const wire = sentTool ? toolWire : lastWire;
        const message = wireMessage(wire, sentTool ? toolRequestId : lastRequestId);
        if (message && object(message.error)) {
          const outcome = agentKeyOutcome({ structuredContent: object(message.error)?.data ?? message.error, error: message.error }, wire, key);
          throw new ProviderRejectedError("AgentKey returned a complete MCP rejection; review response", wire?.status ?? null, false, outcome);
        }
        if (wire?.complete && wire.status >= 300 && wire.status < 600) {
          let body: unknown = null;
          try { body = parseLosslessJson(wire.body); } catch { /* Preserve missing/non-JSON bodies as bounded HTTP evidence. */ }
          const outcome = agentKeyOutcome({ structuredContent: body }, wire, key);
          // A complete 429 is retained as received so the adapter can use the existing bounded retry flow.
          if (wire.status === 429) return outcome;
          throw new ProviderRejectedError("AgentKey returned a complete HTTP rejection; review response", wire.status, false, outcome);
        }
        // SDK errors can contain raw provider text. Only a bounded, credential-free reason escapes.
        throw new Error(`AgentKey transport/protocol outcome incomplete (${sentTool ? "execute sent" : "handshake"})`,
          { cause: typeof error === "object" ? undefined : redactEvidence(String(error), key) });
      } finally {
        controller.abort();
        clearTimeout(timer);
        await client.close().catch(() => {});
      }
    },
  };
}
