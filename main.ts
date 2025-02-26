import fs from "fs";
import { Client as NotionClient } from "@notionhq/client";
import { WebClient as SlackClient } from "@slack/web-api";

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

// get notion page url from first argument
const notionPageUrl = process.argv[2];

function extractNotionPageId(url: string): string | null {
  const match = url.match(/([a-f0-9]{32})$/);
  return match ? match[1] : null;
}

// get notion page id from url

console.log(`Page URL: ${notionPageUrl}`);

const pageId = extractNotionPageId(notionPageUrl);
if (!pageId) {
  throw new Error("Invalid Notion page URL");
}
const notionPageId = pageId;

console.log(`Page ID: ${pageId}`);

function formatSlackTimestamp(ts: string): string {
  ts = ts.replace(/\./, "");
  ts = ts.substring(0, 10) + "." + ts.substring(10);
  return ts;
}

// Function to fetch Slack message using the Slack Web API
async function fetchSlackMessage(
  ts: string,
  channelId: string
): Promise<string | null> {
  const result = await slack.conversations.history({
    channel: channelId,
    latest: formatSlackTimestamp(ts),
    limit: 1,
    inclusive: true,
  });

  if (result.ok && result.messages) {
    console.log(result.messages);
    return result.messages[0]?.text ?? null;
  } else {
    throw new Error(`Failed to fetch Slack message: ${result.error}`);
  }
}

// Function to extract Slack message links from Notion page content
async function updatePage() {
  const response = await notion.blocks.children.list({
    block_id: notionPageId, // The parent block ID where the Slack message is inserted
  });

  const blocks = response.results;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!("type" in block)) continue;
    if (block.type === "paragraph") {
      const items: any[] = [];
      for (const element of block.paragraph.rich_text) {
        if (element.type !== "mention" || !element.href) continue;

        // TODO: detect expanded
        // if (textElement.text.content.match(/Slack message ID: \d{10,}/)) {
        //   continue;
        // }

        console.log(element);
        items.push(element);

        const url = element.href;
        const urlMatch = url.match(
          /https:\/\/[a-z]+\.slack\.com\/archives\/([^/]+)\/p(\d{10,})/
        );
        if (!urlMatch) {
          continue;
        }
        const [, channelId, ts] = urlMatch;
        console.log(`got it: ${channelId}, ${ts}`);
        const slackMessage = await fetchSlackMessage(ts, channelId);

        if (!slackMessage) {
          continue;
        }

        console.log(slackMessage);

        // Check if next block is already a quote
        const nextBlock = blocks[i + 1];
        if (nextBlock && "type" in nextBlock && nextBlock.type === "quote") {
          continue;
        }

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
    } else if (block.type === "link_preview") {
      const url = block.link_preview.url;
      const urlMatch = url.match(
        /https:\/\/[a-z]+\.slack\.com\/archives\/([^/]+)\/p(\d{10,})/
      );
      if (!urlMatch) {
        continue;
      }
      const [, channelId, ts] = urlMatch;
      console.log(`got it: ${channelId}, ${ts}`);
      const slackMessage = await fetchSlackMessage(ts, channelId);

      if (!slackMessage) {
        continue;
      }

      console.log(slackMessage);

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
      await notion.blocks.delete({
        block_id: block.id,
      });
    }
  }
}

async function main() {
  try {
    await updatePage();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
