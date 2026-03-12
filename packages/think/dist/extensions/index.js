import { r as _assertClassBrand } from "../classPrivateFieldSet2-COLddhya.js";
import { t as _classPrivateMethodInitSpec } from "../classPrivateMethodInitSpec-CdQXQy1O.js";
import { t as ExtensionManager } from "../manager-DIV0gQf3.js";
import { WorkerEntrypoint } from "cloudflare:workers";
//#region src/extensions/host-bridge.ts
/**
 * HostBridgeLoopback — a WorkerEntrypoint that provides controlled workspace
 * access to extension Workers loaded via WorkerLoader.
 *
 * This is a loopback: the extension worker's `env.host` binding points here,
 * and each method call resolves the parent agent via `ctx.exports`, then
 * delegates to the agent's workspace proxy methods (`_hostReadFile`, etc.).
 *
 * Props carry serializable identifiers (agent class name, agent ID, and
 * permissions) so the binding survives across requests and hibernation.
 *
 * Users must re-export this class from their worker entry point:
 *
 * ```typescript
 * export { HostBridgeLoopback } from "@cloudflare/think/extensions";
 * ```
 *
 * @experimental Requires the `"experimental"` compatibility flag.
 */
var _HostBridgeLoopback_brand = /* @__PURE__ */ new WeakSet();
var HostBridgeLoopback = class extends WorkerEntrypoint {
  constructor(..._args) {
    super(..._args);
    _classPrivateMethodInitSpec(this, _HostBridgeLoopback_brand);
    this._permissions = this.ctx.props.permissions;
  }
  _getAgent() {
    const { agentClassName, agentId } = this.ctx.props;
    const ns = this.ctx.exports[agentClassName];
    return ns.get(ns.idFromString(agentId));
  }
  async readFile(path) {
    _assertClassBrand(_HostBridgeLoopback_brand, this, _requirePermission).call(
      this,
      "read"
    );
    return this._getAgent()._hostReadFile(path);
  }
  async writeFile(path, content) {
    _assertClassBrand(_HostBridgeLoopback_brand, this, _requirePermission).call(
      this,
      "read-write"
    );
    return this._getAgent()._hostWriteFile(path, content);
  }
  async deleteFile(path) {
    _assertClassBrand(_HostBridgeLoopback_brand, this, _requirePermission).call(
      this,
      "read-write"
    );
    return this._getAgent()._hostDeleteFile(path);
  }
  async listFiles(dir) {
    _assertClassBrand(_HostBridgeLoopback_brand, this, _requirePermission).call(
      this,
      "read"
    );
    return this._getAgent()._hostListFiles(dir);
  }
};
function _requirePermission(level) {
  const ws = this._permissions.workspace ?? "none";
  if (ws === "none")
    throw new Error("Extension error: no workspace permission declared");
  if (level === "read-write" && ws !== "read-write")
    throw new Error(
      "Extension error: workspace write permission required, but only read granted"
    );
}
//#endregion
export { ExtensionManager, HostBridgeLoopback };

//# sourceMappingURL=index.js.map
