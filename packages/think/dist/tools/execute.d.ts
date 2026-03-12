import * as ai from "ai";
import { ToolSet } from "ai";
import { Executor } from "@cloudflare/codemode";

//#region src/tools/execute.d.ts
interface CreateExecuteToolOptions {
  /**
   * The tools available inside the sandboxed code.
   * These are exposed as `codemode.toolName(args)` in the sandbox.
   *
   * Typically this is the workspace tools from `createWorkspaceTools()`,
   * but can include any AI SDK tools with `execute` functions.
   */
  tools: ToolSet;
  /**
   * The executor that runs the generated code.
   *
   * Use `DynamicWorkerExecutor` for Cloudflare Workers (requires a
   * `worker_loaders` binding in wrangler.jsonc), or implement the
   * `Executor` interface for other runtimes.
   *
   * If not provided, you must provide a `loader` instead.
   */
  executor?: Executor;
  /**
   * WorkerLoader binding for creating a `DynamicWorkerExecutor`.
   * This is a convenience alternative to passing a full `executor`.
   *
   * Requires `"worker_loaders": [{ "binding": "LOADER" }]` in wrangler.jsonc.
   */
  loader?: WorkerLoader;
  /**
   * Timeout in milliseconds for code execution. Defaults to 30000 (30s).
   * Only used when `loader` is provided (ignored if `executor` is given).
   */
  timeout?: number;
  /**
   * Controls outbound network access from sandboxed code.
   * - `null` (default): fetch() and connect() throw — sandbox is fully isolated.
   * - `undefined`: inherits parent Worker's network access.
   * - A `Fetcher`: all outbound requests route through this handler.
   *
   * Only used when `loader` is provided (ignored if `executor` is given).
   */
  globalOutbound?: Fetcher | null;
  /**
   * Custom tool description. Use `{{types}}` as a placeholder for the
   * auto-generated TypeScript type definitions of the available tools.
   */
  description?: string;
}
/**
 * Create a code execution tool that lets the LLM write and run JavaScript
 * with access to your tools in a sandboxed environment.
 *
 * The LLM sees typed `codemode.*` functions and writes code that calls them.
 * Code runs in an isolated Worker via `DynamicWorkerExecutor` — external
 * network access is blocked by default.
 *
 * @example
 * ```ts
 * import { createWorkspaceTools, createExecuteTool } from "@cloudflare/think";
 *
 * getTools() {
 *   const workspaceTools = createWorkspaceTools(this.workspace);
 *   return {
 *     ...workspaceTools,
 *     execute: createExecuteTool({
 *       tools: workspaceTools,
 *       loader: this.env.LOADER,
 *     }),
 *   };
 * }
 * ```
 *
 * @example Using a custom executor
 * ```ts
 * import { DynamicWorkerExecutor } from "@cloudflare/codemode";
 *
 * const executor = new DynamicWorkerExecutor({
 *   loader: this.env.LOADER,
 *   timeout: 60000,
 *   globalOutbound: this.env.OUTBOUND,
 * });
 *
 * getTools() {
 *   return {
 *     execute: createExecuteTool({ tools: myTools, executor }),
 *   };
 * }
 * ```
 */
declare function createExecuteTool(options: CreateExecuteToolOptions): ai.Tool<
  {
    code: string;
  },
  {
    code: string;
    result: unknown;
    logs?: string[];
  }
>;
//#endregion
export { CreateExecuteToolOptions, createExecuteTool };
//# sourceMappingURL=execute.d.ts.map
