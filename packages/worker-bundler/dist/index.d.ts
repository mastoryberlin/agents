//#region src/types.d.ts
/**
 * Input files for the bundler
 * Keys are file paths, values are file contents
 */
type Files = Record<string, string>;
/**
 * Module format for Worker Loader binding
 */
interface Module {
  js?: string;
  cjs?: string;
  text?: string;
  data?: ArrayBuffer;
  json?: object;
}
/**
 * Output modules for Worker Loader binding
 */
type Modules = Record<string, string | Module>;
/**
 * Options for createWorker
 */
interface CreateWorkerOptions {
  /**
   * Input files - keys are paths relative to project root, values are file contents
   */
  files: Files;
  /**
   * Entry point file path (relative to project root)
   * If not specified, will try to determine from wrangler.toml main field,
   * then package.json, then default paths (src/index.ts, etc.)
   */
  entryPoint?: string;
  /**
   * Whether to bundle all dependencies into a single file
   * @default true
   */
  bundle?: boolean;
  /**
   * External modules that should not be bundled.
   * Note: `cloudflare:*` modules are always treated as external.
   */
  externals?: string[];
  /**
   * Target environment
   * @default 'es2022'
   */
  target?: string;
  /**
   * Whether to minify the output
   * @default false
   */
  minify?: boolean;
  /**
   * Generate inline source maps for better debugging and error stack traces.
   * Only applies when `bundle: true`. Has no effect in transform-only mode
   * since the output closely mirrors the input structure.
   * @default false
   */
  sourcemap?: boolean;
  /**
   * npm registry URL for fetching packages.
   * @default 'https://registry.npmjs.org'
   */
  registry?: string;
}
/**
 * Parsed wrangler configuration relevant to Worker Loader
 */
interface WranglerConfig {
  main?: string;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
}
/**
 * Result from createWorker
 */
interface CreateWorkerResult {
  /**
   * The main module entry point path
   */
  mainModule: string;
  /**
   * All modules in the bundle
   */
  modules: Modules;
  /**
   * Parsed wrangler configuration (from wrangler.toml/json/jsonc).
   */
  wranglerConfig?: WranglerConfig;
  /**
   * Any warnings generated during bundling
   */
  warnings?: string[];
}
//#endregion
//#region src/asset-handler.d.ts
/**
 * Asset request handler for serving static assets.
 *
 * Key design: the manifest (routing metadata) is separated from the
 * storage (content retrieval). This lets you plug in any backend —
 * in-memory, KV, R2, Workspace, etc.
 *
 * Inspired by Cloudflare's Workers Static Assets behavior and
 * cloudflare-asset-worker by Timo Wilhelm.
 */
/**
 * Pluggable storage backend for asset content.
 * Implement this to serve assets from KV, R2, Workspace, or any other source.
 */
interface AssetStorage {
  get(pathname: string): Promise<ReadableStream | ArrayBuffer | string | null>;
}
/**
 * Metadata for a single asset (no content — that comes from storage).
 */
interface AssetMetadata {
  contentType: string | undefined;
  etag: string;
}
/**
 * The manifest maps pathnames to metadata. Used for routing decisions,
 * ETag checks, and content-type headers — all without touching storage.
 */
type AssetManifest = Map<string, AssetMetadata>;
/**
 * Create an in-memory storage backend from a pathname->content map.
 * This is the zero-config default for small asset sets.
 */
declare function createMemoryStorage(
  assets: Record<string, string | ArrayBuffer>
): AssetStorage;
/**
 * Configuration for asset serving behavior.
 */
interface AssetConfig {
  /**
   * How to handle HTML file resolution and trailing slashes.
   * @default 'auto-trailing-slash'
   */
  html_handling?:
    | "auto-trailing-slash"
    | "force-trailing-slash"
    | "drop-trailing-slash"
    | "none";
  /**
   * How to handle requests that don't match any asset.
   * - 'single-page-application': Serve /index.html for 404s
   * - '404-page': Serve nearest 404.html walking up the directory tree
   * - 'none': Return null (fall through)
   * @default 'none'
   */
  not_found_handling?: "single-page-application" | "404-page" | "none";
  /**
   * Static redirect rules. Keys are URL pathnames (or https://host/path for cross-host).
   * Supports * glob and :placeholder tokens.
   */
  redirects?: {
    static?: Record<
      string,
      {
        status: number;
        to: string;
      }
    >;
    dynamic?: Record<
      string,
      {
        status: number;
        to: string;
      }
    >;
  };
  /**
   * Custom response headers per pathname pattern (glob syntax).
   */
  headers?: Record<
    string,
    {
      set?: Record<string, string>;
      unset?: string[];
    }
  >;
}
/**
 * Build an AssetManifest from a pathname->content mapping.
 * Only computes metadata (content types, ETags) — doesn't store content.
 */
declare function buildAssetManifest(
  assets: Record<string, string | ArrayBuffer>
): Promise<AssetManifest>;
/**
 * Convenience: build both a manifest and an in-memory storage from assets.
 */
declare function buildAssets(
  assets: Record<string, string | ArrayBuffer>
): Promise<{
  manifest: AssetManifest;
  storage: AssetStorage;
}>;
/**
 * Handle an asset request. Returns a Response if an asset matches,
 * or null if the request should fall through to the user's Worker.
 *
 * @param request - The incoming HTTP request
 * @param manifest - Asset manifest (pathname -> metadata)
 * @param storage - Storage backend for fetching content
 * @param config - Asset serving configuration
 */
declare function handleAssetRequest(
  request: Request,
  manifest: AssetManifest,
  storage: AssetStorage,
  config?: AssetConfig
): Promise<Response | null>;
//#endregion
//#region src/app.d.ts
/**
 * Options for createApp
 */
interface CreateAppOptions {
  /**
   * Input files — keys are paths relative to project root, values are file contents.
   * Should include both server and client source files.
   */
  files: Files;
  /**
   * Server entry point (the Worker fetch handler).
   * If not specified, detected from wrangler config / package.json / defaults.
   */
  server?: string;
  /**
   * Client entry point(s) to bundle for the browser.
   * These are bundled with esbuild targeting the browser.
   */
  client?: string | string[];
  /**
   * Static assets to serve as-is (pathname -> content).
   * Keys should be URL pathnames (e.g., "/favicon.ico", "/robots.txt").
   * These are NOT processed by the bundler.
   */
  assets?: Record<string, string | ArrayBuffer>;
  /**
   * Asset serving configuration.
   */
  assetConfig?: AssetConfig;
  /**
   * Whether to bundle server dependencies.
   * @default true
   */
  bundle?: boolean;
  /**
   * External modules that should not be bundled.
   */
  externals?: string[];
  /**
   * Target environment for server bundle.
   * @default 'es2022'
   */
  target?: string;
  /**
   * Whether to minify the output.
   * @default false
   */
  minify?: boolean;
  /**
   * Generate source maps.
   * @default false
   */
  sourcemap?: boolean;
  /**
   * npm registry URL for fetching packages.
   */
  registry?: string;
  /**
   * Generate a Durable Object class wrapper instead of a module worker.
   * When set, the output exports a named class that can be used with
   * ctx.facets.get() / getDurableObjectClass() for persistent storage.
   *
   * If the user's server exports a DurableObject subclass (default export),
   * the wrapper extends it. Otherwise, it wraps the fetch handler in a DO.
   *
   * Pass `true` for className "App", or an object with a custom className.
   */
  durableObject?:
    | {
        className?: string;
      }
    | boolean;
}
/**
 * Result from createApp
 */
interface CreateAppResult extends CreateWorkerResult {
  /**
   * The asset manifest for runtime request handling.
   * Contains metadata (content types, ETags) for each asset.
   */
  assetManifest: AssetManifest;
  /**
   * The asset config for runtime request handling.
   */
  assetConfig?: AssetConfig;
  /**
   * Client bundle output paths (relative to asset root).
   */
  clientBundles?: string[];
  /**
   * The Durable Object class name exported by the wrapper.
   * Only set when `durableObject` option was used.
   * Use with `worker.getDurableObjectClass(className)` and `ctx.facets.get()`.
   */
  durableObjectClassName?: string;
}
/**
 * Creates a full-stack app bundle from source files.
 *
 * This function:
 * 1. Bundles client entry point(s) for the browser (if provided)
 * 2. Collects static assets
 * 3. Bundles the server Worker
 * 4. Generates a server wrapper that serves assets and falls through to user code
 * 5. Returns everything ready for the Worker Loader
 */
declare function createApp(options: CreateAppOptions): Promise<CreateAppResult>;
//#endregion
//#region src/mime.d.ts
/**
 * MIME type inference from file extensions.
 */
/**
 * Infer MIME type from a file path.
 * Returns undefined if the type is unknown.
 */
declare function inferContentType(path: string): string | undefined;
/**
 * Whether a content type represents a text-based format
 * (used to decide text vs binary module storage).
 */
declare function isTextContentType(contentType: string): boolean;
//#endregion
//#region src/index.d.ts
/**
 * Creates a worker bundle from source files.
 *
 * This function performs:
 * 1. Entry point detection (from package.json or defaults)
 * 2. Auto-installation of npm dependencies (if package.json has dependencies)
 * 3. TypeScript/JSX transformation (via Sucrase)
 * 4. Module resolution (handling imports/exports)
 * 5. Optional bundling (combining all modules into one)
 *
 * @param options - Configuration options
 * @returns The main module path and all modules
 */
declare function createWorker(
  options: CreateWorkerOptions
): Promise<CreateWorkerResult>;
//#endregion
export {
  type AssetConfig,
  type AssetManifest,
  type AssetMetadata,
  type AssetStorage,
  type CreateAppOptions,
  type CreateAppResult,
  type CreateWorkerOptions,
  type CreateWorkerResult,
  type Files,
  type Modules,
  type WranglerConfig,
  buildAssetManifest,
  buildAssets,
  createApp,
  createMemoryStorage,
  createWorker,
  handleAssetRequest,
  inferContentType,
  isTextContentType
};
//# sourceMappingURL=index.d.ts.map
