import process from "node:process";
import type { Dirent, Stats } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import * as XLSX from "xlsx";
import { fileExtension } from "../../../../shared/attachments.ts";
import { convertWithPandocWasm } from "../../../pandoc.ts";
import type { FileAccessRoot } from "../../../security/file-access.ts";
import {
  comparableFileAccessPath,
  fileAccessRootForPath,
  isFileAccessPathIgnored,
  isFileAccessPathWithin,
} from "../../../security/file-access-rules.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../json-rpc.ts";
import { parseJsonRpcLine } from "../../json-rpc.ts";
import {
  createTrussFilesystemToolsMcpRuntime,
  type TrussFilesystemToolsRuntime,
} from "./runtime.ts";

interface TrussFilesystemToolsMcpServerOptions {
  allowedDirectories?: string[];
  readOnlyDirectories?: string[];
  trussHomeDir?: string;
  workspacePath?: string;
}

interface ToolCallParams {
  _meta?: unknown;
  arguments?: unknown;
  name?: unknown;
}

interface TrussFilesystemToolMeta {
  filesystemWorkspacePath?: string;
}

export type TrussFilesystemToolName =
  | "copy_file"
  | "create_directory"
  | "delete_file"
  | "directory_tree"
  | "get_file_access_grants"
  | "get_file_metadata"
  | "list_directory"
  | "list_directories"
  | "move_file"
  | "patch_text_file"
  | "read_document"
  | "read_multiple_files"
  | "read_text_file"
  | "regex_search_files"
  | "search_filenames"
  | "write_text_file";

interface ResolvedWorkspacePath {
  absolutePath: string;
  relativePath: string;
  rootPath: string;
}

interface WorkspaceCandidate {
  absolutePath: string;
  rootPath: string;
}

interface WalkState {
  skippedDirectories: number;
}

interface ClipResult {
  text: string;
  truncated: boolean;
}

interface EditableText {
  eol: string;
  hasTrailingNewline: boolean;
  lines: string[];
}

interface LineReplacement {
  content: string;
  endLine: number;
  startLine: number;
}

const defaultListLimit = 200;
const defaultTreeLimit = 100;
const defaultReadLineCount = 200;
const defaultReadMaxCharacters = 20_000;
const defaultDocumentMaxCharacters = 60_000;
const defaultSearchLimit = 100;
const defaultMaxSearchFileSizeBytes = 1_000_000;
const maxContextLines = 20;
const maxDirectoryTreeExtensions = 100;
const maxMultipleReadFiles = 50;
const maxPathLength = 4_000;
const maxPatchReplacements = 100;
const maxPatternLength = 2_000;
const maxWriteCharacters = 2_000_000;
const maxSearchPreviewLength = 240;
const binarySampleBytes = 8_192;
const pathBoundaryDeniedMessage = "Access denied. Path is outside the permitted boundary.";
const readOnlyAccessDeniedMessage = (rootPath: string) =>
  `Access denied: Directory ${rootPath} is granted as read-only.`;
const pandocInputFormatByExtension: Record<string, string> = {
  ".docx": "docx",
  ".epub": "epub",
  ".htm": "html",
  ".html": "html",
  ".odt": "odt",
  ".pptx": "pptx",
  ".rtf": "rtf",
  ".xlsx": "xlsx",
};
const spreadsheetFallbackExtensions = new Set([".ods", ".xls", ".xlsb", ".xlsm"]);

export const trussFilesystemToolDefinitions: Record<
  TrussFilesystemToolName,
  {
    description: string;
    inputSchema: Record<string, unknown>;
    name: TrussFilesystemToolName;
  }
> = {
  get_file_access_grants: {
    name: "get_file_access_grants",
    description:
      "Return the currently active Truss Filesystem Tools access grants for this MCP server process, including whether each root is read-only or read-write. Use before requesting more directory access when scope is unclear. This reports the resolved directories currently available to the tool runtime, not the full saved Security settings list.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  get_file_metadata: {
    name: "get_file_metadata",
    description:
      "Return metadata for a file or directory inside the active Truss file-access boundary, including type, size, and timestamps, without reading file contents.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "File or directory path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
      },
      required: ["path"],
    },
  },
  list_directory: {
    name: "list_directory",
    description:
      "List direct children of a directory inside the active Truss file-access boundary. Paths are resolved and enforced by Truss so results cannot escape their granted directory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          description: "Maximum entries to return. Defaults to 200 and caps at 1000.",
          maximum: 1_000,
          minimum: 1,
        },
        path: {
          type: "string",
          description: "Directory path relative to the primary file-access directory, or an absolute path inside any granted directory. Defaults to the primary directory and caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        skipLargeDirectories: {
          type: "boolean",
          description: "Skip recursively listing directories with more than 200 files in it. Defaults to true.",
          default: true,
        },
        skip_large_directories: {
          type: "boolean",
          description: "Skip recursively listing directories with more than 200 files in it. Defaults to true.",
          default: true,
        },
      },
    },
  },
  directory_tree: {
    name: "directory_tree",
    description:
      "Return a recursive directory tree inside the active Truss file-access boundary. The entry limit defaults to 100 and is configurable. Optional extension filters include matching files and their parent directories.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        extensions: {
          type: "array",
          description:
            "Optional file extensions to include, such as [\".php\", \".ts\"]. Directories are included only when they contain a matching file. Caps at 100 extensions.",
          maxItems: maxDirectoryTreeExtensions,
          items: {
            type: "string",
          },
        },
        limit: {
          type: "integer",
          description: "Maximum filesystem entries to include. Defaults to 100 and caps at 1000.",
          maximum: 1_000,
          minimum: 1,
        },
        path: {
          type: "string",
          description: "Root directory for the tree. Defaults to the primary file-access directory and caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        skipLargeDirectories: {
          type: "boolean",
          description: "Skip recursively listing directories with more than 200 files in it. Defaults to true.",
          default: true,
        },
        skip_large_directories: {
          type: "boolean",
          description: "Skip recursively listing directories with more than 200 files in it. Defaults to true.",
          default: true,
        },
      },
    },
  },
  list_directories: {
    name: "list_directories",
    description:
      "Return a recursive directory tree inside the active Truss file-access boundary. The entry limit defaults to 100 and is configurable. Optional extension filters include matching files and their parent directories.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        extensions: {
          type: "array",
          description:
            "Optional file extensions to include, such as [\".php\", \".ts\"]. Directories are included only when they contain a matching file. Caps at 100 extensions.",
          maxItems: maxDirectoryTreeExtensions,
          items: {
            type: "string",
          },
        },
        limit: {
          type: "integer",
          description: "Maximum filesystem entries to include. Defaults to 100 and caps at 1000.",
          maximum: 1_000,
          minimum: 1,
        },
        path: {
          type: "string",
          description: "Root directory for the tree. Defaults to the primary file-access directory and caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        skipLargeDirectories: {
          type: "boolean",
          description: "Skip recursively listing directories with more than 200 files in it. Defaults to true.",
          default: true,
        },
        skip_large_directories: {
          type: "boolean",
          description: "Skip recursively listing directories with more than 200 files in it. Defaults to true.",
          default: true,
        },
      },
    },
  },
  create_directory: {
    name: "create_directory",
    description:
      "Create a directory inside a writable Truss file-access boundary. Parent directories are created by default. Fails for read-only roots.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Directory path to create relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        recursive: {
          type: "boolean",
          description: "Create missing parent directories. Defaults to true.",
        },
      },
      required: ["path"],
    },
  },
  read_text_file: {
    name: "read_text_file",
    description:
      "Read selected lines from a UTF-8 text file inside the active Truss file-access boundary, with binary-file detection and a maximum returned character count.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        lineCount: {
          type: "integer",
          description: "Number of lines to read. Defaults to 200 and caps at 10000.",
          maximum: 10_000,
          minimum: 1,
        },
        maxCharacters: {
          type: "integer",
          description: "Maximum characters to return. Defaults to 20000 and caps at 500000.",
          maximum: 500_000,
          minimum: 1,
        },
        path: {
          type: "string",
          description: "Text file path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        startLine: {
          type: "integer",
          description: "One-based first line to read. Defaults to 1.",
          maximum: 1_000_000,
          minimum: 1,
        },
      },
      required: ["path"],
    },
  },
  read_multiple_files: {
    name: "read_multiple_files",
    description:
      "Read selected lines from multiple UTF-8 text files inside the active Truss file-access boundary in one call. Each file is bounded by the same line and character limits.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        lineCount: {
          type: "integer",
          description: "Number of lines to read from each file. Defaults to 200 and caps at 10000.",
          maximum: 10_000,
          minimum: 1,
        },
        maxCharacters: {
          type: "integer",
          description: "Maximum characters to return per file. Defaults to 20000 and caps at 500000.",
          maximum: 500_000,
          minimum: 1,
        },
        paths: {
          type: "array",
          description: "Text file paths relative to the primary file-access directory, or absolute paths inside any granted directory. Caps at 50 files and 4000 characters per path.",
          maxItems: maxMultipleReadFiles,
          minItems: 1,
          items: {
            type: "string",
            maxLength: maxPathLength,
          },
        },
        startLine: {
          type: "integer",
          description: "One-based first line to read from each file. Defaults to 1.",
          maximum: 1_000_000,
          minimum: 1,
        },
      },
      required: ["paths"],
    },
  },
  read_document: {
    name: "read_document",
    description:
      "Read a granted document and convert it to Markdown. Pandoc is used for HTML, EPUB, DOCX, ODT, RTF, PPTX, and XLSX; other spreadsheet formats use Truss' spreadsheet extractor.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxCharacters: {
          type: "integer",
          description: "Maximum Markdown characters to return. Defaults to 60000 and caps at 500000.",
          maximum: 500_000,
          minimum: 1,
        },
        path: {
          type: "string",
          description: "Document path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
      },
      required: ["path"],
    },
  },
  write_text_file: {
    name: "write_text_file",
    description:
      "Write UTF-8 text to a file inside a writable Truss file-access boundary. Existing files are replaced by default; pass overwrite: false to block replacement. Fails for read-only roots.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: {
          type: "string",
          description: "Complete text content to write. Caps at 2000000 characters.",
          maxLength: maxWriteCharacters,
        },
        overwrite: {
          type: "boolean",
          description: "Whether to replace an existing file. Defaults to true.",
        },
        path: {
          type: "string",
          description: "Target file path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
      },
      required: ["path", "content"],
    },
  },
  patch_text_file: {
    name: "patch_text_file",
    description:
      "Surgically edit a UTF-8 text file inside a writable Truss file-access boundary by replacing one or more one-based inclusive line ranges. For insertion, set endLine to startLine - 1. Fails for read-only roots.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Text file path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        replacements: {
          type: "array",
          description:
            "Line-range replacements to apply from top to bottom. Ranges must not overlap. Caps at 100 replacements.",
          maxItems: maxPatchReplacements,
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              content: {
                type: "string",
                description: "Replacement text for the range. Use an empty string to delete the range.",
                maxLength: maxWriteCharacters,
              },
              endLine: {
                type: "integer",
                description:
                  "One-based inclusive last line to replace. Use startLine - 1 for an insertion.",
                minimum: 0,
              },
              startLine: {
                type: "integer",
                description: "One-based first line to replace or insertion point.",
                minimum: 1,
              },
            },
            required: ["startLine", "endLine", "content"],
          },
        },
      },
      required: ["path", "replacements"],
    },
  },
  move_file: {
    name: "move_file",
    description:
      "Move or rename a file inside writable Truss file-access boundaries. The destination parent directory must already exist. Fails when either the source or destination root is read-only.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        destinationPath: {
          type: "string",
          description: "Destination file path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        overwrite: {
          type: "boolean",
          description: "Replace an existing destination file. Defaults to false.",
        },
        sourcePath: {
          type: "string",
          description: "Source file path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
      },
      required: ["sourcePath", "destinationPath"],
    },
  },
  copy_file: {
    name: "copy_file",
    description:
      "Copy a file inside the active Truss file-access boundary to a writable destination root. The destination parent directory must already exist. Fails when the destination root is read-only.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        destinationPath: {
          type: "string",
          description: "Destination file path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        overwrite: {
          type: "boolean",
          description: "Replace an existing destination file. Defaults to false.",
        },
        sourcePath: {
          type: "string",
          description: "Source file path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
      },
      required: ["sourcePath", "destinationPath"],
    },
  },
  delete_file: {
    name: "delete_file",
    description:
      "Delete a file inside a writable Truss file-access boundary. Directories are rejected and confirmDeletion must be true. Use this only when the user explicitly asks to remove a file. Fails for read-only roots.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        confirmDeletion: {
          type: "boolean",
          description: "Must be true to delete the file. The tool fails without this explicit confirmation.",
        },
        path: {
          type: "string",
          description: "File path relative to the primary file-access directory, or an absolute path inside any granted directory. Caps at 4000 characters.",
          maxLength: maxPathLength,
        },
      },
      required: ["path", "confirmDeletion"],
    },
  },
  search_filenames: {
    name: "search_filenames",
    description:
      "Recursively search file and directory names inside the active Truss file-access boundary by substring.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        caseSensitive: {
          type: "boolean",
          description: "Use case-sensitive matching. Defaults to false.",
        },
        limit: {
          type: "integer",
          description: "Maximum matches to return. Defaults to 100 and caps at 1000.",
          maximum: 1_000,
          minimum: 1,
        },
        path: {
          type: "string",
          description: "Directory to search from. Defaults to the primary file-access directory and caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        query: {
          type: "string",
          description: "Filename substring to search for. Caps at 500 characters.",
          maxLength: 500,
        },
      },
      required: ["query"],
    },
  },
  regex_search_files: {
    name: "regex_search_files",
    description:
      "Search text file contents inside the active Truss file-access boundary using a JavaScript regular expression. When path is a directory, search recursively. When path is a file, search only that file.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        context_lines: {
          type: "integer",
          description:
            "Number of surrounding lines to include before and after each match. Defaults to 0 and caps at 20.",
          maximum: maxContextLines,
          minimum: 0,
        },
        flags: {
          type: "string",
          description: "Optional regex flags. Supported flags are i, m, s, and u.",
          maxLength: 8,
        },
        limit: {
          type: "integer",
          description: "Maximum matches to return. Defaults to 100 and caps at 1000.",
          maximum: 1_000,
          minimum: 1,
        },
        maxFileSizeBytes: {
          type: "integer",
          description: "Skip larger files. Defaults to 1000000 bytes and caps at 10000000.",
          maximum: 10_000_000,
          minimum: 1,
        },
        path: {
          type: "string",
          description: "Directory to search recursively, or a specific text file to search. Defaults to the primary file-access directory and caps at 4000 characters.",
          maxLength: maxPathLength,
        },
        pattern: {
          type: "string",
          description: "JavaScript regular expression pattern. Caps at 2000 characters.",
          maxLength: maxPatternLength,
        },
      },
      required: ["pattern"],
    },
  },
};

export async function runTrussFilesystemToolsMcpServer(
  options: TrussFilesystemToolsMcpServerOptions = {},
): Promise<void> {
  const runtime = await createTrussFilesystemToolsMcpRuntime(options.workspacePath, {
    allowedDirectories: options.allowedDirectories,
    readOnlyDirectories: options.readOnlyDirectories,
    trussHomeDir: options.trussHomeDir,
  });

  try {
    for await (const line of readStdinLines()) {
      const message = parseJsonRpcLine(line);

      if (!message) {
        continue;
      }

      const response = await handleMessage(message, runtime);

      if (response) {
        writeJsonRpcMessage(response);
      }
    }
  } finally {
    runtime.close();
  }
}

function handleMessage(
  message: JsonRpcMessage,
  runtime: TrussFilesystemToolsRuntime,
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(message)) {
    return Promise.resolve(null);
  }

  return handleRequest(message, runtime).catch((caught) =>
    jsonRpcError(message.id, -32603, caught instanceof Error ? caught.message : String(caught)),
  );
}

async function handleRequest(
  request: JsonRpcRequest,
  runtime: TrussFilesystemToolsRuntime,
): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "initialize":
      return jsonRpcResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "Truss Filesystem Tools",
          version: "0.1.0",
        },
      });
    case "tools/list":
      return jsonRpcResult(request.id, {
        tools: Object.values(trussFilesystemToolDefinitions).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call":
      return handleToolCall(request, runtime);
    case "resources/list":
      return jsonRpcResult(request.id, { resources: [] });
    case "prompts/list":
      return jsonRpcResult(request.id, { prompts: [] });
    default:
      return jsonRpcError(request.id, -32601, `Unknown method: ${request.method}`);
  }
}

async function handleToolCall(
  request: JsonRpcRequest,
  runtime: TrussFilesystemToolsRuntime,
): Promise<JsonRpcResponse> {
  const params = normalizeToolCallParams(request.params);
  const toolName =
    typeof params.name === "string" ? trussFilesystemToolNameForName(params.name) : null;

  if (!toolName) {
    return jsonRpcError(
      request.id,
      -32602,
      `Unknown Truss Filesystem Tools tool: ${String(params.name ?? "")}`,
    );
  }

  const result = await executeTrussFilesystemTool({
    args: normalizeToolArguments(params.arguments),
    runtime: runtimeForToolMeta(runtime, normalizeTrussMeta(params._meta)),
    toolName,
  });

  return jsonRpcResult(request.id, {
    content: [
      {
        type: "text",
        text: result,
      },
    ],
  });
}

export async function executeTrussFilesystemTool({
  args,
  runtime,
  toolName,
}: {
  args: Record<string, unknown>;
  runtime: TrussFilesystemToolsRuntime;
  toolName: TrussFilesystemToolName;
}): Promise<string> {
  const value = await executeTrussFilesystemToolValue({ args, runtime, toolName });

  return toonToolResult(toolName, value);
}

export async function executeTrussFilesystemToolValue({
  args,
  runtime,
  toolName,
}: {
  args: Record<string, unknown>;
  runtime: TrussFilesystemToolsRuntime;
  toolName: TrussFilesystemToolName;
}): Promise<unknown> {
  if (toolName === "get_file_access_grants") {
    return getFileAccessGrants(runtime);
  }

  if (toolName === "get_file_metadata") {
    return getFileMetadata(args, runtime);
  }

  if (toolName === "list_directory") {
    return listDirectory(args, runtime);
  }

  if (toolName === "directory_tree" || toolName === "list_directories") {
    return directoryTree(args, runtime);
  }

  if (toolName === "create_directory") {
    return createDirectory(args, runtime);
  }

  if (toolName === "read_text_file") {
    return readTextFile(args, runtime);
  }

  if (toolName === "read_multiple_files") {
    return readMultipleFiles(args, runtime);
  }

  if (toolName === "read_document") {
    return readDocument(args, runtime);
  }

  if (toolName === "write_text_file") {
    return writeTextFile(args, runtime);
  }

  if (toolName === "patch_text_file") {
    return patchTextFile(args, runtime);
  }

  if (toolName === "move_file") {
    return moveFile(args, runtime);
  }

  if (toolName === "copy_file") {
    return copyFileTool(args, runtime);
  }

  if (toolName === "delete_file") {
    return deleteFile(args, runtime);
  }

  if (toolName === "search_filenames") {
    return searchFilenames(args, runtime);
  }

  return regexSearchFiles(args, runtime);
}

function getFileAccessGrants(runtime: TrussFilesystemToolsRuntime): unknown {
  return {
    grants: runtime.accessRoots.map((root, index) => ({
      access: root.access,
      isPrimary: index === 0,
      path: root.path,
      readOnly: root.access === "read-only",
      scope: root.scope,
      source: root.source,
    })),
  };
}

async function getFileMetadata(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const target = await resolveExistingWorkspacePath(
    runtime,
    requiredStringArg(args, "path", maxPathLength),
    "any",
  );
  const targetStat = await revalidateResolvedWorkspacePath(runtime, target, "any");

  return metadataSummary(runtime, target.absolutePath, targetStat);
}

async function listDirectory(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const directory = await resolveExistingWorkspacePath(
    runtime,
    optionalStringArg(args, "path", maxPathLength) ?? ".",
    "directory",
  );
  const limit = numberArg(args, "limit", defaultListLimit, 1, 1_000);
  await revalidateResolvedWorkspacePath(runtime, directory, "directory");
  const dirEntries = await readdir(directory.absolutePath, { withFileTypes: true });
  const visibleEntries = dirEntries.filter((entry) =>
    !isIgnoredPath(runtime, join(directory.absolutePath, entry.name), entry.isDirectory())
  );
  const entries = await Promise.all(
    visibleEntries
      .sort((left, right) => compareDirents(left, right))
      .slice(0, limit)
      .map(async (entry) => entrySummary(runtime, directory.absolutePath, entry)),
  );

  return {
    entries,
    count: entries.length,
    path: directory.relativePath,
    truncated: visibleEntries.length > limit,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function directoryTree(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const directory = await resolveExistingWorkspacePath(
    runtime,
    optionalStringArg(args, "path", maxPathLength) ?? ".",
    "directory",
  );
  const limit = numberArg(args, "limit", defaultTreeLimit, 1, 1_000);
  const extensions = extensionsArg(args, "extensions");
  const skipLargeDirectories =
    booleanArg(args, "skipLargeDirectories", true) &&
    booleanArg(args, "skip_large_directories", true);
  const state = { count: 0, limit, skippedDirectories: 0, truncated: false };
  const entries = await treeEntries(
    runtime,
    directory.absolutePath,
    state,
    extensions,
    skipLargeDirectories,
  );

  return {
    entries,
    count: state.count,
    extensions: extensions ? [...extensions].sort() : undefined,
    limit,
    path: directory.relativePath,
    skippedDirectories: state.skippedDirectories,
    truncated: state.truncated,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function createDirectory(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const inputPath = requiredStringArg(args, "path", maxPathLength);
  const recursive = booleanArg(args, "recursive", true);
  const candidate = resolveWorkspaceCandidate(runtime, inputPath);
  assertWritableRoot(runtime, candidate.rootPath);
  const existingPath = await realpathOrNull(candidate.absolutePath);

  if (existingPath) {
    assertWithinRoot(candidate.rootPath, existingPath, inputPath);
    const existing = await stat(existingPath);
    assertNotIgnored(runtime, existingPath, existing.isDirectory(), inputPath);

    if (!existing.isDirectory()) {
      throw new Error(`Path already exists and is not a directory: ${inputPath}`);
    }

    return {
      created: false,
      existed: true,
      path: workspaceRelativePath(runtime, existingPath),
      recursive,
      workspaceRoot: runtime.workspaceRoot,
    };
  }

  await assertNearestExistingAncestorWithinWorkspace(runtime, candidate, inputPath);
  await mkdir(candidate.absolutePath, { recursive });
  const absolutePath = await realpath(candidate.absolutePath);

  assertWithinRoot(candidate.rootPath, absolutePath, inputPath);
  assertNotIgnored(runtime, absolutePath, true, inputPath);

  return {
    created: true,
    existed: false,
    path: workspaceRelativePath(runtime, absolutePath),
    recursive,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function readTextFile(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const file = await resolveExistingWorkspacePath(
    runtime,
    requiredStringArg(args, "path", maxPathLength),
    "file",
  );
  const startLine = numberArg(args, "startLine", 1, 1, 1_000_000);
  const lineCount = numberArg(args, "lineCount", defaultReadLineCount, 1, 10_000);
  const maxCharacters = numberArg(args, "maxCharacters", defaultReadMaxCharacters, 1, 500_000);
  const text = await readWorkspaceTextFile(runtime, file);
  const lines = text.split(/\r\n|\n|\r/);
  const selectedLines = lines.slice(startLine - 1, startLine - 1 + lineCount);
  const clipped = clipText(selectedLines.join("\n"), maxCharacters);

  return {
    charactersReturned: clipped.text.length,
    content: clipped.text,
    lineCount: selectedLines.length,
    maxCharacters,
    path: file.relativePath,
    startLine,
    totalLines: lines.length,
    truncated: clipped.truncated,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function readMultipleFiles(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const paths = stringArrayArg(args, "paths", maxMultipleReadFiles, maxPathLength);
  const startLine = numberArg(args, "startLine", 1, 1, 1_000_000);
  const lineCount = numberArg(args, "lineCount", defaultReadLineCount, 1, 10_000);
  const maxCharacters = numberArg(args, "maxCharacters", defaultReadMaxCharacters, 1, 500_000);
  const files: Array<Record<string, unknown>> = [];

  for (const inputPath of paths) {
    try {
      files.push({
        ok: true,
        ...((await readTextFile(
          {
            lineCount,
            maxCharacters,
            path: inputPath,
            startLine,
          },
          runtime,
        )) as Record<string, unknown>),
      });
    } catch (caught) {
      files.push({
        error: caught instanceof Error ? caught.message : String(caught),
        ok: false,
        path: inputPath,
      });
    }
  }

  return {
    count: files.length,
    failedCount: files.filter((file) => file.ok === false).length,
    files,
    lineCount,
    maxCharacters,
    startLine,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function readDocument(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const file = await resolveExistingWorkspacePath(
    runtime,
    requiredStringArg(args, "path", maxPathLength),
    "file",
  );
  const maxCharacters = numberArg(
    args,
    "maxCharacters",
    defaultDocumentMaxCharacters,
    1,
    500_000,
  );
  const extension = fileExtension(file.absolutePath);
  const pandocFormat = pandocInputFormatByExtension[extension];
  const data = await readWorkspaceBinaryFile(runtime, file);
  const markdown = pandocFormat
    ? await convertDocumentWithPandoc(data, file.relativePath, pandocFormat)
    : spreadsheetFallbackExtensions.has(extension)
      ? convertSpreadsheetToMarkdown(data)
      : null;

  if (markdown === null) {
    throw new Error(
      `${file.relativePath} is not a supported document type. Supported extensions: ${[
        ...Object.keys(pandocInputFormatByExtension),
        ...spreadsheetFallbackExtensions,
      ]
        .sort()
        .join(", ")}.`,
    );
  }

  const normalized = normalizeMarkdown(markdown);

  if (!normalized.trim()) {
    throw new Error(`${file.relativePath} did not contain extractable text.`);
  }

  const clipped = clipText(normalized, maxCharacters);

  return {
    charactersReturned: clipped.text.length,
    content: clipped.text,
    converter: pandocFormat ? "pandoc" : "spreadsheet",
    format: pandocFormat ?? "spreadsheet",
    fullCharacters: normalized.length,
    maxCharacters,
    path: file.relativePath,
    truncated: clipped.truncated,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function writeTextFile(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const path = requiredStringArg(args, "path", maxPathLength);
  const content = requiredStringArg(args, "content", maxWriteCharacters, {
    allowEmpty: true,
    trim: false,
  });
  const overwrite = booleanArg(args, "overwrite", true);
  const file = await resolveWritableWorkspacePath(runtime, path);

  if (file.exists && !overwrite) {
    throw new Error(`${file.relativePath} already exists. Pass overwrite: true to replace it.`);
  }

  await revalidateWritableWorkspacePath(runtime, file, path);
  await Bun.write(file.absolutePath, content);

  return {
    bytesWritten: new TextEncoder().encode(content).byteLength,
    existed: file.exists,
    overwritten: file.exists,
    path: workspaceRelativePath(runtime, file.absolutePath),
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function patchTextFile(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const file = await resolveExistingWorkspacePath(
    runtime,
    requiredStringArg(args, "path", maxPathLength),
    "file",
  );
  assertWritableRoot(runtime, file.rootPath);
  const text = await readWorkspaceTextFile(runtime, file);
  const { eol, hasTrailingNewline, lines } = splitEditableText(text);
  const replacements = lineReplacementsArg(args, "replacements", lines.length);
  let nextLines = [...lines];

  for (const replacement of [...replacements].sort((left, right) => right.startLine - left.startLine)) {
    nextLines.splice(
      replacement.startLine - 1,
      replacement.endLine - replacement.startLine + 1,
      ...splitReplacementContent(replacement.content),
    );
  }

  const nextContent =
    nextLines.length === 0 ? "" : `${nextLines.join(eol)}${hasTrailingNewline ? eol : ""}`;

  if (nextContent.length > maxWriteCharacters) {
    throw new Error(`Patched content is too long. Maximum is ${maxWriteCharacters} characters.`);
  }

  await revalidateResolvedWorkspacePath(runtime, file, "file");
  await Bun.write(file.absolutePath, nextContent);

  return {
    bytesWritten: new TextEncoder().encode(nextContent).byteLength,
    linesAfter: nextLines.length,
    linesBefore: lines.length,
    path: file.relativePath,
    replacements: replacements.length,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function moveFile(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const source = await resolveExistingWorkspacePath(
    runtime,
    requiredStringArg(args, "sourcePath", maxPathLength),
    "file",
  );
  assertWritableRoot(runtime, source.rootPath);
  const destination = await resolveWritableWorkspacePath(
    runtime,
    requiredStringArg(args, "destinationPath", maxPathLength),
  );
  const overwrite = booleanArg(args, "overwrite", false);

  assertDifferentPaths(source.absolutePath, destination.absolutePath);

  if (destination.exists && !overwrite) {
    throw new Error(`${destination.relativePath} already exists. Pass overwrite: true to replace it.`);
  }

  if (destination.exists) {
    await revalidateWritableWorkspacePath(runtime, destination, destination.relativePath);
    await unlink(destination.absolutePath);
  }

  await revalidateResolvedWorkspacePath(runtime, source, "file");
  await revalidateWritableWorkspacePath(runtime, destination, destination.relativePath);
  await rename(source.absolutePath, destination.absolutePath);

  return {
    destinationPath: workspaceRelativePath(runtime, destination.absolutePath),
    overwritten: destination.exists,
    sourcePath: source.relativePath,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function copyFileTool(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const source = await resolveExistingWorkspacePath(
    runtime,
    requiredStringArg(args, "sourcePath", maxPathLength),
    "file",
  );
  const destination = await resolveWritableWorkspacePath(
    runtime,
    requiredStringArg(args, "destinationPath", maxPathLength),
  );
  const overwrite = booleanArg(args, "overwrite", false);

  assertDifferentPaths(source.absolutePath, destination.absolutePath);

  if (destination.exists && !overwrite) {
    throw new Error(`${destination.relativePath} already exists. Pass overwrite: true to replace it.`);
  }

  await revalidateResolvedWorkspacePath(runtime, source, "file");
  await revalidateWritableWorkspacePath(runtime, destination, destination.relativePath);
  await copyFile(source.absolutePath, destination.absolutePath);

  return {
    bytesCopied: (await stat(destination.absolutePath)).size,
    destinationPath: workspaceRelativePath(runtime, destination.absolutePath),
    overwritten: destination.exists,
    sourcePath: source.relativePath,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function deleteFile(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  if (booleanArg(args, "confirmDeletion", false) !== true) {
    throw new Error("delete_file requires confirmDeletion: true.");
  }

  const file = await resolveExistingWorkspacePath(
    runtime,
    requiredStringArg(args, "path", maxPathLength),
    "file",
  );
  assertWritableRoot(runtime, file.rootPath);

  await revalidateResolvedWorkspacePath(runtime, file, "file");
  await unlink(file.absolutePath);

  return {
    deleted: true,
    path: file.relativePath,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function searchFilenames(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const query = requiredStringArg(args, "query", 500);
  const caseSensitive = booleanArg(args, "caseSensitive", false);
  const limit = numberArg(args, "limit", defaultSearchLimit, 1, 1_000);
  const directory = await resolveExistingWorkspacePath(
    runtime,
    optionalStringArg(args, "path", maxPathLength) ?? ".",
    "directory",
  );
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<Record<string, unknown>> = [];
  const state: WalkState = { skippedDirectories: 0 };

  for await (const entry of walkEntries(runtime, directory.absolutePath, state)) {
    const haystack = caseSensitive ? entry.name : entry.name.toLowerCase();

    if (!haystack.includes(needle)) {
      continue;
    }

    matches.push({
      name: entry.name,
      path: workspaceRelativePath(runtime, entry.absolutePath),
      type: entry.type,
    });

    if (matches.length >= limit) {
      break;
    }
  }

  return {
    count: matches.length,
    matches,
    path: directory.relativePath,
    query,
    skippedDirectories: state.skippedDirectories,
    truncated: matches.length >= limit,
    workspaceRoot: runtime.workspaceRoot,
  };
}

async function regexSearchFiles(
  args: Record<string, unknown>,
  runtime: TrussFilesystemToolsRuntime,
): Promise<unknown> {
  const pattern = requiredStringArg(args, "pattern", maxPatternLength, { trim: false });
  const flags = regexFlagsArg(args, "flags");
  const regex = new RegExp(pattern, flags);
  const limit = numberArg(args, "limit", defaultSearchLimit, 1, 1_000);
  const contextLines = numberArg(args, "context_lines", 0, 0, maxContextLines);
  const maxFileSizeBytes = numberArg(
    args,
    "maxFileSizeBytes",
    defaultMaxSearchFileSizeBytes,
    1,
    10_000_000,
  );
  const target = await resolveExistingWorkspacePath(
    runtime,
    optionalStringArg(args, "path", maxPathLength) ?? ".",
    "any",
  );
  const targetStat = await revalidateResolvedWorkspacePath(runtime, target, "any");
  const matches: Array<Record<string, unknown>> = [];
  const state: WalkState = { skippedDirectories: 0 };
  let searchedFiles = 0;
  let skippedBinaryFiles = 0;
  let skippedFiles = 0;
  const result = (truncated: boolean) => ({
    count: matches.length,
    flags,
    matches,
    maxFileSizeBytes,
    path: target.relativePath,
    pattern,
    context_lines: contextLines,
    searchedFiles,
    skippedBinaryFiles,
    skippedDirectories: state.skippedDirectories,
    skippedFiles,
    truncated,
    workspaceRoot: runtime.workspaceRoot,
  });

  if (targetStat.isFile()) {
    const search = await searchRegexInResolvedFile({
      contextLines,
      file: target,
      limit,
      matches,
      maxFileSizeBytes,
      regex,
      runtime,
    });
    searchedFiles += search.searchedFiles;
    skippedBinaryFiles += search.skippedBinaryFiles;
    skippedFiles += search.skippedFiles;

    return result(search.truncated);
  }

  if (!targetStat.isDirectory()) {
    throw new Error(`Path is not a file or directory: ${target.relativePath}`);
  }

  for await (const entry of walkEntries(runtime, target.absolutePath, state)) {
    if (entry.type !== "file") {
      continue;
    }

    const search = await searchRegexInResolvedFile({
      contextLines,
      file: resolvedPathFromAbsolute(runtime, entry.absolutePath),
      limit,
      matches,
      maxFileSizeBytes,
      regex,
      runtime,
    });
    searchedFiles += search.searchedFiles;
    skippedBinaryFiles += search.skippedBinaryFiles;
    skippedFiles += search.skippedFiles;

    if (search.truncated) {
      return result(true);
    }
  }

  return result(false);
}

async function searchRegexInResolvedFile({
  contextLines,
  file,
  limit,
  matches,
  maxFileSizeBytes,
  regex,
  runtime,
}: {
  contextLines: number;
  file: ResolvedWorkspacePath;
  limit: number;
  matches: Array<Record<string, unknown>>;
  maxFileSizeBytes: number;
  regex: RegExp;
  runtime: TrussFilesystemToolsRuntime;
}): Promise<{
  searchedFiles: number;
  skippedBinaryFiles: number;
  skippedFiles: number;
  truncated: boolean;
}> {
  const fileStat = await revalidateResolvedWorkspacePath(runtime, file, "file");

  if (fileStat.size > maxFileSizeBytes) {
    return {
      searchedFiles: 0,
      skippedBinaryFiles: 0,
      skippedFiles: 1,
      truncated: false,
    };
  }

  let text: string;

  try {
    text = await readWorkspaceTextFile(runtime, file);
  } catch (caught) {
    if (isBinaryFileError(caught)) {
      return {
        searchedFiles: 0,
        skippedBinaryFiles: 1,
        skippedFiles: 0,
        truncated: false,
      };
    }

    throw caught;
  }

  const lines = text.split(/\r\n|\n|\r/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = regex.exec(line);

    regex.lastIndex = 0;

    if (!match) {
      continue;
    }

    matches.push({
      after: contextEntries(lines, index + 1, index + 1 + contextLines),
      before: contextEntries(lines, index - contextLines, index),
      column: match.index + 1,
      line: index + 1,
      path: file.relativePath,
      preview: clipSearchPreview(line),
    });

    if (matches.length >= limit) {
      return {
        searchedFiles: 1,
        skippedBinaryFiles: 0,
        skippedFiles: 0,
        truncated: true,
      };
    }
  }

  return {
    searchedFiles: 1,
    skippedBinaryFiles: 0,
    skippedFiles: 0,
    truncated: false,
  };
}

async function convertDocumentWithPandoc(
  data: ArrayBuffer,
  relativePath: string,
  from: string,
): Promise<string> {
  const inputName = virtualPandocFileName(relativePath);
  const result = await convertWithPandocWasm(
    {
      from,
      "input-files": [inputName],
      "markdown-headings": "atx",
      to: "gfm",
      wrap: "none",
    },
    null,
    {
      [inputName]: new Blob([data], {
        type: mimeTypeForPandocFormat(from),
      }),
    },
  );

  if (result.stderr.trim()) {
    throw new Error(`Pandoc could not convert ${relativePath}: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

function convertSpreadsheetToMarkdown(data: ArrayBuffer): string {
  const workbook = XLSX.read(data, {
    cellDates: true,
    raw: false,
    type: "array",
  });

  return workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      return "";
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: false,
    });
    const table = rowsToMarkdownTable(rows);

    return table ? `## ${escapeMarkdownText(sheetName)}\n\n${table}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

function rowsToMarkdownTable(rows: unknown[][]): string {
  const normalizedRows = rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (normalizedRows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...normalizedRows.map((row) => row.length), 1);
  const [firstRow, ...bodyRows] = normalizedRows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => escapeTableCell(row[index] ?? "")),
  );
  const header =
    firstRow ?? Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
  const separator = Array.from({ length: columnCount }, () => "---");
  const rowsToRender =
    bodyRows.length > 0 ? bodyRows : [Array.from({ length: columnCount }, () => "")];

  return [header, separator, ...rowsToRender]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

async function resolveExistingWorkspacePath(
  runtime: TrussFilesystemToolsRuntime,
  inputPath: string,
  expectedType: "any" | "directory" | "file",
): Promise<ResolvedWorkspacePath> {
  const candidate = resolveWorkspaceCandidate(runtime, inputPath);
  let absolutePath: string;

  try {
    absolutePath = await realpath(candidate.absolutePath);
  } catch (caught) {
    if (isNotFoundError(caught)) {
      await assertNearestExistingAncestorWithinWorkspace(runtime, candidate, inputPath);
      throw new Error(`Path does not exist: ${inputPath}`);
    }

    throw caught;
  }

  assertWithinRoot(candidate.rootPath, absolutePath, inputPath);
  const pathStat = await stat(absolutePath);
  assertNotIgnored(runtime, absolutePath, pathStat.isDirectory(), inputPath);

  if (expectedType === "directory" && !pathStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${workspaceRelativePath(runtime, absolutePath)}`);
  }

  if (expectedType === "file" && !pathStat.isFile()) {
    throw new Error(`Path is not a file: ${workspaceRelativePath(runtime, absolutePath)}`);
  }

  return {
    absolutePath,
    relativePath: workspaceRelativePath(runtime, absolutePath),
    rootPath: candidate.rootPath,
  };
}

async function resolveWritableWorkspacePath(
  runtime: TrussFilesystemToolsRuntime,
  inputPath: string,
): Promise<ResolvedWorkspacePath & { exists: boolean }> {
  const candidate = resolveWorkspaceCandidate(runtime, inputPath);
  assertWritableRoot(runtime, candidate.rootPath);

  try {
    const absolutePath = await realpath(candidate.absolutePath);

    assertWithinRoot(candidate.rootPath, absolutePath, inputPath);

    const pathStat = await stat(absolutePath);
    assertNotIgnored(runtime, absolutePath, pathStat.isDirectory(), inputPath);

    if (!pathStat.isFile()) {
      throw new Error(`Path is not a file: ${workspaceRelativePath(runtime, absolutePath)}`);
    }

    return {
      absolutePath,
      exists: true,
      relativePath: workspaceRelativePath(runtime, absolutePath),
      rootPath: candidate.rootPath,
    };
  } catch (caught) {
    if (!isNotFoundError(caught)) {
      throw caught;
    }
  }

  const parentCandidate = dirname(candidate.absolutePath);

  let parentPath: string;

  try {
    parentPath = await realpath(parentCandidate);
  } catch (caught) {
    if (isNotFoundError(caught)) {
      await assertNearestExistingAncestorWithinWorkspace(runtime, candidate, inputPath);
      throw new Error(`Parent directory does not exist: ${dirname(inputPath)}`);
    }

    throw caught;
  }

  assertWithinRoot(candidate.rootPath, parentPath, inputPath);
  const parentStat = await stat(parentPath);
  assertNotIgnored(runtime, parentPath, true, inputPath);

  if (!parentStat.isDirectory()) {
    throw new Error(`Parent path is not a directory: ${workspaceRelativePath(runtime, parentPath)}`);
  }

  const absolutePath = resolve(parentPath, basename(candidate.absolutePath));

  assertWithinRoot(candidate.rootPath, absolutePath, inputPath);
  assertNotIgnored(runtime, absolutePath, false, inputPath);

  return {
    absolutePath,
    exists: false,
    relativePath: workspaceRelativePath(runtime, absolutePath),
    rootPath: candidate.rootPath,
  };
}

async function revalidateResolvedWorkspacePath(
  runtime: TrussFilesystemToolsRuntime,
  path: ResolvedWorkspacePath,
  expectedType: "any" | "directory" | "file",
): Promise<Stats> {
  const currentPath = await realpath(path.absolutePath);

  assertWithinRoot(path.rootPath, currentPath, path.relativePath);

  if (comparablePath(currentPath) !== comparablePath(path.absolutePath)) {
    throw new Error(`Path changed after validation: ${path.relativePath}`);
  }

  const pathStat = await stat(currentPath);
  assertNotIgnored(runtime, currentPath, pathStat.isDirectory(), path.relativePath);

  if (expectedType === "directory" && !pathStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${path.relativePath}`);
  }

  if (expectedType === "file" && !pathStat.isFile()) {
    throw new Error(`Path is not a file: ${path.relativePath}`);
  }

  return pathStat;
}

async function revalidateWritableWorkspacePath(
  runtime: TrussFilesystemToolsRuntime,
  path: ResolvedWorkspacePath & { exists: boolean },
  inputPath: string,
): Promise<void> {
  assertWritableRoot(runtime, path.rootPath);

  if (path.exists) {
    await revalidateResolvedWorkspacePath(runtime, path, "file");
    return;
  }

  const parentPath = await realpath(dirname(path.absolutePath));

  assertWithinRoot(path.rootPath, parentPath, inputPath);

  const parentStat = await stat(parentPath);

  if (!parentStat.isDirectory()) {
    throw new Error(`Parent path is not a directory: ${workspaceRelativePath(runtime, parentPath)}`);
  }

  const absolutePath = resolve(parentPath, basename(path.absolutePath));

  assertWithinRoot(path.rootPath, absolutePath, inputPath);

  if (comparablePath(absolutePath) !== comparablePath(path.absolutePath)) {
    throw new Error(`Path changed after validation: ${inputPath}`);
  }

  assertNotIgnored(runtime, absolutePath, false, inputPath);
}

function resolvedPathFromAbsolute(
  runtime: TrussFilesystemToolsRuntime,
  absolutePath: string,
): ResolvedWorkspacePath {
  const rootPath = rootPathForCandidate(runtime, absolutePath);

  if (!rootPath) {
    throwPathBoundaryDenied();
  }

  return {
    absolutePath,
    relativePath: workspaceRelativePath(runtime, absolutePath),
    rootPath,
  };
}

async function assertNearestExistingAncestorWithinWorkspace(
  runtime: TrussFilesystemToolsRuntime,
  candidate: WorkspaceCandidate,
  inputPath: string,
): Promise<void> {
  let current = dirname(candidate.absolutePath);

  while (true) {
    try {
      const ancestor = await realpath(current);

      assertWithinRoot(candidate.rootPath, ancestor, inputPath);

      const ancestorStat = await stat(ancestor);
      assertNotIgnored(runtime, ancestor, true, inputPath);

      if (!ancestorStat.isDirectory()) {
        throw new Error(`Parent path is not a directory: ${workspaceRelativePath(runtime, ancestor)}`);
      }

      return;
    } catch (caught) {
      if (!isNotFoundError(caught)) {
        throw caught;
      }
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error(`Parent directory does not exist: ${dirname(inputPath)}`);
    }

    current = parent;
  }
}

function resolveWorkspaceCandidate(
  runtime: TrussFilesystemToolsRuntime,
  inputPath: string,
): WorkspaceCandidate {
  const trimmed = inputPath.trim();
  assertDecodedPathStaysWithinBoundary(runtime, trimmed);
  const { absolutePath: candidate, rootPath } = workspaceCandidateForInput(runtime, trimmed);

  if (!rootPath) {
    throwPathBoundaryDenied();
  }

  assertWithinRoot(rootPath, candidate, inputPath);
  return {
    absolutePath: candidate,
    rootPath,
  };
}

function workspaceCandidateForInput(
  runtime: TrussFilesystemToolsRuntime,
  inputPath: string,
): { absolutePath: string; rootPath: string | null } {
  const candidate = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(runtime.workspaceRoot, inputPath || ".");
  const rootPath = isAbsolute(inputPath)
    ? rootPathForCandidate(runtime, candidate)
    : isPathWithin(runtime.workspaceRoot, candidate)
      ? rootPathForCandidate(runtime, candidate)
      : null;

  return {
    absolutePath: candidate,
    rootPath,
  };
}

function assertDecodedPathStaysWithinBoundary(
  runtime: TrussFilesystemToolsRuntime,
  inputPath: string,
): void {
  const decoded = decodePathOnce(inputPath);

  if (decoded === null || decoded === inputPath) {
    return;
  }

  const decodedCandidate = workspaceCandidateForInput(runtime, decoded.trim());

  if (
    !decodedCandidate.rootPath ||
    !isPathWithin(decodedCandidate.rootPath, decodedCandidate.absolutePath)
  ) {
    throwPathBoundaryDenied();
  }
}

function decodePathOnce(inputPath: string): string | null {
  if (!/%[0-9a-fA-F]{2}/.test(inputPath)) {
    return null;
  }

  try {
    return decodeURIComponent(inputPath);
  } catch {
    return null;
  }
}

function rootPathForCandidate(
  runtime: TrussFilesystemToolsRuntime,
  targetPath: string,
): string | null {
  return accessRootForCandidate(runtime, targetPath)?.path ?? null;
}

function accessRootForCandidate(
  runtime: TrussFilesystemToolsRuntime,
  targetPath: string,
): FileAccessRoot | null {
  return fileAccessRootForPath(runtime.accessRoots, targetPath);
}

function assertWithinRoot(rootPath: string, targetPath: string, inputPath: string): void {
  if (!isPathWithin(rootPath, targetPath)) {
    throwPathBoundaryDenied();
  }
}

function throwPathBoundaryDenied(): never {
  throw new Error(pathBoundaryDeniedMessage);
}

function assertWritableRoot(runtime: TrussFilesystemToolsRuntime, rootPath: string): void {
  const root = runtime.accessRoots.find((item) => comparablePath(item.path) === comparablePath(rootPath));

  if (root?.access === "read-only") {
    throw new Error(readOnlyAccessDeniedMessage(root.path));
  }
}

function assertNotIgnored(
  runtime: TrussFilesystemToolsRuntime,
  absolutePath: string,
  isDirectoryPath: boolean,
  inputPath: string,
): void {
  if (isIgnoredPath(runtime, absolutePath, isDirectoryPath)) {
    throw new Error(`Path is ignored by Truss file-access patterns: ${inputPath}`);
  }
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  return isFileAccessPathWithin(rootPath, targetPath);
}

function comparablePath(path: string): string {
  return comparableFileAccessPath(path);
}

function isIgnoredPath(
  runtime: TrussFilesystemToolsRuntime,
  absolutePath: string,
  isDirectoryPath: boolean,
): boolean {
  return isFileAccessPathIgnored({
    absolutePath,
    accessRoots: runtime.accessRoots,
    ignorePatterns: runtime.ignorePatterns,
    isDirectoryPath,
  });
}

function metadataSummary(
  runtime: TrussFilesystemToolsRuntime,
  absolutePath: string,
  entryStat: Stats,
): Record<string, unknown> {
  return {
    accessedAt: entryStat.atime.toISOString(),
    createdAt: entryStat.birthtime.toISOString(),
    extension: entryStat.isFile() ? extname(absolutePath) : "",
    modifiedAt: entryStat.mtime.toISOString(),
    name: basename(absolutePath),
    path: workspaceRelativePath(runtime, absolutePath),
    size: entryStat.size,
    type: statsType(entryStat),
    workspaceRoot: runtime.workspaceRoot,
  };
}

function statsType(entryStat: Stats): string {
  if (entryStat.isDirectory()) {
    return "directory";
  }

  if (entryStat.isFile()) {
    return "file";
  }

  if (entryStat.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

async function entrySummary(
  runtime: TrussFilesystemToolsRuntime,
  parentPath: string,
  entry: Dirent,
): Promise<Record<string, unknown>> {
  const absolutePath = join(parentPath, entry.name);
  const entryStat = await lstat(absolutePath);
  const symlinkTarget = entry.isSymbolicLink() ? await safeSymlinkTarget(absolutePath, runtime) : null;

  return {
    modifiedAt: entryStat.mtime.toISOString(),
    name: entry.name,
    path: workspaceRelativePath(runtime, absolutePath),
    size: entryStat.size,
    type: direntType(entry),
    ...(symlinkTarget
      ? {
          targetPath: symlinkTarget.path,
          targetWithinWorkspace: symlinkTarget.withinWorkspace,
        }
      : {}),
  };
}

async function safeSymlinkTarget(
  absolutePath: string,
  runtime: TrussFilesystemToolsRuntime,
): Promise<{ path: string | null; withinWorkspace: boolean } | null> {
  try {
    const target = await realpath(absolutePath);
    const rootPath = rootPathForCandidate(runtime, absolutePath);
    const withinWorkspace = rootPath ? isPathWithin(rootPath, target) : false;

    return {
      path: withinWorkspace ? workspaceRelativePath(runtime, target) : null,
      withinWorkspace,
    };
  } catch {
    return null;
  }
}

async function treeEntries(
  runtime: TrussFilesystemToolsRuntime,
  directoryPath: string,
  state: {
    count: number;
    limit: number;
    skippedDirectories: number;
    truncated: boolean;
  },
  extensions: Set<string> | null,
  skipLargeDirectories?: boolean,
): Promise<Array<Record<string, unknown>>> {
  if (state.count >= state.limit) {
    state.truncated = true;
    return [];
  }

  let dirEntries;

  try {
    await revalidateDirectoryAbsolutePath(runtime, directoryPath);
    dirEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    state.skippedDirectories += 1;
    return [];
  }

  if (skipLargeDirectories) {
    const fileCount = dirEntries.filter((entry) => !entry.isDirectory()).length;
    if (fileCount > 200) {
      state.skippedDirectories += 1;
      return [];
    }
  }

  const result: Array<Record<string, unknown>> = [];

  for (const entry of dirEntries.sort((left, right) => compareDirents(left, right))) {
    if (state.count >= state.limit) {
      state.truncated = true;
      break;
    }

    const absolutePath = join(directoryPath, entry.name);

    if (isIgnoredPath(runtime, absolutePath, entry.isDirectory())) {
      continue;
    }

    const summary = await entrySummary(runtime, directoryPath, entry);

    if (entry.isDirectory()) {
      state.count += 1;
      const children = await treeEntries(
        runtime,
        absolutePath,
        state,
        extensions,
        skipLargeDirectories,
      );

      if (extensions && children.length === 0) {
        state.count -= 1;
        continue;
      }

      result.push({
        ...summary,
        children,
      });
      continue;
    }

    if (extensions && !extensions.has(extname(entry.name).toLowerCase())) {
      continue;
    }

    state.count += 1;
    result.push(summary);
  }

  return result;
}

async function* walkEntries(
  runtime: TrussFilesystemToolsRuntime,
  directoryPath: string,
  state: WalkState,
): AsyncIterable<{ absolutePath: string; name: string; type: string }> {
  let dirEntries;

  try {
    await revalidateDirectoryAbsolutePath(runtime, directoryPath);
    dirEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    state.skippedDirectories += 1;
    return;
  }

  for (const entry of dirEntries.sort((left, right) => compareDirents(left, right))) {
    const absolutePath = join(directoryPath, entry.name);
    const type = direntType(entry);

    if (isIgnoredPath(runtime, absolutePath, entry.isDirectory())) {
      continue;
    }

    yield {
      absolutePath,
      name: entry.name,
      type,
    };

    if (entry.isDirectory()) {
      yield* walkEntries(runtime, absolutePath, state);
    }
  }
}

async function revalidateDirectoryAbsolutePath(
  runtime: TrussFilesystemToolsRuntime,
  directoryPath: string,
): Promise<void> {
  const rootPath = rootPathForCandidate(runtime, directoryPath);

  if (!rootPath) {
    throwPathBoundaryDenied();
  }

  const currentPath = await realpath(directoryPath);

  assertWithinRoot(rootPath, currentPath, directoryPath);

  if (comparablePath(currentPath) !== comparablePath(directoryPath)) {
    throw new Error(`Directory changed after validation: ${workspaceRelativePath(runtime, directoryPath)}`);
  }

  const pathStat = await stat(currentPath);

  if (!pathStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${workspaceRelativePath(runtime, directoryPath)}`);
  }
}

function compareDirents(
  left: Dirent,
  right: Dirent,
): number {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function direntType(entry: Dirent): string {
  if (entry.isSymbolicLink()) {
    return "symlink";
  }

  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isFile()) {
    return "file";
  }

  return "other";
}

function workspaceRelativePath(
  runtime: TrussFilesystemToolsRuntime,
  absolutePath: string,
): string {
  const rootPath = rootPathForCandidate(runtime, absolutePath);

  if (isPathWithin(runtime.workspaceRoot, absolutePath)) {
    const workspaceValue = relative(runtime.workspaceRoot, absolutePath).replace(/\\/g, "/");

    return workspaceValue || ".";
  }

  if (rootPath && comparablePath(rootPath) !== comparablePath(runtime.workspaceRoot)) {
    return resolve(absolutePath).replace(/\\/g, "/");
  }

  const value = relative(runtime.workspaceRoot, absolutePath).replace(/\\/g, "/");

  return value || ".";
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (caught) {
    if (isNotFoundError(caught)) {
      return null;
    }

    throw caught;
  }
}

function assertDifferentPaths(leftPath: string, rightPath: string): void {
  if (comparablePath(leftPath) === comparablePath(rightPath)) {
    throw new Error("Source and destination paths must be different.");
  }
}

function requiredStringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string {
  const value = optionalStringArg(args, key, maxLength, options);

  if (value === null || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function optionalStringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number,
  options: { trim?: boolean } = {},
): string | null {
  const value = args[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }

  const normalized = options.trim === false ? value : value.trim();

  if (normalized.length > maxLength) {
    throw new Error(`${key} is too long.`);
  }

  return normalized;
}

function booleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }

  return value;
}

function numberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`);
  }

  return Math.min(Math.max(min, Math.floor(value)), max);
}

function regexFlagsArg(args: Record<string, unknown>, key: string): string {
  const value = optionalStringArg(args, key, 8) ?? "";
  const supportedFlags = new Set(["i", "m", "s", "u"]);
  const flags: string[] = [];

  for (const flag of value) {
    if (!supportedFlags.has(flag)) {
      throw new Error(`${key} contains unsupported regex flag: ${flag}`);
    }

    if (!flags.includes(flag)) {
      flags.push(flag);
    }
  }

  return flags.join("");
}

function stringArrayArg(
  args: Record<string, unknown>,
  key: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  const value = args[key];

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }

  if (value.length === 0) {
    throw new Error(`${key} must include at least one path.`);
  }

  if (value.length > maxItems) {
    throw new Error(`${key} includes too many entries. Maximum is ${maxItems}.`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${key}[${index}] must be a string.`);
    }

    const normalized = item.trim();

    if (!normalized) {
      throw new Error(`${key}[${index}] must not be empty.`);
    }

    if (normalized.length > maxItemLength) {
      throw new Error(`${key}[${index}] is too long.`);
    }

    return normalized;
  });
}

function extensionsArg(args: Record<string, unknown>, key: string): Set<string> | null {
  const value = args[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }

  if (value.length > maxDirectoryTreeExtensions) {
    throw new Error(`${key} includes too many entries. Maximum is ${maxDirectoryTreeExtensions}.`);
  }

  const extensions = new Set<string>();

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      throw new Error(`${key}[${index}] must be a string.`);
    }

    const trimmed = item.trim().toLowerCase();

    if (!trimmed) {
      throw new Error(`${key}[${index}] must not be empty.`);
    }

    const extension = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;

    if (!/^\.[a-z0-9][a-z0-9._-]{0,63}$/i.test(extension)) {
      throw new Error(`${key}[${index}] is not a valid file extension.`);
    }

    extensions.add(extension);
  }

  return extensions.size > 0 ? extensions : null;
}

function lineReplacementsArg(
  args: Record<string, unknown>,
  key: string,
  totalLines: number,
): LineReplacement[] {
  const value = args[key];

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array.`);
  }

  if (value.length === 0) {
    throw new Error(`${key} must include at least one replacement.`);
  }

  if (value.length > maxPatchReplacements) {
    throw new Error(`${key} includes too many replacements. Maximum is ${maxPatchReplacements}.`);
  }

  const replacements = value.map((item, index) =>
    lineReplacementArg(item, `${key}[${index}]`, totalLines),
  );
  const sorted = [...replacements].sort((left, right) => left.startLine - right.startLine);
  let previousEndLine = -1;

  for (const replacement of sorted) {
    if (replacement.startLine <= previousEndLine) {
      throw new Error(`${key} ranges must not overlap.`);
    }

    previousEndLine = Math.max(previousEndLine, replacement.endLine);
  }

  return sorted;
}

function lineReplacementArg(value: unknown, key: string, totalLines: number): LineReplacement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object.`);
  }

  const replacement = value as Record<string, unknown>;
  const startLine = integerProperty(replacement, "startLine", key, 1, totalLines + 1);
  const endLine = integerProperty(replacement, "endLine", key, 0, totalLines);
  const content = stringProperty(replacement, "content", key, maxWriteCharacters, {
    allowEmpty: true,
    trim: false,
  });

  if (endLine < startLine - 1) {
    throw new Error(`${key}.endLine must be at least startLine - 1.`);
  }

  if (startLine === totalLines + 1 && endLine !== totalLines) {
    throw new Error(`${key} can append only by setting startLine to totalLines + 1 and endLine to totalLines.`);
  }

  return {
    content,
    endLine,
    startLine,
  };
}

function integerProperty(
  value: Record<string, unknown>,
  property: string,
  key: string,
  min: number,
  max: number,
): number {
  const raw = value[property];

  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`${key}.${property} must be a number.`);
  }

  const normalized = Math.floor(raw);

  if (normalized < min || normalized > max) {
    throw new Error(`${key}.${property} must be between ${min} and ${max}.`);
  }

  return normalized;
}

function stringProperty(
  value: Record<string, unknown>,
  property: string,
  key: string,
  maxLength: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string {
  const raw = value[property];

  if (typeof raw !== "string") {
    throw new Error(`${key}.${property} must be a string.`);
  }

  const normalized = options.trim === false ? raw : raw.trim();

  if (!options.allowEmpty && normalized.length === 0) {
    throw new Error(`${key}.${property} must not be empty.`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${key}.${property} is too long.`);
  }

  return normalized;
}

async function readWorkspaceTextFile(
  runtime: TrussFilesystemToolsRuntime,
  path: ResolvedWorkspacePath,
): Promise<string> {
  const data = new Uint8Array(await readWorkspaceBinaryFile(runtime, path));

  if (isLikelyBinary(data)) {
    throw new BinaryFileError(`${path.relativePath} appears to be a binary file.`);
  }

  return new TextDecoder("utf-8").decode(data);
}

async function readWorkspaceBinaryFile(
  runtime: TrussFilesystemToolsRuntime,
  path: ResolvedWorkspacePath,
): Promise<ArrayBuffer> {
  await revalidateResolvedWorkspacePath(runtime, path, "file");

  return Bun.file(path.absolutePath).arrayBuffer();
}

class BinaryFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinaryFileError";
  }
}

function isBinaryFileError(value: unknown): value is BinaryFileError {
  return value instanceof BinaryFileError;
}

function isLikelyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, binarySampleBytes));

  if (sample.length === 0) {
    return false;
  }

  let suspiciousBytes = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }

    if ((byte < 7 || (byte > 13 && byte < 32) || byte === 127) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / sample.length > 0.3;
}

function splitEditableText(text: string): EditableText {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");

  if (normalized.length === 0) {
    return {
      eol,
      hasTrailingNewline: false,
      lines: [],
    };
  }

  const lines = normalized.split("\n");

  if (hasTrailingNewline) {
    lines.pop();
  }

  return {
    eol,
    hasTrailingNewline,
    lines,
  };
}

function splitReplacementContent(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  if (normalized.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function contextEntries(
  lines: string[],
  startIndex: number,
  endIndex: number,
): Array<{ content: string; line: number }> {
  const start = Math.max(0, startIndex);
  const end = Math.min(lines.length, endIndex);

  return lines.slice(start, end).map((line, index) => ({
    content: clipSearchPreview(line),
    line: start + index + 1,
  }));
}

function clipText(value: string, maxCharacters: number): ClipResult {
  if (value.length <= maxCharacters) {
    return { text: value, truncated: false };
  }

  return {
    text: value.slice(0, maxCharacters),
    truncated: true,
  };
}

function clipSearchPreview(value: string): string {
  const normalized = value.trim();

  return normalized.length <= maxSearchPreviewLength
    ? normalized
    : `${normalized.slice(0, maxSearchPreviewLength).trimEnd()}...`;
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function virtualPandocFileName(name: string): string {
  const safeName = basename(name).replace(/[\\/:\0]/g, "-").trim();
  const extension = extname(safeName);

  return safeName || `document${extension}`;
}

function mimeTypeForPandocFormat(format: string): string {
  switch (format) {
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "epub":
      return "application/epub+zip";
    case "html":
      return "text/html";
    case "odt":
      return "application/vnd.oasis.opendocument.text";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "rtf":
      return "application/rtf";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]<>()#+\-.!|])/g, "\\$1");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function isNotFoundError(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "code" in value &&
    (value as { code?: unknown }).code === "ENOENT"
  );
}

function normalizeToolCallParams(value: unknown): ToolCallParams {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTrussMeta(value: unknown): TrussFilesystemToolMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const filesystemWorkspacePath = (value as Record<string, unknown>).filesystemWorkspacePath;

  return typeof filesystemWorkspacePath === "string" && filesystemWorkspacePath.trim()
    ? { filesystemWorkspacePath: filesystemWorkspacePath.trim() }
    : {};
}

function runtimeForToolMeta(
  runtime: TrussFilesystemToolsRuntime,
  meta: TrussFilesystemToolMeta,
): TrussFilesystemToolsRuntime {
  if (!meta.filesystemWorkspacePath) {
    return runtime;
  }

  const workspaceRoot = resolve(meta.filesystemWorkspacePath);
  const containingRoot = runtime.accessRoots.find((root) => isPathWithin(root.path, workspaceRoot));

  if (!containingRoot) {
    throwPathBoundaryDenied();
  }

  return {
    ...runtime,
    accessRoots: [
      {
        access: containingRoot.access,
        path: workspaceRoot,
        scope: containingRoot.scope,
        source: containingRoot.source,
      },
    ],
    workspaceRoot,
  };
}

function trussFilesystemToolNameForName(name: string): TrussFilesystemToolName | null {
  return Object.hasOwn(trussFilesystemToolDefinitions, name)
    ? (name as TrussFilesystemToolName)
    : null;
}

function toonToolResult(toolName: TrussFilesystemToolName, value: unknown): string {
  const lines = [`${toolName}:`, ...toonObjectLines(value, 2)];

  return `${lines.join("\n")}\n`;
}

function toonObjectLines(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);

  if (!isToonRecord(value)) {
    return [`${prefix}value: ${toonScalar(value)}`];
  }

  const entries = Object.entries(value).filter((entry): entry is [string, unknown] =>
    entry[1] !== undefined
  );

  if (entries.length === 0) {
    return [`${prefix}{}`];
  }

  return entries.flatMap(([key, entryValue]) => toonEntryLines(key, entryValue, indent));
}

function toonEntryLines(key: string, value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);

  if (typeof value === "string" && value.includes("\n")) {
    return [`${prefix}${key}: |-`, indentBlock(value, indent + 2)];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}${key}[0]: []`];
    }

    return [
      `${prefix}${key}[${value.length}]:`,
      ...value.flatMap((item) => toonArrayItemLines(item, indent + 2)),
    ];
  }

  if (isToonRecord(value)) {
    return [`${prefix}${key}:`, ...toonObjectLines(value, indent + 2)];
  }

  return [`${prefix}${key}: ${toonScalar(value)}`];
}

function toonArrayItemLines(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);

  if (!isToonRecord(value)) {
    if (Array.isArray(value)) {
      return [`${prefix}-`, ...toonEntryLines("items", value, indent + 2)];
    }

    return [`${prefix}- ${toonScalar(value)}`];
  }

  const entries = Object.entries(value).filter((entry): entry is [string, unknown] =>
    entry[1] !== undefined
  );

  if (entries.length === 0) {
    return [`${prefix}- {}`];
  }

  const firstEntry = entries[0];

  if (!firstEntry) {
    return [`${prefix}- {}`];
  }

  const remainingEntries = entries.slice(1);
  const firstLines = toonEntryLines(firstEntry[0], firstEntry[1], indent + 2);
  const childPrefix = " ".repeat(indent + 2);
  const lines =
    firstLines.length === 1 && firstLines[0]?.startsWith(childPrefix)
      ? [`${prefix}- ${firstLines[0].slice(childPrefix.length)}`]
      : [`${prefix}-`, ...firstLines];

  for (const [key, entryValue] of remainingEntries) {
    lines.push(...toonEntryLines(key, entryValue, indent + 2));
  }

  return lines;
}

function toonScalar(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return JSON.stringify(value);
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return '""';
  }

  if (/^(true|false|null)$/i.test(normalized) || /^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return JSON.stringify(normalized);
  }

  return normalized;
}

function isToonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function indentBlock(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);

  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function writeJsonRpcMessage(message: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function* readStdinLines(): AsyncIterable<string> {
  const decoder = new TextDecoderStream();
  const lineStream = Bun.stdin.stream().pipeThrough(decoder);
  let buffered = "";

  for await (const chunk of lineStream) {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      yield line;
    }
  }

  if (buffered.trim()) {
    yield buffered;
  }
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}
