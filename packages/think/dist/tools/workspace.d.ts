import * as ai from "ai";
import { FileInfo, Workspace } from "agents/experimental/workspace";

//#region src/tools/workspace.d.ts
interface ReadOperations {
  readFile(path: string): Promise<string | null>;
  stat(path: string): Promise<FileInfo | null> | FileInfo | null;
}
interface WriteOperations {
  writeFile(path: string, content: string): Promise<void>;
  mkdir(
    path: string,
    opts?: {
      recursive?: boolean;
    }
  ): Promise<void> | void;
}
interface EditOperations {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}
interface ListOperations {
  readDir(
    dir: string,
    opts?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<FileInfo[]> | FileInfo[];
}
interface FindOperations {
  glob(pattern: string): Promise<FileInfo[]> | FileInfo[];
}
interface DeleteOperations {
  rm(
    path: string,
    opts?: {
      recursive?: boolean;
      force?: boolean;
    }
  ): Promise<void>;
}
interface GrepOperations {
  glob(pattern: string): Promise<FileInfo[]> | FileInfo[];
  readFile(path: string): Promise<string | null>;
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
declare function createWorkspaceTools(workspace: Workspace): {
  read: ai.Tool<
    {
      path: string;
      offset?: number | undefined;
      limit?: number | undefined;
    },
    Record<string, unknown>
  >;
  write: ai.Tool<
    {
      path: string;
      content: string;
    },
    {
      path: string;
      bytesWritten: number;
      lines: number;
    }
  >;
  edit: ai.Tool<
    {
      path: string;
      old_string: string;
      new_string: string;
    },
    | {
        error: string;
        path?: undefined;
        created?: undefined;
        lines?: undefined;
        replaced?: undefined;
        fuzzyMatch?: undefined;
      }
    | {
        path: string;
        created: boolean;
        lines: number;
        error?: undefined;
        replaced?: undefined;
        fuzzyMatch?: undefined;
      }
    | {
        path: string;
        replaced: boolean;
        fuzzyMatch: boolean;
        lines: number;
        error?: undefined;
        created?: undefined;
      }
    | {
        path: string;
        replaced: boolean;
        lines: number;
        error?: undefined;
        created?: undefined;
        fuzzyMatch?: undefined;
      }
  >;
  list: ai.Tool<
    {
      path: string;
      limit?: number | undefined;
      offset?: number | undefined;
    },
    {
      path: string;
      count: number;
      entries: string[];
    }
  >;
  find: ai.Tool<
    {
      pattern: string;
    },
    Record<string, unknown>
  >;
  grep: ai.Tool<
    {
      query: string;
      include?: string | undefined;
      fixedString?: boolean | undefined;
      caseSensitive?: boolean | undefined;
      contextLines?: number | undefined;
    },
    Record<string, unknown>
  >;
  delete: ai.Tool<
    {
      path: string;
      recursive?: boolean | undefined;
    },
    {
      deleted: string;
    }
  >;
};
interface ReadToolOptions {
  ops: ReadOperations;
}
declare function createReadTool(options: ReadToolOptions): ai.Tool<
  {
    path: string;
    offset?: number | undefined;
    limit?: number | undefined;
  },
  Record<string, unknown>
>;
interface WriteToolOptions {
  ops: WriteOperations;
}
declare function createWriteTool(options: WriteToolOptions): ai.Tool<
  {
    path: string;
    content: string;
  },
  {
    path: string;
    bytesWritten: number;
    lines: number;
  }
>;
interface EditToolOptions {
  ops: EditOperations;
}
declare function createEditTool(options: EditToolOptions): ai.Tool<
  {
    path: string;
    old_string: string;
    new_string: string;
  },
  | {
      error: string;
      path?: undefined;
      created?: undefined;
      lines?: undefined;
      replaced?: undefined;
      fuzzyMatch?: undefined;
    }
  | {
      path: string;
      created: boolean;
      lines: number;
      error?: undefined;
      replaced?: undefined;
      fuzzyMatch?: undefined;
    }
  | {
      path: string;
      replaced: boolean;
      fuzzyMatch: boolean;
      lines: number;
      error?: undefined;
      created?: undefined;
    }
  | {
      path: string;
      replaced: boolean;
      lines: number;
      error?: undefined;
      created?: undefined;
      fuzzyMatch?: undefined;
    }
>;
interface ListToolOptions {
  ops: ListOperations;
}
declare function createListTool(options: ListToolOptions): ai.Tool<
  {
    path: string;
    limit?: number | undefined;
    offset?: number | undefined;
  },
  {
    path: string;
    count: number;
    entries: string[];
  }
>;
interface FindToolOptions {
  ops: FindOperations;
}
declare function createFindTool(options: FindToolOptions): ai.Tool<
  {
    pattern: string;
  },
  Record<string, unknown>
>;
interface GrepToolOptions {
  ops: GrepOperations;
}
declare function createGrepTool(options: GrepToolOptions): ai.Tool<
  {
    query: string;
    include?: string | undefined;
    fixedString?: boolean | undefined;
    caseSensitive?: boolean | undefined;
    contextLines?: number | undefined;
  },
  Record<string, unknown>
>;
interface DeleteToolOptions {
  ops: DeleteOperations;
}
declare function createDeleteTool(options: DeleteToolOptions): ai.Tool<
  {
    path: string;
    recursive?: boolean | undefined;
  },
  {
    deleted: string;
  }
>;
//#endregion
export {
  DeleteOperations,
  DeleteToolOptions,
  EditOperations,
  EditToolOptions,
  FindOperations,
  FindToolOptions,
  GrepOperations,
  GrepToolOptions,
  ListOperations,
  ListToolOptions,
  ReadOperations,
  ReadToolOptions,
  WriteOperations,
  WriteToolOptions,
  createDeleteTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createListTool,
  createReadTool,
  createWorkspaceTools,
  createWriteTool
};
//# sourceMappingURL=workspace.d.ts.map
