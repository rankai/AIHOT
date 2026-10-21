export const AGENTKEY_MCP_URL = "https://api.agentkey.app/v1/mcp";
export const AGENTKEY_TIMEOUT_MS = 120_000;
export const AGENTKEY_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class AgentKeyConfigurationError extends Error {}

/** Read only the three named environment values; never load credential files or dotenv. */
export function agentKeyConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.AGENTKEY_CALLS_ENABLED !== "true") throw new AgentKeyConfigurationError("AgentKey calls disabled");
  const key = env.AGENTKEY_API_KEY?.trim();
  if (!key || /[\r\n]/.test(key)) throw new AgentKeyConfigurationError("AgentKey API key missing or invalid");
  const rawUrl = env.AGENTKEY_MCP_URL ?? AGENTKEY_MCP_URL;
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new AgentKeyConfigurationError("Invalid AgentKey MCP endpoint"); }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  const testEndpoint = env.NODE_ENV === "test" && env.AIHOT_ENVIRONMENT !== "production"
    && env.AGENTKEY_MCP_URL !== undefined && url.protocol === "http:" && loopback;
  if (url.username || url.password || url.search || url.hash || rawUrl.includes("?") || rawUrl.includes("#")
    || (rawUrl !== AGENTKEY_MCP_URL && !testEndpoint)) {
    throw new AgentKeyConfigurationError("AgentKey MCP endpoint not allowed");
  }
  return { key, url };
}
