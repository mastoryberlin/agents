import {
  r as ExtensionManager,
  s as ExtensionPermissions
} from "../index-BlcvIdWK.js";
import * as ai from "ai";

//#region src/tools/extensions.d.ts
interface ExtensionToolsOptions {
  manager: ExtensionManager;
}
/**
 * Create AI SDK tools for managing extensions at runtime.
 *
 * These tools let the LLM load and list extensions dynamically.
 * Loaded extensions expose their own tools on the next inference
 * turn. Unloading is a client-side action (via @callable RPC).
 *
 * @example
 * ```ts
 * const extensions = new ExtensionManager({ loader: this.env.LOADER, workspace: this.workspace });
 * const extensionTools = createExtensionTools({ manager: extensions });
 *
 * getTools() {
 *   return {
 *     ...createWorkspaceTools(this.workspace),
 *     ...extensionTools,
 *     ...extensions.getTools(), // tools from loaded extensions
 *   };
 * }
 * ```
 */
declare function createExtensionTools(options: ExtensionToolsOptions): {
  load_extension: ai.Tool<
    {
      name: string;
      version: string;
      source: string;
      description?: string | undefined;
      workspace_access?: "none" | "read" | "read-write" | undefined;
      network?: string[] | undefined;
    },
    {
      loaded: boolean;
      name: string;
      prefix: string;
      version: string;
      tools: string[];
      message: string;
    }
  >;
  list_extensions: ai.Tool<
    Record<string, never>,
    {
      count: number;
      extensions: {
        name: string;
        version: string;
        description: string | undefined;
        tools: string[];
        permissions: ExtensionPermissions;
      }[];
    }
  >;
};
//#endregion
export { ExtensionToolsOptions, createExtensionTools };
//# sourceMappingURL=extensions.d.ts.map
