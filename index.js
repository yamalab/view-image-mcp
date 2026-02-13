#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CHUNK_SIZE = 4096;

function detectFormat(buffer) {
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "jpeg";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return "unknown";
}

function convertToPng(inputPath) {
  const tmpPath = `/tmp/view-image-mcp-${Date.now()}.png`;
  execFileSync("sips", ["-s", "format", "png", inputPath, "--out", tmpPath], {
    stdio: "ignore",
  });
  return tmpPath;
}

function writeTtyKitty(pngBase64) {
  const fd = fs.openSync("/dev/tty", "w");
  try {
    for (let i = 0; i < pngBase64.length; i += CHUNK_SIZE) {
      const chunk = pngBase64.slice(i, i + CHUNK_SIZE);
      const isFirst = i === 0;
      const isLast = i + CHUNK_SIZE >= pngBase64.length;
      const m = isLast ? 0 : 1;

      if (isFirst) {
        fs.writeSync(fd, `\x1b_Gf=100,a=T,t=d,m=${m};${chunk}\x1b\\`);
      } else {
        fs.writeSync(fd, `\x1b_Gm=${m};${chunk}\x1b\\`);
      }
    }
    fs.writeSync(fd, "\n");
  } finally {
    fs.closeSync(fd);
  }
}

function displayImageFile(filePath) {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const buffer = fs.readFileSync(absPath);
  const format = detectFormat(buffer);

  if (format === "png") {
    writeTtyKitty(buffer.toString("base64"));
  } else if (["jpeg", "gif", "webp"].includes(format)) {
    const tmpPng = convertToPng(absPath);
    try {
      const pngBuffer = fs.readFileSync(tmpPng);
      writeTtyKitty(pngBuffer.toString("base64"));
    } finally {
      fs.unlinkSync(tmpPng);
    }
  } else {
    // Try sending as-is — terminal may handle it
    writeTtyKitty(buffer.toString("base64"));
  }
}

const server = new McpServer({
  name: "view-image",
  version: "1.0.0",
});

server.tool(
  "view_image",
  "Display an image file inline in the terminal using Kitty graphics protocol (Ghostty/Kitty). The image appears directly in the user's terminal.",
  {
    path: z.string().describe("Absolute or relative path to the image file"),
  },
  async ({ path: imagePath }) => {
    try {
      const absPath = path.resolve(imagePath);
      displayImageFile(absPath);
      return {
        content: [
          {
            type: "text",
            text: `Image displayed inline in terminal: ${absPath}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error displaying image: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
