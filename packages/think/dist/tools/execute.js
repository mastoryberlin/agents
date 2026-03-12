import { createCodeTool } from "@cloudflare/codemode/ai";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
//#region src/tools/execute.ts
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
function createExecuteTool(options) {
  const { tools, description } = options;
  let executor;
  if (options.executor) executor = options.executor;
  else if (options.loader)
    executor = new DynamicWorkerExecutor({
      loader: options.loader,
      timeout: options.timeout,
      globalOutbound: options.globalOutbound
    });
  else
    throw new Error(
      "createExecuteTool requires either an `executor` or a `loader` (WorkerLoader binding)."
    );
  return createCodeTool({
    tools,
    executor,
    description
  });
}
//#endregion
export { createExecuteTool };

//# sourceMappingURL=execute.js.map
