const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const channels = require('./channels');
const replies = require('./replies');
const pkg = require('../package.json');

const LEVELS = ['info', 'warn', 'error', 'critical'];
const CHANNEL_NAMES = channels.ALL.map((c) => c.name);
const channelArg = z
  .array(z.enum(CHANNEL_NAMES))
  .optional()
  .describe(`Channels to dispatch to. Available: ${CHANNEL_NAMES.join(', ')}. Omit to use defaults / all enabled.`);

const INSTRUCTIONS = [
  'Watch Tower notifies humans through Telegram, Bale, Pushover, Gotify, and ntfy — and reads their replies back to you.',
  "Loop: 1) send(...) and note the telegram message_id in the result. 2) get_replies({ since, wait }) — the human's answer arrives with reply_to_message_id linking it to your message. 3) send(..., { reply_to }) answers in the same thread.",
  'Start with list_channels() if unsure what is configured.',
].join('\n');

function formatResult(result) {
  const lines = [];
  if (result.delivered.length) {
    const ids = Object.entries(result.message_ids || {})
      .map(([name, id]) => `${name}: message_id ${id}`)
      .join(', ');
    lines.push(`Delivered to: ${result.delivered.join(', ')}${ids ? ` (${ids})` : ''}`);
  }
  if (result.errors.length) {
    lines.push(`Failed: ${result.errors.map((e) => `${e.channel || 'n/a'}: ${e.error}`).join('; ')}`);
  }
  return { content: [{ type: 'text', text: lines.join('\n') || 'No channels delivered' }] };
}

function createMcpServer() {
  const server = new McpServer(
    { name: 'watch-tower', version: pkg.version },
    { instructions: INSTRUCTIONS }
  );

  server.tool(
    'send',
    'Send a notification to a human. Example: {"text":"deploy #42 finished","title":"prod","level":"info"}. level maps to native priority on Pushover/Gotify/ntfy. The result includes the telegram message_id — pass it back as reply_to to thread a follow-up.',
    {
      text: z.string().describe('Message body'),
      title: z.string().optional().describe('Short header, shown bold on chat channels'),
      level: z.enum(LEVELS).optional().describe('Severity: info | warn | error | critical'),
      channels: channelArg,
      reply_to: z.number().optional().describe('Telegram message_id this message replies to (threads the conversation)'),
    },
    async ({ text, title, level, channels: ch, reply_to }) => {
      const result = await channels.notify({
        text,
        title: title && level ? `${channels.LEVEL_EMOJI[level]} ${title}` : title,
        level,
        reply_to,
        channels: ch,
      });
      return formatResult(result);
    }
  );

  server.tool(
    'send_file',
    'Send a local file as an attachment. Example: {"path":"/tmp/report.pdf","caption":"daily report"}. Channels without file support receive a textual fallback.',
    {
      path: z.string().describe('Absolute path to the file on the server'),
      caption: z.string().optional().describe('Optional caption'),
      filename: z.string().optional().describe('Override display filename'),
      title: z.string().optional().describe('Optional title'),
      level: z.enum(LEVELS).optional().describe('Severity: info | warn | error | critical'),
      reply_to: z.number().optional().describe('Telegram message_id this file replies to'),
      channels: channelArg,
    },
    async ({ path: filePath, caption, filename, title, level, reply_to, channels: ch }) => {
      const result = await channels.notifyFile({ filePath, caption, filename, title, level, reply_to, channels: ch });
      return formatResult(result);
    }
  );

  server.tool(
    'get_replies',
    'Read human replies captured from the Telegram chat. Example: {"since":4578,"wait":30} blocks up to 30 seconds for the next reply. Keep the highest id you have seen and pass it as since. Entries carry reply_to_message_id when they answer a specific notification.',
    {
      since: z.number().optional().describe('Only entries with id > since (high-water mark). Default 0 = all'),
      wait: z.number().optional().describe('Seconds to long-poll for a new reply (0-60, default 0)'),
      limit: z.number().optional().describe('Most recent N entries, oldest first (default 50)'),
    },
    async ({ since = 0, wait = 0, limit = 50 }) => {
      const entries = (await replies.waitFor(since, Math.min(wait, 60) * 1000)).slice(-limit);
      if (!entries.length) return { content: [{ type: 'text', text: 'No replies yet.' }] };
      const lines = entries.map((e) => `[${e.id}] ${e.ts}${e.reply_to_message_id ? ` (reply to ${e.reply_to_message_id})` : ''} ${e.text}`);
      lines.push(`Next call: since=${entries[entries.length - 1].id}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'list_channels',
    'List notification channels with configured state and two-way capability. Two-way channels capture human replies — read them with get_replies.',
    {},
    async () => {
      const rows = channels.ALL.map((c) => `${c.enabled ? '✅' : '⬜️'} ${c.name}${c.twoWay ? ' (two-way)' : ''}`);
      return { content: [{ type: 'text', text: rows.join('\n') }] };
    }
  );

  return server;
}

module.exports = { createMcpServer };
