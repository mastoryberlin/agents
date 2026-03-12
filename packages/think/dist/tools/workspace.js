import { tool } from "ai";
import { z } from "zod";
//#region src/tools/workspace.ts
function workspaceReadOps(ws) {
  return {
    readFile: (path) => ws.readFile(path),
    stat: (path) => ws.stat(path)
  };
}
function workspaceWriteOps(ws) {
  return {
    writeFile: (path, content) => ws.writeFile(path, content),
    mkdir: (path, opts) => ws.mkdir(path, opts)
  };
}
function workspaceEditOps(ws) {
  return {
    readFile: (path) => ws.readFile(path),
    writeFile: (path, content) => ws.writeFile(path, content)
  };
}
function workspaceListOps(ws) {
  return { readDir: (dir, opts) => ws.readDir(dir, opts) };
}
function workspaceFindOps(ws) {
  return { glob: (pattern) => ws.glob(pattern) };
}
function workspaceDeleteOps(ws) {
  return { rm: (path, opts) => ws.rm(path, opts) };
}
function workspaceGrepOps(ws) {
  return {
    glob: (pattern) => ws.glob(pattern),
    readFile: (path) => ws.readFile(path)
  };
}
/**
 * Create a complete set of AI SDK tools backed by a Workspace instance.
 *
 * ```ts
 * import { Workspace } from "agents/experimental/workspace";
 * import { createWorkspaceTools } from "@cloudflare/think";
 *
 * class MyAgent extends Agent<Env> {
 *   workspace = new Workspace(this);
 *
 *   async onChatMessage() {
 *     const tools = createWorkspaceTools(this.workspace);
 *     const result = streamText({ model, tools, messages });
 *     return result.toUIMessageStreamResponse();
 *   }
 * }
 * ```
 */
function createWorkspaceTools(workspace) {
  return {
    read: createReadTool({ ops: workspaceReadOps(workspace) }),
    write: createWriteTool({ ops: workspaceWriteOps(workspace) }),
    edit: createEditTool({ ops: workspaceEditOps(workspace) }),
    list: createListTool({ ops: workspaceListOps(workspace) }),
    find: createFindTool({ ops: workspaceFindOps(workspace) }),
    grep: createGrepTool({ ops: workspaceGrepOps(workspace) }),
    delete: createDeleteTool({ ops: workspaceDeleteOps(workspace) })
  };
}
const MAX_LINES = 2e3;
const MAX_LINE_LENGTH = 2e3;
function createReadTool(options) {
  const { ops } = options;
  return tool({
    description:
      "Read the contents of a file. Returns the file content with line numbers. Use offset and limit for large files. Returns null if the file does not exist.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path to the file"),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-indexed line number to start reading from"),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Number of lines to read")
    }),
    execute: async ({ path, offset, limit }) => {
      const stat = await ops.stat(path);
      if (!stat) return { error: `File not found: ${path}` };
      if (stat.type === "directory")
        return { error: `${path} is a directory, not a file` };
      const content = await ops.readFile(path);
      if (content === null) return { error: `Could not read file: ${path}` };
      const allLines = content.split("\n");
      const totalLines = allLines.length;
      const startLine = offset ? offset - 1 : 0;
      const endLine = limit ? startLine + limit : allLines.length;
      const numbered = allLines.slice(startLine, endLine).map((line, i) => {
        return `${startLine + i + 1}\t${line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + "... (truncated)" : line}`;
      });
      let output;
      if (numbered.length > MAX_LINES)
        output =
          numbered.slice(0, MAX_LINES).join("\n") +
          `\n... (${numbered.length - MAX_LINES} more lines truncated)`;
      else output = numbered.join("\n");
      const result = {
        path,
        content: output,
        totalLines
      };
      if (offset || limit) {
        result.fromLine = startLine + 1;
        result.toLine = Math.min(endLine, totalLines);
      }
      return result;
    }
  });
}
function createWriteTool(options) {
  const { ops } = options;
  return tool({
    description:
      "Write content to a file. Creates the file if it does not exist, overwrites if it does. Parent directories are created automatically.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path to the file"),
      content: z.string().describe("Content to write to the file")
    }),
    execute: async ({ path, content }) => {
      const parent = path.replace(/\/[^/]+$/, "");
      if (parent && parent !== "/")
        await ops.mkdir(parent, { recursive: true });
      await ops.writeFile(path, content);
      const lines = content.split("\n").length;
      return {
        path,
        bytesWritten: new TextEncoder().encode(content).byteLength,
        lines
      };
    }
  });
}
function createEditTool(options) {
  const { ops } = options;
  return tool({
    description:
      "Make a targeted edit to a file by replacing an exact string match. Provide the old_string to find and new_string to replace it with. The old_string must match exactly (including whitespace and indentation). Use an empty old_string with new_string to create a new file.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path to the file"),
      old_string: z
        .string()
        .describe(
          "Exact text to find and replace. Empty string to create a new file."
        ),
      new_string: z.string().describe("Replacement text")
    }),
    execute: async ({ path, old_string, new_string }) => {
      if (old_string === "") {
        if ((await ops.readFile(path)) !== null)
          return {
            error:
              "File already exists. Provide old_string to edit, or use the write tool to overwrite."
          };
        await ops.writeFile(path, new_string);
        return {
          path,
          created: true,
          lines: new_string.split("\n").length
        };
      }
      const content = await ops.readFile(path);
      if (content === null) return { error: `File not found: ${path}` };
      const occurrences = countOccurrences(content, old_string);
      if (occurrences === 0) {
        const fuzzyResult = fuzzyReplace(content, old_string, new_string);
        if (fuzzyResult === "ambiguous")
          return {
            error:
              "old_string matches multiple locations after whitespace normalization. Include more surrounding context to make the match unique."
          };
        if (fuzzyResult !== null) {
          await ops.writeFile(path, fuzzyResult);
          return {
            path,
            replaced: true,
            fuzzyMatch: true,
            lines: fuzzyResult.split("\n").length
          };
        }
        return {
          error:
            "old_string not found in file. Make sure it matches exactly, including whitespace and indentation. Read the file first to verify."
        };
      }
      if (occurrences > 1)
        return {
          error: `old_string appears ${occurrences} times in the file. Include more surrounding context to make the match unique.`
        };
      const newContent = content.replace(old_string, new_string);
      await ops.writeFile(path, newContent);
      return {
        path,
        replaced: true,
        lines: newContent.split("\n").length
      };
    }
  });
}
function countOccurrences(text, search) {
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = text.indexOf(search, pos);
    if (idx === -1) break;
    count++;
    pos = idx + 1;
  }
  return count;
}
/**
 * Fuzzy replacement: normalize whitespace in both the file content
 * and the search string, find the match, then replace the corresponding
 * region in the original content.
 */
function fuzzyReplace(content, oldStr, newStr) {
  const normalizedContent = normalizeWhitespace(content);
  const normalizedSearch = normalizeWhitespace(oldStr);
  if (!normalizedSearch) return null;
  const idx = normalizedContent.indexOf(normalizedSearch);
  if (idx === -1) return null;
  if (
    normalizedContent.indexOf(
      normalizedSearch,
      idx + normalizedSearch.length
    ) !== -1
  )
    return "ambiguous";
  const originalStart = mapToOriginal(content, idx);
  const originalEnd = mapToOriginal(content, idx + normalizedSearch.length);
  return content.slice(0, originalStart) + newStr + content.slice(originalEnd);
}
function normalizeWhitespace(s) {
  return s.replace(/[ \t]+/g, " ").replace(/\r\n/g, "\n");
}
/**
 * Map a position in the normalized string back to the original string.
 * Walks both strings char-by-char, skipping extra whitespace in the original.
 */
function mapToOriginal(original, normalizedPos) {
  let ni = 0;
  let oi = 0;
  while (ni < normalizedPos && oi < original.length) {
    const oc = original[oi];
    if (oc === "\r" && original[oi + 1] === "\n") {
      oi += 2;
      ni += 1;
    } else if (oc === " " || oc === "	") {
      oi++;
      while (
        oi < original.length &&
        (original[oi] === " " || original[oi] === "	")
      )
        oi++;
      ni++;
    } else {
      oi++;
      ni++;
    }
  }
  return oi;
}
function createListTool(options) {
  const { ops } = options;
  return tool({
    description:
      "List files and directories in a given path. Returns names, types, and sizes for each entry.",
    inputSchema: z.object({
      path: z
        .string()
        .default("/")
        .describe("Absolute path to the directory to list"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1e3)
        .optional()
        .describe("Maximum number of entries to return (default: 200)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of entries to skip (for pagination)")
    }),
    execute: async ({ path, limit, offset }) => {
      const maxEntries = limit ?? 200;
      const entries = await ops.readDir(path, {
        limit: maxEntries,
        offset: offset ?? 0
      });
      const formatted = entries.map((entry) => {
        const suffix = entry.type === "directory" ? "/" : "";
        const sizeStr =
          entry.type === "file" ? ` (${formatSize(entry.size)})` : "";
        return `${entry.name}${suffix}${sizeStr}`;
      });
      return {
        path,
        count: entries.length,
        entries: formatted
      };
    }
  });
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function createFindTool(options) {
  const { ops } = options;
  return tool({
    description:
      "Find files matching a glob pattern. Supports standard glob syntax: * matches any file, ** matches directories recursively, ? matches a single character. Returns matching file paths with types and sizes.",
    inputSchema: z.object({
      pattern: z
        .string()
        .describe(
          'Glob pattern to match (e.g. "**/*.ts", "src/**/*.test.ts", "*.md")'
        )
    }),
    execute: async ({ pattern }) => {
      const matches = await ops.glob(pattern);
      const MAX_RESULTS = 200;
      const truncated = matches.length > MAX_RESULTS;
      const formatted = matches.slice(0, MAX_RESULTS).map((entry) => {
        const suffix = entry.type === "directory" ? "/" : "";
        return `${entry.path}${suffix}`;
      });
      const result = {
        pattern,
        count: matches.length,
        files: formatted
      };
      if (truncated) {
        result.truncated = true;
        result.showing = MAX_RESULTS;
      }
      return result;
    }
  });
}
const MAX_MATCHES = 200;
const MAX_FILE_SIZE = 1048576;
function createGrepTool(options) {
  const { ops } = options;
  return tool({
    description:
      "Search file contents using a regular expression or fixed string. Returns matching lines with file paths and line numbers. Searches all files matching the include glob, or all files if not specified.",
    inputSchema: z.object({
      query: z.string().describe("Search pattern (regex or fixed string)"),
      include: z
        .string()
        .optional()
        .describe(
          'Glob pattern to filter files (e.g. "**/*.ts"). Defaults to "**/*"'
        ),
      fixedString: z
        .boolean()
        .optional()
        .describe("If true, treat query as a literal string instead of regex"),
      caseSensitive: z
        .boolean()
        .optional()
        .describe("If true, search is case-sensitive (default: false)"),
      contextLines: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe("Number of context lines around each match (default: 0)")
    }),
    execute: async ({
      query,
      include,
      fixedString,
      caseSensitive,
      contextLines
    }) => {
      const pattern = include ?? "**/*";
      const files = (await ops.glob(pattern)).filter((f) => f.type === "file");
      let regex;
      try {
        const escaped = fixedString ? escapeRegex(query) : query;
        regex = new RegExp(escaped, caseSensitive ? "g" : "gi");
      } catch {
        return { error: `Invalid regex: ${query}` };
      }
      const ctx = contextLines ?? 0;
      const matches = [];
      let totalMatches = 0;
      let filesSearched = 0;
      let filesWithMatches = 0;
      let filesSkipped = 0;
      for (const file of files) {
        if (totalMatches >= MAX_MATCHES) break;
        if (file.size > MAX_FILE_SIZE) {
          filesSkipped++;
          continue;
        }
        const content = await ops.readFile(file.path);
        if (content === null) continue;
        filesSearched++;
        const lines = content.split("\n");
        let fileHasMatch = false;
        for (let i = 0; i < lines.length; i++) {
          if (totalMatches >= MAX_MATCHES) break;
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            if (!fileHasMatch) {
              fileHasMatch = true;
              filesWithMatches++;
            }
            totalMatches++;
            const match = {
              file: file.path,
              line: i + 1,
              text: lines[i]
            };
            if (ctx > 0) {
              const start = Math.max(0, i - ctx);
              const end = Math.min(lines.length, i + ctx + 1);
              match.context = lines.slice(start, end).map((l, j) => {
                const lineNum = start + j + 1;
                return `${lineNum === i + 1 ? ">" : " "} ${lineNum}\t${l}`;
              });
            }
            matches.push(match);
          }
        }
      }
      const result = {
        query,
        filesSearched,
        filesWithMatches,
        totalMatches,
        matches: matches.map((m) => {
          if (m.context)
            return {
              file: m.file,
              line: m.line,
              context: m.context.join("\n")
            };
          return `${m.file}:${m.line}: ${m.text}`;
        })
      };
      if (totalMatches >= MAX_MATCHES) result.truncated = true;
      if (filesSkipped > 0) {
        result.filesSkipped = filesSkipped;
        result.note = `${filesSkipped} file(s) skipped (larger than 1 MB)`;
      }
      return result;
    }
  });
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function createDeleteTool(options) {
  const { ops } = options;
  return tool({
    description:
      "Delete a file or directory. Set recursive to true to remove non-empty directories.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path to the file or directory"),
      recursive: z
        .boolean()
        .optional()
        .describe("If true, remove directories and their contents recursively")
    }),
    execute: async ({ path, recursive }) => {
      await ops.rm(path, {
        recursive,
        force: true
      });
      return { deleted: path };
    }
  });
}
//#endregion
export {
  createDeleteTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createListTool,
  createReadTool,
  createWorkspaceTools,
  createWriteTool
};

//# sourceMappingURL=workspace.js.map
