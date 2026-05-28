process.env.WATCHTOWER_MCP = '1';
require('dotenv').config();

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const channels = require('./channels');

const CHANNEL_NAMES = channels.ALL.map((c) => c.name);
const channelArg = z
  .array(z.enum(CHANNEL_NAMES))
  .optional()
  .describe(`Channels to dispatch to. Available: ${CHANNEL_NAMES.join(', ')}. Omit to use defaults / all enabled.`);

function formatResult(result) {
  const lines = [];
  if (result.delivered.length) lines.push(`Delivered to: ${result.delivered.join(', ')}`);
  if (result.errors.length) {
    lines.push('Errors:');
    for (const e of result.errors) lines.push(`  - ${e.channel || '(none)'}: ${e.error}`);
  }
  return { content: [{ type: 'text', text: lines.join('\n') || 'No-op' }] };
}

const server = new McpServer({
  name: 'watch-tower',
  version: '1.1.0',
});

server.tool(
  'send_message',
  'Send a plain text notification to one or more channels.',
  {
    text: z.string().describe('Message body'),
    title: z.string().optional().describe('Optional title / header'),
    parse_mode: z.string().optional().describe('Telegram parse mode: Markdown, MarkdownV2, or HTML'),
    channels: channelArg,
  },
  async ({ text, title, parse_mode, channels: ch }) => {
    const result = await channels.notify({ text, title, parse_mode, channels: ch });
    return formatResult(result);
  }
);

server.tool(
  'send_alert',
  'Send a formatted alert with a severity level. Maps to native priority on Pushover/Gotify/ntfy.',
  {
    level: z.enum(['info', 'warn', 'error', 'critical']).describe('Severity level'),
    title: z.string().describe('Alert title'),
    message: z.string().describe('Alert body'),
    channels: channelArg,
  },
  async ({ level, title, message, channels: ch }) => {
    const formattedTitle = `${channels.LEVEL_EMOJI[level] || ''} ${title}`.trim();
    const result = await channels.notify({
      text: message,
      title: formattedTitle,
      level,
      channels: ch,
    });
    return formatResult(result);
  }
);

server.tool(
  'send_log',
  'Send a code-formatted log entry from a source application.',
  {
    source: z.string().describe('Name of the source application or service'),
    log: z.string().describe('Log content'),
    channels: channelArg,
  },
  async ({ source, log, channels: ch }) => {
    const result = await channels.notify({
      text: '```\n' + log + '\n```',
      title: `📋 Log from ${source}`,
      parse_mode: 'Markdown',
      channels: ch,
    });
    return formatResult(result);
  }
);

server.tool(
  'send_file',
  'Send a local file as an attachment / document. Channels that do not support attachments will receive a textual fallback.',
  {
    path: z.string().describe('Absolute path to the file on the server'),
    caption: z.string().optional().describe('Optional caption'),
    filename: z.string().optional().describe('Override display filename'),
    title: z.string().optional(),
    level: z.enum(['info', 'warn', 'error', 'critical']).optional(),
    channels: channelArg,
  },
  async ({ path: filePath, caption, filename, title, level, channels: ch }) => {
    const result = await channels.notifyFile({ filePath, caption, filename, title, level, channels: ch });
    return formatResult(result);
  }
);

server.tool(
  'list_channels',
  'List notification channels and whether they are configured / enabled.',
  {},
  async () => {
    const rows = channels.ALL.map((c) => `${c.enabled ? '✅' : '⬜️'} ${c.name}`);
    return { content: [{ type: 'text', text: rows.join('\n') }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[WatchTower MCP] Server running on stdio');
  console.error(`[WatchTower MCP] Enabled channels: ${channels.enabledChannels().map((c) => c.name).join(', ') || 'none'}`);
}

main().catch((err) => {
  console.error('[WatchTower MCP] Fatal error:', err);
  process.exit(1);
});
