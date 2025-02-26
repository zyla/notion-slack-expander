# notion-slack-expander

A script to expand Slack links in a Notion document.

Upon finding a slack link, adds content of the message below.

## Why?

Q: Why do it when the Notion-Slack integration can do it?

A: It requires godlike permissions (acting as you on slack). So this is a way of reducing them.

## Usage

1. `cp .secrets.json.example .secrets.json`

2. Edit `.secrets.json` and add appropriate tokens

3. `npx ts-node main.ts <notion document link>`

WARNING: edits made by this script don't seem to be registered properly in
Notion change history, and can't be undone. Back up your documents.
