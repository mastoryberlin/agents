import { asSchema } from "ai";
import * as acorn from "acorn";
//#region src/types.ts
const JS_RESERVED = new Set([
  "abstract",
  "arguments",
  "await",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "final",
  "finally",
  "float",
  "for",
  "function",
  "goto",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "int",
  "interface",
  "let",
  "long",
  "native",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "volatile",
  "while",
  "with",
  "yield"
]);
/**
 * Sanitize a tool name into a valid JavaScript identifier.
 * Replaces hyphens, dots, and spaces with `_`, strips other invalid chars,
 * prefixes digit-leading names with `_`, and appends `_` to JS reserved words.
 */
function sanitizeToolName(name) {
  if (!name) return "_";
  let sanitized = name.replace(/[-.\s]/g, "_");
  sanitized = sanitized.replace(/[^a-zA-Z0-9_$]/g, "");
  if (!sanitized) return "_";
  if (/^[0-9]/.test(sanitized)) sanitized = "_" + sanitized;
  if (JS_RESERVED.has(sanitized)) sanitized = sanitized + "_";
  return sanitized;
}
function toCamelCase(str) {
  return str
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}
/**
 * Extract field descriptions from a schema and format as @param lines.
 * Returns an array of `@param input.fieldName - description` lines.
 */
function extractParamDescriptions(schema) {
  const descriptions = extractDescriptions(schema);
  return Object.entries(descriptions).map(
    ([fieldName, desc]) => `@param input.${fieldName} - ${desc}`
  );
}
/**
 * Check if a value is a Zod schema (has _zod property).
 */
function isZodSchema(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    "_zod" in value &&
    value._zod !== void 0
  );
}
/**
 * Check if a value conforms to the Standard Schema protocol (~standard).
 * This catches Zod v3 schemas (which expose ~standard but not _zod).
 */
function isStandardSchema(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    "~standard" in value &&
    value["~standard"] !== void 0
  );
}
/**
 * Check if a value is an AI SDK jsonSchema wrapper.
 * The jsonSchema wrapper has a [Symbol] with jsonSchema property.
 */
function isJsonSchemaWrapper(value) {
  if (value === null || typeof value !== "object") return false;
  if ("jsonSchema" in value) return true;
  const symbols = Object.getOwnPropertySymbols(value);
  for (const sym of symbols) {
    const symValue = value[sym];
    if (symValue && typeof symValue === "object" && "jsonSchema" in symValue)
      return true;
  }
  return false;
}
/**
 * Extract JSON schema from an AI SDK jsonSchema wrapper.
 */
function extractJsonSchema(wrapper) {
  if (wrapper === null || typeof wrapper !== "object") return null;
  if ("jsonSchema" in wrapper) return wrapper.jsonSchema;
  const symbols = Object.getOwnPropertySymbols(wrapper);
  for (const sym of symbols) {
    const symValue = wrapper[sym];
    if (symValue && typeof symValue === "object" && "jsonSchema" in symValue)
      return symValue.jsonSchema;
  }
  return null;
}
/**
 * Check if a property name needs quoting in TypeScript.
 */
function needsQuotes(name) {
  return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}
/**
 * Escape a character as a unicode escape sequence if it is a control character.
 */
function escapeControlChar(ch) {
  const code = ch.charCodeAt(0);
  if (code <= 31 || code === 127)
    return "\\u" + code.toString(16).padStart(4, "0");
  return ch;
}
/**
 * Quote a property name if needed.
 * Escapes backslashes, quotes, and control characters.
 */
function quoteProp(name) {
  if (needsQuotes(name)) {
    let escaped = "";
    for (const ch of name)
      if (ch === "\\") escaped += "\\\\";
      else if (ch === '"') escaped += '\\"';
      else if (ch === "\n") escaped += "\\n";
      else if (ch === "\r") escaped += "\\r";
      else if (ch === "	") escaped += "\\t";
      else if (ch === "\u2028") escaped += "\\u2028";
      else if (ch === "\u2029") escaped += "\\u2029";
      else escaped += escapeControlChar(ch);
    return `"${escaped}"`;
  }
  return name;
}
/**
 * Escape a string for use inside a double-quoted TypeScript string literal.
 * Handles backslashes, quotes, newlines, control characters, and line/paragraph separators.
 */
function escapeStringLiteral(s) {
  let out = "";
  for (const ch of s)
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "	") out += "\\t";
    else if (ch === "\u2028") out += "\\u2028";
    else if (ch === "\u2029") out += "\\u2029";
    else out += escapeControlChar(ch);
  return out;
}
/**
 * Escape a string for use inside a JSDoc comment.
 * Prevents premature comment closure from star-slash sequences.
 */
function escapeJsDoc(text) {
  return text.replace(/\*\//g, "*\\/");
}
/**
 * Resolve an internal JSON Pointer $ref (e.g. #/definitions/Foo) against the root schema.
 * Returns null for external URLs or unresolvable paths.
 */
function resolveRef(ref, root) {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return null;
  const segments = ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = root;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return null;
    current = current[seg];
    if (current === void 0) return null;
  }
  if (typeof current === "boolean") return current;
  if (current === null || typeof current !== "object") return null;
  return current;
}
/**
 * Convert a JSON Schema to a TypeScript type string.
 * This is a direct conversion without going through Zod.
 */
function jsonSchemaToTypeString(schema, indent, ctx) {
  if (typeof schema === "boolean") return schema ? "unknown" : "never";
  if (ctx.depth >= ctx.maxDepth) return "unknown";
  if (ctx.seen.has(schema)) return "unknown";
  ctx.seen.add(schema);
  const nextCtx = {
    ...ctx,
    depth: ctx.depth + 1
  };
  try {
    if (schema.$ref) {
      const resolved = resolveRef(schema.$ref, ctx.root);
      if (!resolved) return "unknown";
      return applyNullable(
        jsonSchemaToTypeString(resolved, indent, nextCtx),
        schema
      );
    }
    if (schema.anyOf)
      return applyNullable(
        schema.anyOf
          .map((s) => jsonSchemaToTypeString(s, indent, nextCtx))
          .join(" | "),
        schema
      );
    if (schema.oneOf)
      return applyNullable(
        schema.oneOf
          .map((s) => jsonSchemaToTypeString(s, indent, nextCtx))
          .join(" | "),
        schema
      );
    if (schema.allOf)
      return applyNullable(
        schema.allOf
          .map((s) => jsonSchemaToTypeString(s, indent, nextCtx))
          .join(" & "),
        schema
      );
    if (schema.enum) {
      if (schema.enum.length === 0) return "never";
      return applyNullable(
        schema.enum
          .map((v) => {
            if (v === null) return "null";
            if (typeof v === "string")
              return '"' + escapeStringLiteral(v) + '"';
            if (typeof v === "object") return JSON.stringify(v) ?? "unknown";
            return String(v);
          })
          .join(" | "),
        schema
      );
    }
    if (schema.const !== void 0)
      return applyNullable(
        schema.const === null
          ? "null"
          : typeof schema.const === "string"
            ? '"' + escapeStringLiteral(schema.const) + '"'
            : typeof schema.const === "object"
              ? (JSON.stringify(schema.const) ?? "unknown")
              : String(schema.const),
        schema
      );
    const type = schema.type;
    if (type === "string") return applyNullable("string", schema);
    if (type === "number" || type === "integer")
      return applyNullable("number", schema);
    if (type === "boolean") return applyNullable("boolean", schema);
    if (type === "null") return "null";
    if (type === "array") {
      const prefixItems = schema.prefixItems;
      if (Array.isArray(prefixItems))
        return applyNullable(
          `[${prefixItems.map((s) => jsonSchemaToTypeString(s, indent, nextCtx)).join(", ")}]`,
          schema
        );
      if (Array.isArray(schema.items))
        return applyNullable(
          `[${schema.items.map((s) => jsonSchemaToTypeString(s, indent, nextCtx)).join(", ")}]`,
          schema
        );
      if (schema.items)
        return applyNullable(
          `${jsonSchemaToTypeString(schema.items, indent, nextCtx)}[]`,
          schema
        );
      return applyNullable("unknown[]", schema);
    }
    if (type === "object" || schema.properties) {
      const props = schema.properties || {};
      const required = new Set(schema.required || []);
      const lines = [];
      for (const [propName, propSchema] of Object.entries(props)) {
        if (typeof propSchema === "boolean") {
          const boolType = propSchema ? "unknown" : "never";
          const optionalMark = required.has(propName) ? "" : "?";
          lines.push(
            `${indent}    ${quoteProp(propName)}${optionalMark}: ${boolType};`
          );
          continue;
        }
        const isRequired = required.has(propName);
        const propType = jsonSchemaToTypeString(
          propSchema,
          indent + "    ",
          nextCtx
        );
        const desc = propSchema.description;
        const format = propSchema.format;
        if (desc || format) {
          const descText = desc
            ? escapeJsDoc(desc.replace(/\r?\n/g, " "))
            : void 0;
          const formatTag = format ? `@format ${escapeJsDoc(format)}` : void 0;
          if (descText && formatTag) {
            lines.push(`${indent}    /**`);
            lines.push(`${indent}     * ${descText}`);
            lines.push(`${indent}     * ${formatTag}`);
            lines.push(`${indent}     */`);
          } else lines.push(`${indent}    /** ${descText ?? formatTag} */`);
        }
        const quotedName = quoteProp(propName);
        const optionalMark = isRequired ? "" : "?";
        lines.push(`${indent}    ${quotedName}${optionalMark}: ${propType};`);
      }
      if (schema.additionalProperties) {
        const valueType =
          schema.additionalProperties === true
            ? "unknown"
            : jsonSchemaToTypeString(
                schema.additionalProperties,
                indent + "    ",
                nextCtx
              );
        lines.push(`${indent}    [key: string]: ${valueType};`);
      }
      if (lines.length === 0) {
        if (schema.additionalProperties === false)
          return applyNullable("{}", schema);
        return applyNullable("Record<string, unknown>", schema);
      }
      return applyNullable(`{\n${lines.join("\n")}\n${indent}}`, schema);
    }
    if (Array.isArray(type))
      return applyNullable(
        type
          .map((t) => {
            if (t === "string") return "string";
            if (t === "number" || t === "integer") return "number";
            if (t === "boolean") return "boolean";
            if (t === "null") return "null";
            if (t === "array") return "unknown[]";
            if (t === "object") return "Record<string, unknown>";
            return "unknown";
          })
          .join(" | "),
        schema
      );
    return "unknown";
  } finally {
    ctx.seen.delete(schema);
  }
}
/**
 * Apply OpenAPI 3.0 `nullable: true` to a type result.
 */
function applyNullable(result, schema) {
  if (result !== "unknown" && result !== "never" && schema?.nullable === true)
    return `${result} | null`;
  return result;
}
/**
 * Extract field descriptions from a schema.
 * Works with Zod schemas (via .shape) and jsonSchema wrappers (via .properties).
 */
function extractDescriptions(schema) {
  const descriptions = {};
  const shape = schema.shape;
  if (shape && typeof shape === "object") {
    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
      let s = fieldSchema;
      while (!s.description && typeof s.unwrap === "function") s = s.unwrap();
      if (s.description) descriptions[fieldName] = s.description;
    }
    return descriptions;
  }
  if (isJsonSchemaWrapper(schema)) {
    const jsonSchema = extractJsonSchema(schema);
    if (jsonSchema?.properties) {
      for (const [fieldName, propSchema] of Object.entries(
        jsonSchema.properties
      ))
        if (
          propSchema &&
          typeof propSchema === "object" &&
          propSchema.description
        )
          descriptions[fieldName] = propSchema.description;
    }
  }
  return descriptions;
}
/**
 * Safely convert a schema to TypeScript type string.
 * Handles Zod schemas (v3/v4) and AI SDK jsonSchema wrappers.
 * Returns "unknown" if the schema cannot be represented in TypeScript.
 */
function safeSchemaToTs(schema, typeName) {
  try {
    if (isZodSchema(schema) || isStandardSchema(schema)) {
      const jsonSchema = asSchema(schema).jsonSchema;
      if (jsonSchema)
        return `type ${typeName} = ${jsonSchemaToTypeString(jsonSchema, "", {
          root: jsonSchema,
          depth: 0,
          seen: /* @__PURE__ */ new Set(),
          maxDepth: 20
        })}`;
    }
    if (isJsonSchemaWrapper(schema)) {
      const jsonSchema = extractJsonSchema(schema);
      if (jsonSchema)
        return `type ${typeName} = ${jsonSchemaToTypeString(jsonSchema, "", {
          root: jsonSchema,
          depth: 0,
          seen: /* @__PURE__ */ new Set(),
          maxDepth: 20
        })}`;
    }
    return `type ${typeName} = unknown`;
  } catch {
    return `type ${typeName} = unknown`;
  }
}
/**
 * Generate TypeScript type definitions from tool descriptors or an AI SDK ToolSet.
 * These types can be included in tool descriptions to help LLMs write correct code.
 */
function generateTypes(tools) {
  let availableTools = "";
  let availableTypes = "";
  for (const [toolName, tool] of Object.entries(tools)) {
    const safeName = sanitizeToolName(toolName);
    const camelName = toCamelCase(safeName);
    try {
      const inputSchema =
        "inputSchema" in tool ? tool.inputSchema : tool.parameters;
      const outputSchema = "outputSchema" in tool ? tool.outputSchema : void 0;
      const description = tool.description;
      const inputType = safeSchemaToTs(inputSchema, `${camelName}Input`);
      const outputType = outputSchema
        ? safeSchemaToTs(outputSchema, `${camelName}Output`)
        : `type ${camelName}Output = unknown`;
      availableTypes += `\n${inputType.trim()}`;
      availableTypes += `\n${outputType.trim()}`;
      const paramDescs = inputSchema
        ? extractParamDescriptions(inputSchema)
        : [];
      const jsdocLines = [];
      if (description?.trim())
        jsdocLines.push(escapeJsDoc(description.trim().replace(/\r?\n/g, " ")));
      else jsdocLines.push(escapeJsDoc(toolName));
      for (const pd of paramDescs)
        jsdocLines.push(escapeJsDoc(pd.replace(/\r?\n/g, " ")));
      const jsdocBody = jsdocLines.map((l) => `\t * ${l}`).join("\n");
      availableTools += `\n\t/**\n${jsdocBody}\n\t */`;
      availableTools += `\n\t${safeName}: (input: ${camelName}Input) => Promise<${camelName}Output>;`;
      availableTools += "\n";
    } catch {
      availableTypes += `\ntype ${camelName}Input = unknown`;
      availableTypes += `\ntype ${camelName}Output = unknown`;
      availableTools += `\n\t/**\n\t * ${escapeJsDoc(toolName)}\n\t */`;
      availableTools += `\n\t${safeName}: (input: ${camelName}Input) => Promise<${camelName}Output>;`;
      availableTools += "\n";
    }
  }
  availableTools = `\ndeclare const codemode: {${availableTools}}`;
  return `
${availableTypes}
${availableTools}
  `.trim();
}
//#endregion
//#region src/normalize.ts
/**
 * Strip markdown code fences that LLMs commonly wrap code in.
 * Handles ```js, ```javascript, ```typescript, ```ts, or bare ```.
 */
function stripCodeFences(code) {
  const match = code.match(
    /^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/
  );
  return match ? match[1] : code;
}
function normalizeCode(code) {
  const trimmed = stripCodeFences(code.trim());
  if (!trimmed.trim()) return "async () => {}";
  const source = trimmed.trim();
  try {
    const ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module"
    });
    if (ast.body.length === 1 && ast.body[0].type === "ExpressionStatement") {
      if (ast.body[0].expression.type === "ArrowFunctionExpression")
        return source;
    }
    if (
      ast.body.length === 1 &&
      ast.body[0].type === "ExportDefaultDeclaration"
    ) {
      const decl = ast.body[0].declaration;
      const inner = source.slice(decl.start, decl.end);
      if (decl.type === "FunctionDeclaration" && !decl.id)
        return `async () => {\nreturn (${inner})();\n}`;
      if (decl.type === "ClassDeclaration" && !decl.id)
        return `async () => {\nreturn (${inner});\n}`;
      return normalizeCode(inner);
    }
    if (ast.body.length === 1 && ast.body[0].type === "FunctionDeclaration")
      return `async () => {\n${source}\nreturn ${ast.body[0].id?.name ?? "fn"}();\n}`;
    const last = ast.body[ast.body.length - 1];
    if (last?.type === "ExpressionStatement") {
      const exprStmt = last;
      return `async () => {\n${source.slice(0, last.start)}return (${source.slice(exprStmt.expression.start, exprStmt.expression.end)})\n}`;
    }
    return `async () => {\n${source}\n}`;
  } catch {
    return `async () => {\n${source}\n}`;
  }
}
//#endregion
export { generateTypes as n, sanitizeToolName as r, normalizeCode as t };

//# sourceMappingURL=normalize-Dy5d7PfI.js.map
