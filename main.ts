import fs from "fs";
import { Client as NotionClient } from "@notionhq/client";
import { WebClient as SlackClient } from "@slack/web-api";
import { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

interface Secrets {
  slackApiToken: string;
  notionApiToken: string;
}

const secrets: Secrets = JSON.parse(
  fs.readFileSync(".secrets.json", { encoding: "utf-8" })
);

const notion = new NotionClient({
  auth: secrets.notionApiToken,
});

const slack = new SlackClient(secrets.slackApiToken);

function formatSlackTimestamp(ts: string): string {
  ts = ts.replace(/\./, "");
  ts = ts.substring(0, 10) + "." + ts.substring(10);
  return ts;
}

// Function to fetch Slack message using the Slack Web API
async function fetchSlackMessage({
  channelId,
  ts,
  threadTs,
}: SlackMessageId): Promise<string | null> {
  console.log({
    channel: channelId,
    latest: formatSlackTimestamp(ts),
    limit: 1,
    inclusive: true,
  });
  const result = threadTs
    ? await slack.conversations.replies({
        channel: channelId,
        ts: threadTs,
        latest: formatSlackTimestamp(ts),
        limit: 1,
        inclusive: true,
      })
    : await slack.conversations.history({
        channel: channelId,
        latest: formatSlackTimestamp(ts),
        limit: 1,
        inclusive: true,
      });

  if (result.ok && result.messages) {
    console.log(result.messages);
    const msg = result.messages.find(
      (msg) => msg.ts === formatSlackTimestamp(ts)
    );
    return msg?.text ?? null;
  } else {
    throw new Error(`Failed to fetch Slack message: ${result.error}`);
  }
}

type SlackMessageId = {
  channelId: string;
  ts: string;
  threadTs: string | null;
};

function parseSlackUrl(url: string): SlackMessageId | null {
  const urlMatch = url.match(
    /https:\/\/[a-z]+\.slack\.com\/archives\/([^/]+)\/p(\d{10,})/
  );
  if (!urlMatch) {
    return null;
  }
  const [, channelId, ts] = urlMatch;

  const urlObj = new URL(url);
  const threadTs = urlObj.searchParams.get("thread_ts");

  return { channelId, ts, threadTs };
}

// Function to extract Slack message links from Notion page content
async function updatePage(notionPageId: string) {
  const response = await notion.blocks.children.list({
    block_id: notionPageId, // The parent block ID where the Slack message is inserted
  });

  const blocks = response.results;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!("type" in block)) continue;
    console.log(block);

    const result = getSlackMessageIdFromBlock(block);
    if (!result) {
      continue;
    }
    const { url, slackMessageId } = result;

    const slackMessage = await fetchSlackMessage(slackMessageId);

    if (!slackMessage) {
      continue;
    }

    console.log(slackMessage);

    // Check if next block is already a quote.
    // If so, update the quote block, else insert a new one.
    const nextBlock = blocks[i + 1];
    if (nextBlock && "type" in nextBlock && nextBlock.type === "quote") {
      await notion.blocks.update({
        block_id: nextBlock.id,
        quote: {
          rich_text: [
            {
              type: "text",
              text: {
                content: slackMessage,
              },
            },
          ],
        },
      });
    } else {
      await notion.blocks.children.append({
        block_id: notionPageId,
        after: block.id,
        children: [
          {
            type: "quote",
            quote: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: slackMessage,
                  },
                },
              ],
            },
          },
        ],
      });
    }

    // Replace link preview with plain text link
    if (block.type === "link_preview") {
      await notion.blocks.children.append({
        block_id: notionPageId,
        after: block.id,
        children: [
          {
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: url,
                    link: { url },
                  },
                },
              ],
            },
          },
        ],
      });
      await notion.blocks.delete({
        block_id: block.id,
      });
    }
  }
}

function extractNotionPageId(url: string): string | null {
  const match = url.match(/([a-f0-9]{32})$/);
  return match ? match[1] : null;
}

async function main() {
  try {
    const pageUrl = process.argv[2];

    const slackmsg = parseSlackUrl(pageUrl);
    if (slackmsg) {
      console.log(slackmsg);
      const msg = await fetchSlackMessage(slackmsg);
      console.log(msg);
      return;
    }

    // get notion page id from url

    console.log(`Page URL: ${pageUrl}`);

    const pageId = extractNotionPageId(pageUrl);
    if (!pageId) {
      throw new Error("Invalid Notion page URL");
    }

    console.log(`Page ID: ${pageId}`);

    await updatePage(pageId);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();

function getSlackMessageIdFromBlock(
  block: BlockObjectResponse
): { url: string; slackMessageId: SlackMessageId } | null {
  if (block.type === "paragraph") {
    for (const element of block.paragraph.rich_text) {
      const url =
        element.type === "mention" && element.href
          ? element.href
          : element.type === "text" && element.text.link
          ? element.text.link.url
          : null;
      if (!url) {
        continue;
      }
      const slackMessageId = parseSlackUrl(url);
      if (slackMessageId) {
        return { url, slackMessageId };
      }
    }
  } else if (block.type === "link_preview") {
    const url = block.link_preview.url;
    const slackMessageId = parseSlackUrl(url);
    if (slackMessageId) {
      return { url, slackMessageId };
    }
  }
  return null;
}
