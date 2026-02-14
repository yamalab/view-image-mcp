#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const CHUNK_SIZE = 4096;
const SIPS_TIMEOUT = 30_000; // 30s

type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "unknown";

function isTermux(): boolean {
  return "TERMUX_VERSION" in process.env;
}

function isMacOS(): boolean {
  return process.platform === "darwin";
}

/**
 * パスを検証し、実在する絶対パスを返す。
 * パストラバーサル・シンボリックリンク攻撃・ヌルバイト攻撃を防止。
 */
function validatePath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid path");
  }

  const resolved = path.resolve(filePath);

  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, "File not found");
  }

  return realPath;
}

function detectFormat(buffer: Buffer): ImageFormat {
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

function convertToPngMacOS(inputPath: string): { tmpPath: string; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "view-image-mcp-"));
  const tmpPath = path.join(tmpDir, "converted.png");
  try {
    execFileSync("sips", ["-s", "format", "png", inputPath, "--out", tmpPath], {
      stdio: "ignore",
      timeout: SIPS_TIMEOUT,
    });
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
  return { tmpPath, tmpDir };
}

async function convertToPngSharp(inputPath: string): Promise<{ tmpPath: string; tmpDir: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "view-image-mcp-"));
  const tmpPath = path.join(tmpDir, "converted.png");
  try {
    const { default: sharp } = await import("sharp");
    await sharp(inputPath).png().toFile(tmpPath);
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
  return { tmpPath, tmpDir };
}

function writeTtyKitty(pngBase64: string): void {
  let fd: number;
  try {
    fd = fs.openSync("/dev/tty", "w");
  } catch {
    throw new Error(
      "Cannot open /dev/tty: terminal is not available in this environment",
    );
  }
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

const MIME_TYPES: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  unknown: "image/*",
};

/**
 * Termux: am start で Android の画像ビューアを起動。
 * 変換不要（Android ビューアが全フォーマット対応）。
 */
function displayImageTermux(absPath: string, buffer: Buffer): void {
  const format = detectFormat(buffer);
  const mimeType = MIME_TYPES[format];
  execFileSync("am", [
    "start", "-a", "android.intent.action.VIEW",
    "-d", `file://${absPath}`,
    "-t", mimeType,
  ], {
    stdio: "ignore",
    timeout: SIPS_TIMEOUT,
  });
}

/**
 * macOS/Linux: Kitty graphics protocol で端末にインライン表示。
 */
async function displayImageKitty(absPath: string, buffer: Buffer): Promise<void> {
  const format = detectFormat(buffer);

  if (format === "png") {
    writeTtyKitty(buffer.toString("base64"));
  } else if (["jpeg", "gif", "webp"].includes(format)) {
    let tmpDir: string;
    let tmpPath: string;
    if (isMacOS()) {
      ({ tmpPath, tmpDir } = convertToPngMacOS(absPath));
    } else {
      ({ tmpPath, tmpDir } = await convertToPngSharp(absPath));
    }
    try {
      const pngBuffer = fs.readFileSync(tmpPath);
      writeTtyKitty(pngBuffer.toString("base64"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } else {
    // Try sending as-is — terminal may handle it
    writeTtyKitty(buffer.toString("base64"));
  }
}

async function displayImageFile(filePath: string): Promise<string> {
  const absPath = validatePath(filePath);

  const stat = fs.statSync(absPath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum allowed size is 50MB`,
    );
  }

  const buffer = fs.readFileSync(absPath);

  if (isTermux()) {
    displayImageTermux(absPath, buffer);
    return `Image opened in Android viewer: ${absPath}`;
  }

  await displayImageKitty(absPath, buffer);
  return `Image displayed inline in terminal: ${absPath}`;
}

const server = new McpServer({
  name: "view-image",
  version: "1.0.0",
});

server.registerTool("view_image", {
  title: "View Image",
  description:
    "Display an image file. On Termux (Android), opens in the system image viewer. On macOS/Linux, displays inline using Kitty graphics protocol.",
  inputSchema: {
    path: z
      .string()
      .max(4096)
      .describe("Absolute or relative path to the image file"),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ path: imagePath }) => {
  try {
    server.sendLoggingMessage({
      level: "info",
      data: "Displaying image",
    });

    const message = await displayImageFile(imagePath);

    return {
      content: [
        {
          type: "text" as const,
          text: message,
        },
      ],
    };
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    server.sendLoggingMessage({
      level: "error",
      data: `Failed to display image: ${message}`,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Error displaying image: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

function shutdown(): void {
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
