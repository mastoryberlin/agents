import {
  n as generateTypes,
  r as sanitizeToolName,
  t as normalizeCode
} from "./normalize-Dy5d7PfI.js";
import { asSchema, tool } from "ai";
import { z } from "zod";
//#region src/tool.ts
const DEFAULT_DESCRIPTION = `Execute code to achieve a goal.

Available:
{{types}}

Write an async arrow function in JavaScript that returns the result.
Do NOT use TypeScript syntax — no type annotations, interfaces, or generics.
Do NOT define named functions then call them — just write the arrow function body directly.

Example: async () => { const r = await codemode.searchWeb({ query: "test" }); return r; }`;
const codeSchema = z.object({
  code: z.string().describe("JavaScript async arrow function to execute")
});
/**
 * Create a codemode tool that allows LLMs to write and execute code
 * with access to your tools in a sandboxed environment.
 *
 * Returns an AI SDK compatible tool.
 */
function hasNeedsApproval(t) {
  return "needsApproval" in t && t.needsApproval != null;
}
function createCodeTool(options) {
  const tools = {};
  for (const [name, t] of Object.entries(options.tools))
    if (!hasNeedsApproval(t)) tools[name] = t;
  const types = generateTypes(tools);
  const executor = options.executor;
  return tool({
    description: (options.description ?? DEFAULT_DESCRIPTION).replace(
      "{{types}}",
      types
    ),
    inputSchema: codeSchema,
    execute: async ({ code }) => {
      const fns = {};
      for (const [name, t] of Object.entries(tools)) {
        const execute = "execute" in t ? t.execute : void 0;
        if (execute) {
          const rawSchema =
            "inputSchema" in t
              ? t.inputSchema
              : "parameters" in t
                ? t.parameters
                : void 0;
          const schema = rawSchema != null ? asSchema(rawSchema) : void 0;
          fns[sanitizeToolName(name)] = schema?.validate
            ? async (args) => {
                const result = await schema.validate(args);
                if (!result.success) throw result.error;
                return execute(result.value);
              }
            : execute;
        }
      }
      const normalizedCode = normalizeCode(code);
      const executeResult = await executor.execute(normalizedCode, fns);
      if (executeResult.error) {
        const logCtx = executeResult.logs?.length
          ? `\n\nConsole output:\n${executeResult.logs.join("\n")}`
          : "";
        throw new Error(
          `Code execution failed: ${executeResult.error}${logCtx}`
        );
      }
      const output = {
        code,
        result: executeResult.result
      };
      if (executeResult.logs) output.logs = executeResult.logs;
      return output;
    }
  });
}
//#endregion
export { createCodeTool };

//# sourceMappingURL=ai.js.map
