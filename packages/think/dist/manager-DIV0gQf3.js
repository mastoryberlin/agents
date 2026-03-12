import {
  i as _classPrivateFieldInitSpec,
  n as _classPrivateFieldGet2,
  r as _assertClassBrand,
  t as _classPrivateFieldSet2
} from "./classPrivateFieldSet2-COLddhya.js";
import { t as _classPrivateMethodInitSpec } from "./classPrivateMethodInitSpec-CdQXQy1O.js";
import { jsonSchema, tool } from "ai";
//#region src/extensions/manager.ts
/**
 * ExtensionManager — loads, manages, and exposes tools from extension Workers.
 *
 * Extensions are sandboxed Workers created via WorkerLoader. Each extension
 * declares tools (with JSON Schema inputs) and permissions. The manager:
 *
 * 1. Wraps extension source in a Worker module with describe/execute RPC
 * 2. Loads it via WorkerLoader with permission-gated bindings
 * 3. Discovers tools via describe() RPC call
 * 4. Exposes them as AI SDK tools via getTools()
 *
 * Extension source format — a JS object expression defining tools:
 *
 * ```js
 * ({
 *   greet: {
 *     description: "Greet someone",
 *     parameters: { name: { type: "string" } },
 *     required: ["name"],
 *     execute: async (args, host) => `Hello, ${args.name}!`
 *   }
 * })
 * ```
 *
 * The `host` parameter in execute is provided via `env.host` — a loopback
 * binding that resolves the parent agent and delegates workspace operations
 * (gated by permissions). See HostBridgeLoopback.
 */
/**
 * Sanitize a name for use as a tool name prefix.
 * Replaces any non-alphanumeric characters with underscores and
 * collapses consecutive underscores.
 */
function sanitizeName(name) {
  if (!name || name.trim().length === 0)
    throw new Error("Extension name must not be empty");
  return name
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
const STORAGE_PREFIX = "ext:";
var _loader = /* @__PURE__ */ new WeakMap();
var _storage = /* @__PURE__ */ new WeakMap();
var _createHostBinding = /* @__PURE__ */ new WeakMap();
var _extensions = /* @__PURE__ */ new WeakMap();
var _restored = /* @__PURE__ */ new WeakMap();
var _ExtensionManager_brand = /* @__PURE__ */ new WeakSet();
var ExtensionManager = class {
  constructor(options) {
    _classPrivateMethodInitSpec(this, _ExtensionManager_brand);
    _classPrivateFieldInitSpec(this, _loader, void 0);
    _classPrivateFieldInitSpec(this, _storage, void 0);
    _classPrivateFieldInitSpec(this, _createHostBinding, void 0);
    _classPrivateFieldInitSpec(this, _extensions, /* @__PURE__ */ new Map());
    _classPrivateFieldInitSpec(this, _restored, false);
    _classPrivateFieldSet2(_loader, this, options.loader);
    _classPrivateFieldSet2(_storage, this, options.storage ?? null);
    _classPrivateFieldSet2(
      _createHostBinding,
      this,
      options.createHostBinding ?? null
    );
  }
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
  async restore() {
    if (
      _classPrivateFieldGet2(_restored, this) ||
      !_classPrivateFieldGet2(_storage, this)
    )
      return;
    _classPrivateFieldSet2(_restored, this, true);
    const entries = await _classPrivateFieldGet2(_storage, this).list({
      prefix: STORAGE_PREFIX
    });
    for (const persisted of entries.values()) {
      if (
        _classPrivateFieldGet2(_extensions, this).has(persisted.manifest.name)
      )
        continue;
      await _assertClassBrand(
        _ExtensionManager_brand,
        this,
        _loadInternal
      ).call(this, persisted.manifest, persisted.source);
    }
  }
  async load(manifest, source) {
    if (_classPrivateFieldGet2(_extensions, this).has(manifest.name))
      throw new Error(
        `Extension "${manifest.name}" is already loaded. Unload it first.`
      );
    const info = await _assertClassBrand(
      _ExtensionManager_brand,
      this,
      _loadInternal
    ).call(this, manifest, source);
    if (_classPrivateFieldGet2(_storage, this))
      await _classPrivateFieldGet2(_storage, this).put(
        `${STORAGE_PREFIX}${manifest.name}`,
        {
          manifest,
          source
        }
      );
    return info;
  }
  /**
   * Unload an extension, removing its tools from the agent.
   */
  async unload(name) {
    const removed = _classPrivateFieldGet2(_extensions, this).delete(name);
    if (removed && _classPrivateFieldGet2(_storage, this))
      await _classPrivateFieldGet2(_storage, this).delete(
        `${STORAGE_PREFIX}${name}`
      );
    return removed;
  }
  /**
   * List all loaded extensions.
   */
  list() {
    return [..._classPrivateFieldGet2(_extensions, this).values()].map((ext) =>
      toExtensionInfo(ext.manifest, ext.tools)
    );
  }
  /**
   * Get AI SDK tools from all loaded extensions.
   *
   * Tool names are prefixed with the sanitized extension name to avoid
   * collisions: e.g. extension "github" with tool "create_pr" → "github_create_pr".
   */
  getTools() {
    const tools = {};
    for (const ext of _classPrivateFieldGet2(_extensions, this).values()) {
      const prefix = sanitizeName(ext.manifest.name);
      for (const descriptor of ext.tools) {
        const toolName = `${prefix}_${descriptor.name}`;
        tools[toolName] = tool({
          description: `[${ext.manifest.name}] ${descriptor.description}`,
          inputSchema: jsonSchema(descriptor.inputSchema),
          execute: async (args) => {
            if (
              !_classPrivateFieldGet2(_extensions, this).has(ext.manifest.name)
            )
              throw new Error(
                `Extension "${ext.manifest.name}" has been unloaded. Tool "${toolName}" is no longer available.`
              );
            const resultJson = await ext.entrypoint.execute(
              descriptor.name,
              JSON.stringify(args)
            );
            const parsed = JSON.parse(resultJson);
            if (parsed.error) throw new Error(parsed.error);
            return parsed.result;
          }
        });
      }
    }
    return tools;
  }
};
async function _loadInternal(manifest, source) {
  const workerModule = wrapExtensionSource(source);
  const permissions = manifest.permissions ?? {};
  const workerEnv = {};
  const wsLevel = permissions.workspace ?? "none";
  if (_classPrivateFieldGet2(_createHostBinding, this) && wsLevel !== "none")
    workerEnv.host = _classPrivateFieldGet2(_createHostBinding, this).call(
      this,
      permissions
    );
  const entrypoint = _classPrivateFieldGet2(_loader, this)
    .get(`ext-${manifest.name}-${manifest.version}-${Date.now()}`, () => ({
      compatibilityDate: "2025-06-01",
      compatibilityFlags: ["nodejs_compat"],
      mainModule: "extension.js",
      modules: { "extension.js": workerModule },
      globalOutbound: permissions.network?.length ? void 0 : null,
      ...(Object.keys(workerEnv).length > 0 ? { env: workerEnv } : {})
    }))
    .getEntrypoint();
  const descriptorsJson = await entrypoint.describe();
  const tools = JSON.parse(descriptorsJson);
  _classPrivateFieldGet2(_extensions, this).set(manifest.name, {
    manifest,
    tools,
    entrypoint
  });
  return toExtensionInfo(manifest, tools);
}
function toExtensionInfo(manifest, tools) {
  const prefix = sanitizeName(manifest.name);
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    tools: tools.map((t) => `${prefix}_${t.name}`),
    permissions: manifest.permissions ?? {}
  };
}
/**
 * Wrap an extension source (JS object expression) in a Worker module
 * that exposes describe() and execute() RPC methods.
 */
function wrapExtensionSource(source) {
  return `import { WorkerEntrypoint } from "cloudflare:workers";

const __tools = (${source});

export default class Extension extends WorkerEntrypoint {
  describe() {
    const descriptors = [];
    for (const [name, def] of Object.entries(__tools)) {
      descriptors.push({
        name,
        description: def.description || name,
        inputSchema: {
          type: "object",
          properties: def.parameters || {},
          required: def.required || []
        }
      });
    }
    return JSON.stringify(descriptors);
  }

  async execute(toolName, argsJson) {
    const def = __tools[toolName];
    if (!def || !def.execute) {
      return JSON.stringify({ error: "Unknown tool: " + toolName });
    }
    try {
      const args = JSON.parse(argsJson);
      const result = await def.execute(args, this.env.host ?? null);
      return JSON.stringify({ result });
    } catch (err) {
      return JSON.stringify({ error: err.message || String(err) });
    }
  }
}
`;
}
//#endregion
export { sanitizeName as n, ExtensionManager as t };

//# sourceMappingURL=manager-DIV0gQf3.js.map
