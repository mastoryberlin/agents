import { ToolSet } from "ai";
import { WorkerEntrypoint } from "cloudflare:workers";

//#region src/extensions/types.d.ts
/**
 * Extension system types.
 *
 * Extensions are sandboxed Workers loaded on demand via WorkerLoader.
 * Each extension provides tools that the agent can use, with controlled
 * access to the host (workspace, network) via permissions.
 */
/**
 * Manifest declaring an extension's identity and permissions.
 * Passed to ExtensionManager.load() alongside the extension source.
 */
interface ExtensionManifest {
  /** Unique name for this extension (used as namespace prefix for tools). */
  name: string;
  /** Semver version string. */
  version: string;
  /** Human-readable description. */
  description?: string;
  /** Permission declarations — controls what the extension can access. */
  permissions?: ExtensionPermissions;
}
interface ExtensionPermissions {
  /**
   * Allowed network hosts. If empty or undefined, the extension has
   * no outbound network access (globalOutbound: null).
   * If set, the extension inherits the parent Worker's network.
   *
   * Note: per-host filtering is not yet enforced at the runtime level.
   * This field serves as a declaration of intent; actual enforcement
   * is all-or-nothing via globalOutbound.
   */
  network?: string[];
  /**
   * Workspace access level.
   * - "none" (default): no workspace access
   * - "read": can read files and list directories
   * - "read-write": can read, write, and delete files
   */
  workspace?: "read" | "read-write" | "none";
}
/**
 * Tool descriptor returned by the extension's describe() method.
 * Uses JSON Schema for input validation.
 */
interface ExtensionToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
/**
 * Summary of a loaded extension, returned by ExtensionManager.list().
 */
interface ExtensionInfo {
  name: string;
  version: string;
  description?: string;
  /** Names of tools provided by this extension. */
  tools: string[];
  permissions: ExtensionPermissions;
}
//#endregion
//#region src/extensions/manager.d.ts
interface ExtensionManagerOptions {
  /** WorkerLoader binding for creating sandboxed extension Workers. */
  loader: WorkerLoader;
  /**
   * Durable Object storage for persisting extensions across hibernation.
   * If provided, loaded extensions survive DO restarts. Call `restore()`
   * on each turn to rebuild in-memory state from storage.
   */
  storage?: DurableObjectStorage;
  /**
   * Factory that creates a loopback Fetcher for workspace access, given
   * an extension's declared permissions. The returned binding is injected
   * into the extension worker's `env.host`.
   *
   * If not provided, extensions receive no host binding (workspace tools
   * will get `null` for the host parameter).
   *
   * Typically wired up using HostBridgeLoopback via `ctx.exports`:
   * ```typescript
   * createHostBinding: (permissions) =>
   *   ctx.exports.HostBridgeLoopback({
   *     props: { agentClassName: "ChatSession", agentId: ctx.id.toString(), permissions }
   *   })
   * ```
   */
  createHostBinding?: (permissions: ExtensionPermissions) => Fetcher;
}
declare class ExtensionManager {
  #private;
  constructor(options: ExtensionManagerOptions);
  /**
   * Load an extension from source code.
   *
   * The source is a JS object expression defining tools. Each tool has
   * `description`, `parameters` (JSON Schema properties), optional
   * `required` array, and an `execute` async function.
   *
   * @returns Summary of the loaded extension including discovered tools.
   */
  /**
   * Restore extensions from DO storage after hibernation.
   *
   * Idempotent — skips extensions already in memory. Call this at the
   * start of each chat turn (e.g. in onChatMessage before getTools).
   */
  restore(): Promise<void>;
  load(manifest: ExtensionManifest, source: string): Promise<ExtensionInfo>;
  /**
   * Unload an extension, removing its tools from the agent.
   */
  unload(name: string): Promise<boolean>;
  /**
   * List all loaded extensions.
   */
  list(): ExtensionInfo[];
  /**
   * Get AI SDK tools from all loaded extensions.
   *
   * Tool names are prefixed with the sanitized extension name to avoid
   * collisions: e.g. extension "github" with tool "create_pr" → "github_create_pr".
   */
  getTools(): ToolSet;
}
//#endregion
//#region src/extensions/host-bridge.d.ts
type HostBridgeLoopbackProps = {
  agentClassName: string;
  agentId: string;
  permissions: ExtensionPermissions;
};
declare class HostBridgeLoopback extends WorkerEntrypoint<
  Record<string, unknown>,
  HostBridgeLoopbackProps
> {
  #private;
  private _permissions;
  private _getAgent;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<boolean>;
  listFiles(dir: string): Promise<
    Array<{
      name: string;
      type: string;
      size: number;
      path: string;
    }>
  >;
}
//#endregion
export {
  ExtensionInfo as a,
  ExtensionToolDescriptor as c,
  ExtensionManagerOptions as i,
  HostBridgeLoopbackProps as n,
  ExtensionManifest as o,
  ExtensionManager as r,
  ExtensionPermissions as s,
  HostBridgeLoopback as t
};
//# sourceMappingURL=index-BlcvIdWK.d.ts.map
