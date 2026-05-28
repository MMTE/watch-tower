process.env.WATCHTOWER_MCP = '1';
require('dotenv').config();

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const channels = require('./channels');
const { createMcpServer } = require('./mcpServer');

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[WatchTower MCP] Server running on stdio');
  console.error(`[WatchTower MCP] Enabled channels: ${channels.enabledChannels().map((c) => c.name).join(', ') || 'none'}`);
}

main().catch((err) => {
  console.error('[WatchTower MCP] Fatal error:', err);
  process.exit(1);
});
