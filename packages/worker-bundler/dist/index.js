import * as esbuild from "esbuild-wasm/lib/browser.js";
import esbuildWasm from "./esbuild.wasm";
import { parse } from "es-module-lexer/js";
import * as resolveExports from "resolve.exports";
import { parse as parse$1 } from "smol-toml";
import * as semver from "semver";
import { transform } from "sucrase";
//#region src/resolver.ts
const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".json"
];
/**
 * Resolve a module specifier to a file path in the virtual file system.
 *
 * Handles:
 * - Relative imports (./foo, ../bar)
 * - Package imports (lodash, @scope/pkg)
 * - Package.json exports field
 * - Extension resolution (.ts, .tsx, .js, etc.)
 * - Index file resolution (foo/index.ts)
 *
 * @param specifier - The import specifier (e.g., './utils', 'lodash')
 * @param options - Resolution options
 * @returns Resolved path or external marker
 */
function resolveModule(specifier, options) {
  const {
    files,
    importer = "",
    conditions = ["import", "browser"],
    extensions = DEFAULT_EXTENSIONS
  } = options;
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const resolved = resolveRelative(specifier, importer, files, extensions);
    if (resolved)
      return {
        path: resolved,
        external: false
      };
    throw new Error(
      `Cannot resolve relative import '${specifier}' from '${importer}'`
    );
  }
  return resolvePackage(specifier, files, conditions, extensions);
}
/**
 * Resolve a relative import
 */
function resolveRelative(specifier, importer, files, extensions) {
  return resolveWithExtensions(
    joinPaths(getDirectory$1(importer), specifier),
    files,
    extensions
  );
}
/**
 * Resolve a package specifier
 */
function resolvePackage(specifier, files, conditions, extensions) {
  const { packageName, subpath } = parsePackageSpecifier(specifier);
  const packageJson = files[`node_modules/${packageName}/package.json`];
  if (!packageJson)
    return {
      path: specifier,
      external: true
    };
  let pkg;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    throw new Error(`Invalid package.json for ${packageName}`);
  }
  const entrySubpath = subpath ? `./${subpath}` : ".";
  try {
    const resolved = resolveExports.resolve(pkg, entrySubpath, { conditions });
    if (resolved && resolved.length > 0) {
      const resolvedPath = resolved[0];
      if (resolvedPath) {
        const fullPath = `node_modules/${packageName}/${normalizeRelativePath(resolvedPath)}`;
        if (fullPath in files)
          return {
            path: fullPath,
            external: false
          };
      }
    }
  } catch {}
  const legacyEntry = resolveExports.legacy(pkg, {
    fields: ["module", "main"]
  });
  if (legacyEntry && typeof legacyEntry === "string") {
    const fullPath = `node_modules/${packageName}/${normalizeRelativePath(legacyEntry)}`;
    if (fullPath in files)
      return {
        path: fullPath,
        external: false
      };
  }
  const indexPath = resolveWithExtensions(
    `node_modules/${packageName}${subpath ? `/${subpath}` : ""}`,
    files,
    extensions
  );
  if (indexPath)
    return {
      path: indexPath,
      external: false
    };
  return {
    path: specifier,
    external: true
  };
}
/**
 * Try to resolve a path with various extensions and index files
 */
function resolveWithExtensions(path, files, extensions) {
  const normalized = normalizePath(path);
  if (normalized in files) return normalized;
  for (const ext of extensions) {
    const withExt = normalized + ext;
    if (withExt in files) return withExt;
  }
  for (const ext of extensions) {
    const indexPath = `${normalized}/index${ext}`;
    if (indexPath in files) return indexPath;
  }
}
/**
 * Parse a package specifier into package name and subpath
 */
function parsePackageSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length >= 2)
      return {
        packageName: `${parts[0]}/${parts[1]}`,
        subpath: parts.slice(2).join("/") || void 0
      };
  }
  const slashIndex = specifier.indexOf("/");
  if (slashIndex === -1)
    return {
      packageName: specifier,
      subpath: void 0
    };
  return {
    packageName: specifier.slice(0, slashIndex),
    subpath: specifier.slice(slashIndex + 1)
  };
}
/**
 * Get the directory of a file path
 */
function getDirectory$1(filePath) {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return filePath.slice(0, lastSlash);
}
/**
 * Join two paths
 */
function joinPaths(base, relative) {
  if (relative.startsWith("/")) return relative.slice(1);
  const baseParts = base ? base.split("/") : [];
  const relativeParts = relative.split("/");
  for (const part of relativeParts)
    if (part === "..") baseParts.pop();
    else if (part !== ".") baseParts.push(part);
  return baseParts.join("/");
}
/**
 * Normalize a path (remove ./ prefix, handle multiple slashes)
 */
function normalizePath(path) {
  return path.replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
}
/**
 * Normalize a relative path from package.json
 */
function normalizeRelativePath(path) {
  if (path.startsWith("./")) return path.slice(2);
  if (path.startsWith("/")) return path.slice(1);
  return path;
}
/**
 * Parse imports from a JavaScript/TypeScript source file.
 *
 * Uses es-module-lexer for accurate parsing of ES module syntax.
 * Falls back to regex for JSX files since es-module-lexer doesn't
 * handle JSX syntax (e.g., `<div>` is not valid JavaScript).
 */
function parseImports(code) {
  try {
    const [imports] = parse(code);
    const specifiers = [];
    for (const imp of imports) if (imp.n !== void 0) specifiers.push(imp.n);
    return [...new Set(specifiers)];
  } catch {
    return parseImportsRegex(code);
  }
}
/**
 * Regex-based fallback for parsing imports.
 * Used when es-module-lexer fails (e.g., on JSX/TSX files).
 */
function parseImportsRegex(code) {
  const imports = [];
  for (const match of code.matchAll(
    /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g
  )) {
    const specifier = match[1];
    if (specifier) imports.push(specifier);
  }
  for (const match of code.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1];
    if (specifier) imports.push(specifier);
  }
  for (const match of code.matchAll(
    /export\s+(?:[\w*{}\s,]+\s+)?from\s+['"]([^'"]+)['"]/g
  )) {
    const specifier = match[1];
    if (specifier) imports.push(specifier);
  }
  return [...new Set(imports)];
}
//#endregion
//#region src/bundler.ts
/**
 * esbuild-wasm bundling functionality.
 */
/**
 * Bundle files using esbuild-wasm
 */
async function bundleWithEsbuild(
  files,
  entryPoint,
  externals,
  target,
  minify,
  sourcemap,
  nodejsCompat
) {
  await initializeEsbuild();
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "esm",
    platform: nodejsCompat ? "node" : "browser",
    target,
    minify,
    sourcemap: sourcemap ? "inline" : false,
    plugins: [
      {
        name: "virtual-fs",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point")
              return {
                path: args.path,
                namespace: "virtual"
              };
            if (args.path.startsWith(".")) {
              const resolved = resolveRelativePath(
                args.resolveDir,
                args.path,
                files
              );
              if (resolved)
                return {
                  path: resolved,
                  namespace: "virtual"
                };
            }
            if (!args.path.startsWith("/") && !args.path.startsWith(".")) {
              if (
                externals.includes(args.path) ||
                externals.some(
                  (e) =>
                    args.path.startsWith(`${e}/`) || args.path.startsWith(e)
                )
              )
                return {
                  path: args.path,
                  external: true
                };
              try {
                const result = resolveModule(args.path, { files });
                if (!result.external)
                  return {
                    path: result.path,
                    namespace: "virtual"
                  };
              } catch {}
              return {
                path: args.path,
                external: true
              };
            }
            const normalizedPath = args.path.startsWith("/")
              ? args.path.slice(1)
              : args.path;
            if (normalizedPath in files)
              return {
                path: normalizedPath,
                namespace: "virtual"
              };
            return {
              path: args.path,
              external: true
            };
          });
          build.onLoad(
            {
              filter: /.*/,
              namespace: "virtual"
            },
            (args) => {
              const content = files[args.path];
              if (content === void 0)
                return { errors: [{ text: `File not found: ${args.path}` }] };
              const loader = getLoader(args.path);
              const lastSlash = args.path.lastIndexOf("/");
              return {
                contents: content,
                loader,
                resolveDir: lastSlash >= 0 ? args.path.slice(0, lastSlash) : ""
              };
            }
          );
        }
      }
    ],
    outfile: "bundle.js"
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error("No output generated from esbuild");
  const modules = { "bundle.js": output.text };
  const warnings = result.warnings.map((w) => w.text);
  if (warnings.length > 0)
    return {
      mainModule: "bundle.js",
      modules,
      warnings
    };
  return {
    mainModule: "bundle.js",
    modules
  };
}
/**
 * Resolve a relative path against a directory within the virtual filesystem.
 */
function resolveRelativePath(resolveDir, relativePath, files) {
  const dir = resolveDir.replace(/^\//, "");
  const parts = dir ? dir.split("/") : [];
  const relParts = relativePath.split("/");
  for (const part of relParts)
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  const resolved = parts.join("/");
  if (resolved in files) return resolved;
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];
  for (const ext of extensions)
    if (resolved + ext in files) return resolved + ext;
  for (const ext of extensions) {
    const indexPath = `${resolved}/index${ext}`;
    if (indexPath in files) return indexPath;
  }
}
function getLoader(path) {
  if (path.endsWith(".ts") || path.endsWith(".mts")) return "ts";
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  return "js";
}
let esbuildInitialized = false;
let esbuildInitializePromise = null;
/**
 * Initialize the esbuild bundler.
 * This is called automatically when needed.
 */
async function initializeEsbuild() {
  if (esbuildInitialized) return;
  if (esbuildInitializePromise) return esbuildInitializePromise;
  esbuildInitializePromise = (async () => {
    try {
      await esbuild.initialize({
        wasmModule: esbuildWasm,
        worker: false
      });
      esbuildInitialized = true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Cannot call "initialize" more than once')
      ) {
        esbuildInitialized = true;
        return;
      }
      throw error;
    }
  })();
  try {
    await esbuildInitializePromise;
  } catch (error) {
    esbuildInitializePromise = null;
    throw error;
  }
}
//#endregion
//#region src/config.ts
/**
 * Wrangler configuration parsing.
 *
 * Parses wrangler.toml, wrangler.json, and wrangler.jsonc files
 * to extract compatibility settings.
 */
/**
 * Parse wrangler configuration from files.
 *
 * Looks for wrangler.toml, wrangler.json, or wrangler.jsonc in the files
 * and extracts compatibility_date and compatibility_flags.
 *
 * @param files - Virtual file system
 * @returns Parsed wrangler config, or undefined if no config file found
 */
function parseWranglerConfig(files) {
  const tomlContent = files["wrangler.toml"];
  if (tomlContent) return parseWranglerToml(tomlContent);
  const jsonContent = files["wrangler.json"];
  if (jsonContent) return parseWranglerJson(jsonContent);
  const jsoncContent = files["wrangler.jsonc"];
  if (jsoncContent) return parseWranglerJsonc(jsoncContent);
}
/**
 * Parse wrangler.toml content
 */
function parseWranglerToml(content) {
  try {
    return extractWranglerConfig(parse$1(content));
  } catch {
    return {};
  }
}
/**
 * Parse wrangler.json content
 */
function parseWranglerJson(content) {
  try {
    return extractWranglerConfig(JSON.parse(content));
  } catch {
    return {};
  }
}
/**
 * Parse wrangler.jsonc content (JSON with comments)
 */
function parseWranglerJsonc(content) {
  try {
    const jsonContent = stripJsonComments(content);
    return extractWranglerConfig(JSON.parse(jsonContent));
  } catch {
    return {};
  }
}
/**
 * Extract wrangler config fields from parsed config object.
 * Handles both snake_case (toml) and camelCase (json) formats.
 */
function extractWranglerConfig(config) {
  const result = {};
  const main = config["main"];
  if (typeof main === "string") result.main = main;
  const date = config["compatibility_date"] ?? config["compatibilityDate"];
  if (typeof date === "string") result.compatibilityDate = date;
  const flags = config["compatibility_flags"] ?? config["compatibilityFlags"];
  if (Array.isArray(flags) && flags.every((f) => typeof f === "string"))
    result.compatibilityFlags = flags;
  return result;
}
/**
 * Strip comments from JSONC content.
 * Handles both single-line (//) and multi-line comments.
 */
function stripJsonComments(content) {
  let result = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];
    if (
      (char === '"' || char === "'") &&
      (i === 0 || content[i - 1] !== "\\")
    ) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) inString = false;
      result += char;
      i++;
      continue;
    }
    if (inString) {
      result += char;
      i++;
      continue;
    }
    if (char === "/" && nextChar === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      i += 2;
      while (
        i < content.length - 1 &&
        !(content[i] === "*" && content[i + 1] === "/")
      )
        i++;
      i += 2;
      continue;
    }
    result += char;
    i++;
  }
  return result;
}
/**
 * Check if nodejs_compat flag is enabled in the config.
 */
function hasNodejsCompat(config) {
  return config?.compatibilityFlags?.includes("nodejs_compat") ?? false;
}
//#endregion
//#region src/installer.ts
/**
 * NPM package installer for virtual file systems.
 *
 * This module fetches packages from the npm registry and populates
 * a virtual node_modules directory structure.
 */
const NPM_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 3e4;
/**
 * Fetch with a timeout.
 * Throws an error if the request takes longer than the specified timeout.
 */
async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
/**
 * Install npm dependencies into a virtual file system.
 *
 * Reads the package.json from the files, resolves all dependencies,
 * and populates node_modules with the package contents.
 *
 * @param files - Virtual file system containing package.json
 * @param options - Installation options
 * @returns Files with node_modules populated
 */
async function installDependencies(files, options = {}) {
  const { dev = false, registry = NPM_REGISTRY } = options;
  const result = {
    files: { ...files },
    installed: [],
    warnings: []
  };
  const packageJsonContent = files["package.json"];
  if (!packageJsonContent) return result;
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonContent);
  } catch {
    result.warnings.push("Failed to parse package.json");
    return result;
  }
  const depsToInstall = {
    ...packageJson.dependencies,
    ...(dev ? packageJson.devDependencies : {})
  };
  if (Object.keys(depsToInstall).length === 0) return result;
  const installedPackages = /* @__PURE__ */ new Map();
  const inProgress = /* @__PURE__ */ new Map();
  await Promise.all(
    Object.entries(depsToInstall).map(([name, versionRange]) =>
      installPackage(
        name,
        versionRange,
        result,
        installedPackages,
        inProgress,
        registry
      )
    )
  );
  return result;
}
/**
 * Install a single package and its dependencies recursively.
 */
async function installPackage(
  name,
  versionRange,
  result,
  installedPackages,
  inProgress,
  registry
) {
  if (installedPackages.has(name)) return;
  const existing = inProgress.get(name);
  if (existing) return existing;
  const installPromise = (async () => {
    try {
      const metadata = await fetchPackageMetadata(name, registry);
      const version = resolveVersion(versionRange, metadata);
      if (!version) {
        result.warnings.push(
          `Could not resolve version for ${name}@${versionRange}`
        );
        return;
      }
      const versionMetadata = metadata.versions[version];
      if (!versionMetadata) {
        result.warnings.push(`Version ${version} not found for ${name}`);
        return;
      }
      installedPackages.set(name, version);
      result.installed.push(`${name}@${version}`);
      const packageFiles = await fetchPackageFiles(name, versionMetadata);
      for (const [filePath, content] of Object.entries(packageFiles))
        result.files[`node_modules/${name}/${filePath}`] = content;
      const deps = versionMetadata.dependencies ?? {};
      await Promise.all(
        Object.entries(deps).map(([depName, depVersion]) =>
          installPackage(
            depName,
            depVersion,
            result,
            installedPackages,
            inProgress,
            registry
          )
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push(`Failed to install ${name}: ${message}`);
    }
  })();
  inProgress.set(name, installPromise);
  try {
    await installPromise;
  } finally {
    inProgress.delete(name);
  }
}
/**
 * Fetch package metadata from npm registry.
 */
async function fetchPackageMetadata(name, registry) {
  const response = await fetchWithTimeout(
    `${registry}/${name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : name}`,
    {
      headers: {
        Accept:
          "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8"
      }
    }
  );
  if (!response.ok)
    throw new Error(`Failed to fetch package metadata: ${response.status}`);
  return await response.json();
}
/**
 * Resolve a semver range to a specific version.
 */
function resolveVersion(range, metadata) {
  if (range === "latest" || range === "*")
    return metadata["dist-tags"]["latest"];
  if (metadata.versions[range]) return range;
  if (metadata["dist-tags"][range]) return metadata["dist-tags"][range];
  const versions = Object.keys(metadata.versions);
  return semver.maxSatisfying(versions, range) ?? void 0;
}
/**
 * Fetch and extract package files from npm tarball.
 */
async function fetchPackageFiles(name, metadata) {
  const tarballUrl = metadata.dist?.tarball;
  if (!tarballUrl) throw new Error(`No tarball URL for ${name}`);
  const response = await fetchWithTimeout(
    tarballUrl,
    {},
    DEFAULT_TIMEOUT_MS * 2
  );
  if (!response.ok)
    throw new Error(`Failed to fetch tarball: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return extractTarball(new Uint8Array(buffer));
}
/**
 * Extract files from a gzipped tarball.
 *
 * npm packages are distributed as .tgz files (gzipped tar).
 * The contents are in a "package/" directory.
 */
async function extractTarball(data) {
  return parseTar(await decompress(data));
}
/**
 * Decompress gzip data using DecompressionStream.
 */
async function decompress(data) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});
  const chunks = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
/**
 * Parse a tar archive and extract text files.
 *
 * TAR format:
 * - 512-byte header blocks
 * - File content (padded to 512 bytes)
 * - Two empty blocks at the end
 */
function parseTar(data) {
  const files = {};
  const textDecoder = new TextDecoder();
  let offset = 0;
  while (offset < data.length - 512) {
    const header = data.slice(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = readString(header, 0, 100);
    const sizeStr = readString(header, 124, 12);
    const typeFlag = header[156];
    const size = parseInt(sizeStr.trim(), 8) || 0;
    offset += 512;
    if ((typeFlag === 48 || typeFlag === 0) && size > 0) {
      const content = data.slice(offset, offset + size);
      let filePath = name;
      if (filePath.startsWith("package/")) filePath = filePath.slice(8);
      if (isTextFile(filePath))
        try {
          files[filePath] = textDecoder.decode(content);
        } catch {}
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}
/**
 * Read a null-terminated string from a buffer.
 */
function readString(buffer, offset, length) {
  const bytes = buffer.slice(offset, offset + length);
  const nullIndex = bytes.indexOf(0);
  const relevantBytes = nullIndex >= 0 ? bytes.slice(0, nullIndex) : bytes;
  return new TextDecoder().decode(relevantBytes);
}
/**
 * Check if a file path is likely a text file.
 */
function isTextFile(path) {
  const textExtensions = [
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".mts",
    ".cts",
    ".tsx",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".css",
    ".html",
    ".yml",
    ".yaml",
    ".toml",
    ".xml",
    ".svg",
    ".map",
    ".d.ts",
    ".d.mts",
    ".d.cts"
  ];
  const configFiles = [
    "LICENSE",
    "README",
    "CHANGELOG",
    "package.json",
    "tsconfig.json",
    ".npmignore",
    ".gitignore"
  ];
  const fileName = path.split("/").pop() ?? "";
  if (
    configFiles.some((f) => fileName.toUpperCase().startsWith(f.toUpperCase()))
  )
    return true;
  return textExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}
/**
 * Check if files contain a package.json with dependencies that need installing.
 */
function hasDependencies(files) {
  const packageJson = files["package.json"];
  if (!packageJson) return false;
  try {
    const deps = JSON.parse(packageJson).dependencies ?? {};
    return Object.keys(deps).length > 0;
  } catch {
    return false;
  }
}
//#endregion
//#region src/transformer.ts
/**
 * Transform TypeScript/JSX code to JavaScript using Sucrase.
 *
 * Sucrase is a super-fast TypeScript transformer that:
 * - Strips type annotations
 * - Transforms JSX
 * - Is ~20x faster than Babel
 * - Works in any JS environment (no WASM needed)
 *
 * @param code - Source code to transform
 * @param options - Transform options
 * @returns Transformed code
 */
function transformCode(code, options) {
  const {
    filePath,
    sourceMap = false,
    jsxRuntime = "automatic",
    jsxImportSource = "react",
    production = false
  } = options;
  const transforms = [];
  if (isTypeScriptFile(filePath)) transforms.push("typescript");
  if (isJsxFile(filePath)) {
    if (jsxRuntime !== "preserve") transforms.push("jsx");
  }
  if (transforms.length === 0) return { code };
  const transformOptions = {
    transforms,
    filePath,
    jsxRuntime,
    jsxImportSource,
    production,
    preserveDynamicImport: true,
    disableESTransforms: true
  };
  if (sourceMap)
    transformOptions.sourceMapOptions = {
      compiledFilename: filePath.replace(/\.(tsx?|mts)$/, ".js")
    };
  const result = transform(code, transformOptions);
  if (result.sourceMap)
    return {
      code: result.code,
      sourceMap: JSON.stringify(result.sourceMap)
    };
  return { code: result.code };
}
/**
 * Check if a file path is a TypeScript file
 */
function isTypeScriptFile(filePath) {
  return /\.(ts|tsx|mts)$/.test(filePath);
}
/**
 * Check if a file path is a JSX file
 */
function isJsxFile(filePath) {
  return /\.(jsx|tsx)$/.test(filePath);
}
/**
 * Check if a file path is any JavaScript/TypeScript file
 */
function isJavaScriptFile(filePath) {
  return /\.(js|jsx|ts|tsx|mjs|mts)$/.test(filePath);
}
/**
 * Get the output path for a transformed file
 */
function getOutputPath(filePath) {
  return filePath.replace(/\.tsx?$/, ".js").replace(/\.mts$/, ".mjs");
}
/**
 * Transform all files and resolve their dependencies.
 * This produces multiple modules instead of a single bundle.
 */
async function transformAndResolve(files, entryPoint, externals) {
  const modules = {};
  const warnings = [];
  const processed = /* @__PURE__ */ new Set();
  const toProcess = [entryPoint];
  const pathMap = /* @__PURE__ */ new Map();
  while (toProcess.length > 0) {
    const filePath = toProcess.pop();
    if (!filePath || processed.has(filePath)) continue;
    processed.add(filePath);
    const content = files[filePath];
    if (content === void 0) {
      warnings.push(`File not found: ${filePath}`);
      continue;
    }
    const outputPath = isTypeScriptFile(filePath)
      ? getOutputPath(filePath)
      : filePath;
    pathMap.set(filePath, outputPath);
    if (!isJavaScriptFile(filePath)) {
      if (filePath.endsWith(".json"))
        try {
          modules[filePath] = { json: JSON.parse(content) };
        } catch {
          warnings.push(`Failed to parse JSON file: ${filePath}`);
        }
      else modules[filePath] = { text: content };
      continue;
    }
    const imports = parseImports(content);
    for (const specifier of imports) {
      if (
        externals.includes(specifier) ||
        externals.some(
          (e) => specifier.startsWith(`${e}/`) || specifier.startsWith(e)
        )
      )
        continue;
      try {
        const resolved = resolveModule(specifier, {
          files,
          importer: filePath
        });
        if (!resolved.external && !processed.has(resolved.path))
          toProcess.push(resolved.path);
      } catch (error) {
        warnings.push(
          `Failed to resolve '${specifier}' from ${filePath}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }
  for (const [sourcePath, outputPath] of pathMap) {
    const content = files[sourcePath];
    if (content === void 0 || !isJavaScriptFile(sourcePath)) continue;
    let transformedCode;
    if (isTypeScriptFile(sourcePath))
      try {
        transformedCode = transformCode(content, { filePath: sourcePath }).code;
      } catch (error) {
        warnings.push(
          `Failed to transform ${sourcePath}: ${error instanceof Error ? error.message : error}`
        );
        continue;
      }
    else transformedCode = content;
    transformedCode = rewriteImports(
      transformedCode,
      sourcePath,
      files,
      pathMap,
      externals
    );
    modules[outputPath] = transformedCode;
  }
  const mainModule = isTypeScriptFile(entryPoint)
    ? getOutputPath(entryPoint)
    : entryPoint;
  if (warnings.length > 0)
    return {
      mainModule,
      modules,
      warnings
    };
  return {
    mainModule,
    modules
  };
}
/**
 * Rewrite import specifiers to use full output paths.
 * This is necessary because the Worker Loader expects imports to match registered module names.
 */
function rewriteImports(code, importer, files, pathMap, externals) {
  const importExportRegex =
    /(import\s+(?:[\w*{}\s,]+\s+from\s+)?|export\s+(?:[\w*{}\s,]+\s+)?from\s+)(['"])([^'"]+)\2/g;
  const importerOutputPath = pathMap.get(importer) ?? importer;
  return code.replace(importExportRegex, (match, prefix, quote, specifier) => {
    if (
      externals.includes(specifier) ||
      externals.some(
        (e) => specifier.startsWith(`${e}/`) || specifier.startsWith(e)
      )
    )
      return match;
    if (!specifier.startsWith(".") && !specifier.startsWith("/"))
      try {
        const resolved = resolveModule(specifier, {
          files,
          importer
        });
        if (resolved.external) return match;
        const resolvedOutputPath = pathMap.get(resolved.path) ?? resolved.path;
        if (resolved.path.startsWith("node_modules/"))
          return `${prefix}${quote}/${resolvedOutputPath}${quote}`;
        return `${prefix}${quote}${calculateRelativePath(importerOutputPath, resolvedOutputPath)}${quote}`;
      } catch {
        return match;
      }
    try {
      const resolved = resolveModule(specifier, {
        files,
        importer
      });
      if (resolved.external) return match;
      return `${prefix}${quote}${calculateRelativePath(importerOutputPath, pathMap.get(resolved.path) ?? resolved.path)}${quote}`;
    } catch {
      return match;
    }
  });
}
/**
 * Calculate relative path from one file to another.
 */
function calculateRelativePath(from, to) {
  const fromDir = getDirectory(from);
  const toDir = getDirectory(to);
  const toFile = to.split("/").pop() ?? to;
  if (fromDir === toDir) return `./${toFile}`;
  const fromParts = fromDir ? fromDir.split("/") : [];
  const toParts = toDir ? toDir.split("/") : [];
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  )
    commonLength++;
  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);
  let relativePath = "";
  if (upCount === 0) relativePath = "./";
  else relativePath = "../".repeat(upCount);
  if (downParts.length > 0) relativePath += `${downParts.join("/")}/`;
  return relativePath + toFile;
}
function getDirectory(filePath) {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return filePath.slice(0, lastSlash);
}
//#endregion
//#region src/utils.ts
/**
 * Detect entry point from wrangler config, package.json, or use defaults.
 * Priority: wrangler main > package.json exports/module/main > default paths
 */
function detectEntryPoint(files, wranglerConfig) {
  if (wranglerConfig?.main) return normalizeEntryPath(wranglerConfig.main);
  const packageJsonContent = files["package.json"];
  if (packageJsonContent)
    try {
      const pkg = JSON.parse(packageJsonContent);
      if (pkg.exports) {
        if (typeof pkg.exports === "string")
          return normalizeEntryPath(pkg.exports);
        const dotExport = pkg.exports["."];
        if (dotExport) {
          if (typeof dotExport === "string")
            return normalizeEntryPath(dotExport);
          if (typeof dotExport === "object" && dotExport !== null) {
            const exp = dotExport;
            const entry = exp["import"] ?? exp["default"] ?? exp["module"];
            if (typeof entry === "string") return normalizeEntryPath(entry);
          }
        }
      }
      if (pkg.module) return normalizeEntryPath(pkg.module);
      if (pkg.main) return normalizeEntryPath(pkg.main);
    } catch {}
  for (const entry of [
    "src/index.ts",
    "src/index.js",
    "src/index.mts",
    "src/index.mjs",
    "index.ts",
    "index.js",
    "src/worker.ts",
    "src/worker.js"
  ])
    if (entry in files) return entry;
}
function normalizeEntryPath(path) {
  if (path.startsWith("./")) return path.slice(2);
  return path;
}
//#endregion
//#region src/experimental.ts
let warningShown = false;
function showExperimentalWarning(fn) {
  if (!warningShown) {
    warningShown = true;
    console.warn(
      `[worker-bundler] ${fn}(): This package is experimental and its API may change without notice.`
    );
  }
}
//#endregion
//#region src/mime.ts
/**
 * MIME type inference from file extensions.
 */
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json"
};
/**
 * Get the file extension from a path (including the dot).
 */
function getExtension(path) {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  if (lastDot < path.lastIndexOf("/")) return "";
  return path.slice(lastDot).toLowerCase();
}
/**
 * Infer MIME type from a file path.
 * Returns undefined if the type is unknown.
 */
function inferContentType(path) {
  return MIME_TYPES[getExtension(path)];
}
/**
 * Whether a content type represents a text-based format
 * (used to decide text vs binary module storage).
 */
function isTextContentType(contentType) {
  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("svg")
  );
}
//#endregion
//#region src/asset-handler.ts
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
 * Create an in-memory storage backend from a pathname->content map.
 * This is the zero-config default for small asset sets.
 */
function createMemoryStorage(assets) {
  const map = new Map(Object.entries(assets));
  return {
    get(pathname) {
      return Promise.resolve(map.get(pathname) ?? null);
    }
  };
}
/**
 * Normalize user config with defaults.
 */
function normalizeConfig(config) {
  const staticRedirects = {};
  if (config?.redirects?.static) {
    let lineNumber = 1;
    for (const [path, rule] of Object.entries(config.redirects.static))
      staticRedirects[path] = {
        ...rule,
        lineNumber: lineNumber++
      };
  }
  return {
    html_handling: config?.html_handling ?? "auto-trailing-slash",
    not_found_handling: config?.not_found_handling ?? "none",
    redirects: {
      static: staticRedirects,
      dynamic: config?.redirects?.dynamic ?? {}
    },
    headers: config?.headers ?? {}
  };
}
/**
 * Compute a simple hash for ETag generation.
 * Uses a fast string hash (FNV-1a) for text, or SHA-256 for binary.
 */
async function computeETag(content) {
  if (typeof content === "string") {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", content);
  return [...new Uint8Array(hashBuffer).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/**
 * Build an AssetManifest from a pathname->content mapping.
 * Only computes metadata (content types, ETags) — doesn't store content.
 */
async function buildAssetManifest(assets) {
  const manifest = /* @__PURE__ */ new Map();
  const entries = Object.entries(assets);
  await Promise.all(
    entries.map(async ([pathname, content]) => {
      const contentType = inferContentType(pathname);
      const etag = await computeETag(content);
      manifest.set(pathname, {
        contentType,
        etag
      });
    })
  );
  return manifest;
}
/**
 * Convenience: build both a manifest and an in-memory storage from assets.
 */
async function buildAssets(assets) {
  return {
    manifest: await buildAssetManifest(assets),
    storage: createMemoryStorage(assets)
  };
}
/**
 * Check if a pathname exists in the manifest.
 */
function exists(manifest, pathname) {
  return manifest.get(pathname);
}
const ESCAPE_REGEX_CHARACTERS = /[-/\\^$*+?.()|[\]{}]/g;
const escapeRegex = (s) =>
  s.replaceAll(ESCAPE_REGEX_CHARACTERS, String.raw`\$&`);
const PLACEHOLDER_REGEX = /:([A-Za-z]\w*)/g;
function replacer(str, replacements) {
  for (const [key, value] of Object.entries(replacements))
    str = str.replaceAll(`:${key}`, value);
  return str;
}
function generateRuleRegExp(rule) {
  rule = rule
    .split("*")
    .map((s) => escapeRegex(s))
    .join("(?<splat>.*)");
  const matches = rule.matchAll(PLACEHOLDER_REGEX);
  for (const match of matches)
    rule = rule.split(match[0]).join(`(?<${match[1]}>[^/]+)`);
  return new RegExp("^" + rule + "$");
}
function matchStaticRedirects(config, host, pathname) {
  const withHost = config.redirects.static[`https://${host}${pathname}`];
  const withoutHost = config.redirects.static[pathname];
  if (withHost && withoutHost)
    return withHost.lineNumber < withoutHost.lineNumber
      ? withHost
      : withoutHost;
  return withHost || withoutHost;
}
function matchDynamicRedirects(config, request) {
  const { pathname } = new URL(request.url);
  for (const [pattern, rule] of Object.entries(config.redirects.dynamic))
    try {
      const result = generateRuleRegExp(pattern).exec(pathname);
      if (result) {
        const target = replacer(rule.to, result.groups || {}).trim();
        return {
          status: rule.status,
          to: target
        };
      }
    } catch {}
}
function handleRedirects(request, config) {
  const url = new URL(request.url);
  const { search, host } = url;
  let { pathname } = url;
  const staticMatch = matchStaticRedirects(config, host, pathname);
  const dynamicMatch = staticMatch
    ? void 0
    : matchDynamicRedirects(config, request);
  const match = staticMatch ?? dynamicMatch;
  let proxied = false;
  if (match)
    if (match.status === 200) {
      pathname = new URL(match.to, request.url).pathname;
      proxied = true;
    } else {
      const destination = new URL(match.to, request.url);
      const location =
        destination.origin === url.origin
          ? `${destination.pathname}${destination.search || search}${destination.hash}`
          : `${destination.href}`;
      return new Response(null, {
        status: match.status,
        headers: { Location: location }
      });
    }
  return {
    proxied,
    pathname
  };
}
function generateGlobRegExp(pattern) {
  const escaped = pattern
    .split("*")
    .map((s) => escapeRegex(s))
    .join(".*");
  return new RegExp("^" + escaped + "$");
}
function attachCustomHeaders(request, response, config) {
  if (Object.keys(config.headers).length === 0) return response;
  const { pathname } = new URL(request.url);
  const setMap = /* @__PURE__ */ new Set();
  for (const [pattern, rules] of Object.entries(config.headers)) {
    try {
      if (!generateGlobRegExp(pattern).test(pathname)) continue;
    } catch {
      continue;
    }
    if (rules.unset)
      for (const key of rules.unset) response.headers.delete(key);
    if (rules.set)
      for (const [key, value] of Object.entries(rules.set))
        if (setMap.has(key.toLowerCase())) response.headers.append(key, value);
        else {
          response.headers.set(key, value);
          setMap.add(key.toLowerCase());
        }
  }
  return response;
}
function decodePath(pathname) {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/")
    .replaceAll(/\/+/g, "/");
}
function encodePath(pathname) {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return encodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}
function getIntent(
  pathname,
  manifest,
  config,
  skipRedirects = false,
  acceptsHtml = true
) {
  switch (config.html_handling) {
    case "auto-trailing-slash":
      return htmlAutoTrailingSlash(
        pathname,
        manifest,
        config,
        skipRedirects,
        acceptsHtml
      );
    case "force-trailing-slash":
      return htmlForceTrailingSlash(
        pathname,
        manifest,
        config,
        skipRedirects,
        acceptsHtml
      );
    case "drop-trailing-slash":
      return htmlDropTrailingSlash(
        pathname,
        manifest,
        config,
        skipRedirects,
        acceptsHtml
      );
    case "none":
      return htmlNone(pathname, manifest, config, acceptsHtml);
  }
}
function assetIntent(pathname, meta, status = 200) {
  return {
    type: "asset",
    pathname,
    meta,
    status
  };
}
function redirectIntent(to) {
  return {
    type: "redirect",
    to
  };
}
/**
 * Safe redirect: only redirect if the file exists and the destination
 * itself resolves to the same asset (avoids redirect loops).
 */
function safeRedirect(file, destination, manifest, config, skip) {
  if (skip) return void 0;
  if (!exists(manifest, destination)) {
    const intent = getIntent(destination, manifest, config, true);
    if (
      intent?.type === "asset" &&
      intent.meta.etag === exists(manifest, file)?.etag
    )
      return redirectIntent(destination);
  }
}
function htmlAutoTrailingSlash(
  pathname,
  manifest,
  config,
  skipRedirects,
  acceptsHtml
) {
  let meta;
  let redirect;
  const exactMeta = exists(manifest, pathname);
  if (pathname.endsWith("/index")) {
    if (exactMeta) return assetIntent(pathname, exactMeta);
    if (
      (redirect = safeRedirect(
        `${pathname}.html`,
        pathname.slice(0, -5),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -6)}.html`,
        pathname.slice(0, -6),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  } else if (pathname.endsWith("/index.html")) {
    if (
      (redirect = safeRedirect(
        pathname,
        pathname.slice(0, -10),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -11)}.html`,
        pathname.slice(0, -11),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  } else if (pathname.endsWith("/")) {
    const indexPath = `${pathname}index.html`;
    if ((meta = exists(manifest, indexPath)))
      return assetIntent(indexPath, meta);
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -1)}.html`,
        pathname.slice(0, -1),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  } else if (pathname.endsWith(".html")) {
    if (
      (redirect = safeRedirect(
        pathname,
        pathname.slice(0, -5),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -5)}/index.html`,
        `${pathname.slice(0, -5)}/`,
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  }
  if (exactMeta) return assetIntent(pathname, exactMeta);
  const htmlPath = `${pathname}.html`;
  if ((meta = exists(manifest, htmlPath))) return assetIntent(htmlPath, meta);
  if (
    (redirect = safeRedirect(
      `${pathname}/index.html`,
      `${pathname}/`,
      manifest,
      config,
      skipRedirects
    ))
  )
    return redirect;
  return notFound(pathname, manifest, config, acceptsHtml);
}
function htmlForceTrailingSlash(
  pathname,
  manifest,
  config,
  skipRedirects,
  acceptsHtml
) {
  let meta;
  let redirect;
  const exactMeta = exists(manifest, pathname);
  if (pathname.endsWith("/index")) {
    if (exactMeta) return assetIntent(pathname, exactMeta);
    if (
      (redirect = safeRedirect(
        `${pathname}.html`,
        pathname.slice(0, -5),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -6)}.html`,
        pathname.slice(0, -5),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  } else if (pathname.endsWith("/index.html")) {
    if (
      (redirect = safeRedirect(
        pathname,
        pathname.slice(0, -10),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -11)}.html`,
        pathname.slice(0, -10),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  } else if (pathname.endsWith("/")) {
    let p = `${pathname}index.html`;
    if ((meta = exists(manifest, p))) return assetIntent(p, meta);
    p = `${pathname.slice(0, -1)}.html`;
    if ((meta = exists(manifest, p))) return assetIntent(p, meta);
  } else if (pathname.endsWith(".html")) {
    if (
      (redirect = safeRedirect(
        pathname,
        `${pathname.slice(0, -5)}/`,
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
    if (exactMeta) return assetIntent(pathname, exactMeta);
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -5)}/index.html`,
        `${pathname.slice(0, -5)}/`,
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  }
  if (exactMeta) return assetIntent(pathname, exactMeta);
  if (
    (redirect = safeRedirect(
      `${pathname}.html`,
      `${pathname}/`,
      manifest,
      config,
      skipRedirects
    ))
  )
    return redirect;
  if (
    (redirect = safeRedirect(
      `${pathname}/index.html`,
      `${pathname}/`,
      manifest,
      config,
      skipRedirects
    ))
  )
    return redirect;
  return notFound(pathname, manifest, config, acceptsHtml);
}
function htmlDropTrailingSlash(
  pathname,
  manifest,
  config,
  skipRedirects,
  acceptsHtml
) {
  let meta;
  let redirect;
  const exactMeta = exists(manifest, pathname);
  if (pathname.endsWith("/index")) {
    if (exactMeta) return assetIntent(pathname, exactMeta);
    if (pathname === "/index") {
      if (
        (redirect = safeRedirect(
          "/index.html",
          "/",
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
    } else {
      if (
        (redirect = safeRedirect(
          `${pathname.slice(0, -6)}.html`,
          pathname.slice(0, -6),
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
      if (
        (redirect = safeRedirect(
          `${pathname}.html`,
          pathname.slice(0, -6),
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
    }
  } else if (pathname.endsWith("/index.html"))
    if (pathname === "/index.html") {
      if (
        (redirect = safeRedirect(
          "/index.html",
          "/",
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
    } else {
      if (
        (redirect = safeRedirect(
          pathname,
          pathname.slice(0, -11),
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
      if (exactMeta) return assetIntent(pathname, exactMeta);
      if (
        (redirect = safeRedirect(
          `${pathname.slice(0, -11)}.html`,
          pathname.slice(0, -11),
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
    }
  else if (pathname.endsWith("/"))
    if (pathname === "/") {
      if ((meta = exists(manifest, "/index.html")))
        return assetIntent("/index.html", meta);
    } else {
      if (
        (redirect = safeRedirect(
          `${pathname.slice(0, -1)}.html`,
          pathname.slice(0, -1),
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
      if (
        (redirect = safeRedirect(
          `${pathname.slice(0, -1)}/index.html`,
          pathname.slice(0, -1),
          manifest,
          config,
          skipRedirects
        ))
      )
        return redirect;
    }
  else if (pathname.endsWith(".html")) {
    if (
      (redirect = safeRedirect(
        pathname,
        pathname.slice(0, -5),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
    if (
      (redirect = safeRedirect(
        `${pathname.slice(0, -5)}/index.html`,
        pathname.slice(0, -5),
        manifest,
        config,
        skipRedirects
      ))
    )
      return redirect;
  }
  if (exactMeta) return assetIntent(pathname, exactMeta);
  let p = `${pathname}.html`;
  if ((meta = exists(manifest, p))) return assetIntent(p, meta);
  p = `${pathname}/index.html`;
  if ((meta = exists(manifest, p))) return assetIntent(p, meta);
  return notFound(pathname, manifest, config, acceptsHtml);
}
function htmlNone(pathname, manifest, config, acceptsHtml) {
  const meta = exists(manifest, pathname);
  return meta
    ? assetIntent(pathname, meta)
    : notFound(pathname, manifest, config, acceptsHtml);
}
function notFound(pathname, manifest, config, acceptsHtml = true) {
  switch (config.not_found_handling) {
    case "single-page-application": {
      if (!acceptsHtml) return void 0;
      const meta = exists(manifest, "/index.html");
      if (meta) return assetIntent("/index.html", meta, 200);
      return;
    }
    case "404-page": {
      let cwd = pathname;
      while (cwd) {
        cwd = cwd.slice(0, cwd.lastIndexOf("/"));
        const p = `${cwd}/404.html`;
        const meta = exists(manifest, p);
        if (meta) return assetIntent(p, meta, 404);
      }
      return;
    }
    default:
      return;
  }
}
const CACHE_CONTROL_REVALIDATE = "public, max-age=0, must-revalidate";
const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";
function getCacheControl(pathname) {
  if (/\.[a-f0-9]{8,}\.\w+$/.test(pathname)) return CACHE_CONTROL_IMMUTABLE;
  return CACHE_CONTROL_REVALIDATE;
}
/**
 * Handle an asset request. Returns a Response if an asset matches,
 * or null if the request should fall through to the user's Worker.
 *
 * @param request - The incoming HTTP request
 * @param manifest - Asset manifest (pathname -> metadata)
 * @param storage - Storage backend for fetching content
 * @param config - Asset serving configuration
 */
async function handleAssetRequest(request, manifest, storage, config) {
  const normalized = normalizeConfig(config);
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD"].includes(method)) return null;
  const redirectResult = handleRedirects(request, normalized);
  if (redirectResult instanceof Response)
    return attachCustomHeaders(request, redirectResult, normalized);
  const { pathname } = redirectResult;
  const decodedPathname = decodePath(pathname);
  const intent = getIntent(
    decodedPathname,
    manifest,
    normalized,
    false,
    (request.headers.get("Accept") || "").includes("text/html")
  );
  if (!intent) return null;
  if (intent.type === "redirect") {
    const url = new URL(request.url);
    const encodedDest = encodePath(intent.to);
    return attachCustomHeaders(
      request,
      new Response(null, {
        status: 307,
        headers: { Location: encodedDest + url.search }
      }),
      normalized
    );
  }
  const encodedPathname = encodePath(decodedPathname);
  if (encodedPathname !== pathname) {
    const url = new URL(request.url);
    return attachCustomHeaders(
      request,
      new Response(null, {
        status: 307,
        headers: { Location: encodedPathname + url.search }
      }),
      normalized
    );
  }
  const { pathname: assetPath, meta, status } = intent;
  const strongETag = `"${meta.etag}"`;
  const weakETag = `W/${strongETag}`;
  const ifNoneMatch = request.headers.get("If-None-Match") || "";
  const eTags = new Set(ifNoneMatch.split(",").map((t) => t.trim()));
  const headers = new Headers();
  headers.set("ETag", strongETag);
  if (meta.contentType) headers.set("Content-Type", meta.contentType);
  headers.set("Cache-Control", getCacheControl(decodedPathname));
  if (eTags.has(weakETag) || eTags.has(strongETag))
    return attachCustomHeaders(
      request,
      new Response(null, {
        status: 304,
        headers
      }),
      normalized
    );
  let body = null;
  if (method !== "HEAD") body = await storage.get(assetPath);
  return attachCustomHeaders(
    request,
    new Response(body, {
      status,
      headers
    }),
    normalized
  );
}
//#endregion
//#region src/_asset-runtime-code.ts
const ASSET_RUNTIME_CODE =
  'var L={".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".mjs":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".svg":"image/svg+xml",".ico":"image/x-icon",".webp":"image/webp",".avif":"image/avif",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf",".eot":"application/vnd.ms-fontobject",".mp3":"audio/mpeg",".mp4":"video/mp4",".webm":"video/webm",".ogg":"audio/ogg",".wav":"audio/wav",".pdf":"application/pdf",".xml":"application/xml",".txt":"text/plain; charset=utf-8",".csv":"text/csv; charset=utf-8",".zip":"application/zip",".gz":"application/gzip",".tar":"application/x-tar",".wasm":"application/wasm",".webmanifest":"application/manifest+json",".map":"application/json"};function P(t){let e=t.lastIndexOf(".");if(e===-1)return"";let n=t.lastIndexOf("/");return e<n?"":t.slice(e).toLowerCase()}function M(t){let e=P(t);return L[e]}function O(t){let e=new Map(Object.entries(t));return{get(n){return Promise.resolve(e.get(n)??null)}}}function W(t){let e={};if(t?.redirects?.static){let n=1;for(let[s,i]of Object.entries(t.redirects.static))e[s]={...i,lineNumber:n++}}return{html_handling:t?.html_handling??"auto-trailing-slash",not_found_handling:t?.not_found_handling??"none",redirects:{static:e,dynamic:t?.redirects?.dynamic??{}},headers:t?.headers??{}}}async function U(t){if(typeof t=="string"){let s=2166136261;for(let i=0;i<t.length;i++)s^=t.charCodeAt(i),s=s*16777619>>>0;return s.toString(16).padStart(8,"0")}let e=await crypto.subtle.digest("SHA-256",t);return[...new Uint8Array(e).slice(0,8)].map(s=>s.toString(16).padStart(2,"0")).join("")}async function H(t){let e=new Map,n=Object.entries(t);return await Promise.all(n.map(async([s,i])=>{let l=M(s),r=await U(i);e.set(s,{contentType:l,etag:r})})),e}async function lt(t){let e=await H(t),n=O(t);return{manifest:e,storage:n}}function d(t,e){return t.get(e)}var B=/[-/\\\\^$*+?.()|[\\]{}]/g,j=t=>t.replaceAll(B,String.raw`\\$&`),D=/:([A-Za-z]\\w*)/g;function G(t,e){for(let[n,s]of Object.entries(e))t=t.replaceAll(`:${n}`,s);return t}function F(t){t=t.split("*").map(n=>j(n)).join("(?<splat>.*)");let e=t.matchAll(D);for(let n of e)t=t.split(n[0]).join(`(?<${n[1]}>[^/]+)`);return new RegExp("^"+t+"$")}function X(t,e,n){let s=t.redirects.static[`https://${e}${n}`],i=t.redirects.static[n];return s&&i?s.lineNumber<i.lineNumber?s:i:s||i}function V(t,e){let{pathname:n}=new URL(e.url);for(let[s,i]of Object.entries(t.redirects.dynamic))try{let r=F(s).exec(n);if(r){let o=G(i.to,r.groups||{}).trim();return{status:i.status,to:o}}}catch{}}function Y(t,e){let n=new URL(t.url),{search:s,host:i}=n,{pathname:l}=n,r=X(e,i,l),o=r?void 0:V(e,t),c=r??o,h=!1;if(c)if(c.status===200)l=new URL(c.to,t.url).pathname,h=!0;else{let g=new URL(c.to,t.url),x=g.origin===n.origin?`${g.pathname}${g.search||s}${g.hash}`:`${g.href}`;return new Response(null,{status:c.status,headers:{Location:x}})}return{proxied:h,pathname:l}}function Z(t){let e=t.split("*").map(n=>j(n)).join(".*");return new RegExp("^"+e+"$")}function A(t,e,n){if(Object.keys(n.headers).length===0)return e;let{pathname:s}=new URL(t.url),i=new Set;for(let[l,r]of Object.entries(n.headers)){try{if(!Z(l).test(s))continue}catch{continue}if(r.unset)for(let o of r.unset)e.headers.delete(o);if(r.set)for(let[o,c]of Object.entries(r.set))i.has(o.toLowerCase())?e.headers.append(o,c):(e.headers.set(o,c),i.add(o.toLowerCase()))}return e}function J(t){return t.split("/").map(e=>{try{return decodeURIComponent(e)}catch{return e}}).join("/").replaceAll(/\\/+/g,"/")}function E(t){return t.split("/").map(e=>{try{return encodeURIComponent(e)}catch{return e}}).join("/")}function I(t,e,n,s=!1,i=!0){switch(n.html_handling){case"auto-trailing-slash":return Q(t,e,n,s,i);case"force-trailing-slash":return q(t,e,n,s,i);case"drop-trailing-slash":return k(t,e,n,s,i);case"none":return tt(t,e,n,i)}}function a(t,e,n=200){return{type:"asset",pathname:t,meta:e,status:n}}function K(t){return{type:"redirect",to:t}}function u(t,e,n,s,i){if(!i&&!d(n,e)){let l=I(e,n,s,!0);if(l?.type==="asset"&&l.meta.etag===d(n,t)?.etag)return K(e)}}function Q(t,e,n,s,i){let l,r,o=d(e,t);if(t.endsWith("/index")){if(o)return a(t,o);if((r=u(`${t}.html`,t.slice(0,-5),e,n,s))||(r=u(`${t.slice(0,-6)}.html`,t.slice(0,-6),e,n,s)))return r}else if(t.endsWith("/index.html")){if((r=u(t,t.slice(0,-10),e,n,s))||(r=u(`${t.slice(0,-11)}.html`,t.slice(0,-11),e,n,s)))return r}else if(t.endsWith("/")){let h=`${t}index.html`;if(l=d(e,h))return a(h,l);if(r=u(`${t.slice(0,-1)}.html`,t.slice(0,-1),e,n,s))return r}else if(t.endsWith(".html")&&((r=u(t,t.slice(0,-5),e,n,s))||(r=u(`${t.slice(0,-5)}/index.html`,`${t.slice(0,-5)}/`,e,n,s))))return r;if(o)return a(t,o);let c=`${t}.html`;return(l=d(e,c))?a(c,l):(r=u(`${t}/index.html`,`${t}/`,e,n,s))?r:b(t,e,n,i)}function q(t,e,n,s,i){let l,r,o=d(e,t);if(t.endsWith("/index")){if(o)return a(t,o);if((r=u(`${t}.html`,t.slice(0,-5),e,n,s))||(r=u(`${t.slice(0,-6)}.html`,t.slice(0,-5),e,n,s)))return r}else if(t.endsWith("/index.html")){if((r=u(t,t.slice(0,-10),e,n,s))||(r=u(`${t.slice(0,-11)}.html`,t.slice(0,-10),e,n,s)))return r}else if(t.endsWith("/")){let c=`${t}index.html`;if((l=d(e,c))||(c=`${t.slice(0,-1)}.html`,l=d(e,c)))return a(c,l)}else if(t.endsWith(".html")){if(r=u(t,`${t.slice(0,-5)}/`,e,n,s))return r;if(o)return a(t,o);if(r=u(`${t.slice(0,-5)}/index.html`,`${t.slice(0,-5)}/`,e,n,s))return r}return o?a(t,o):(r=u(`${t}.html`,`${t}/`,e,n,s))||(r=u(`${t}/index.html`,`${t}/`,e,n,s))?r:b(t,e,n,i)}function k(t,e,n,s,i){let l,r,o=d(e,t);if(t.endsWith("/index")){if(o)return a(t,o);if(t==="/index"){if(r=u("/index.html","/",e,n,s))return r}else if((r=u(`${t.slice(0,-6)}.html`,t.slice(0,-6),e,n,s))||(r=u(`${t}.html`,t.slice(0,-6),e,n,s)))return r}else if(t.endsWith("/index.html"))if(t==="/index.html"){if(r=u("/index.html","/",e,n,s))return r}else{if(r=u(t,t.slice(0,-11),e,n,s))return r;if(o)return a(t,o);if(r=u(`${t.slice(0,-11)}.html`,t.slice(0,-11),e,n,s))return r}else if(t.endsWith("/")){if(t==="/"){if(l=d(e,"/index.html"))return a("/index.html",l)}else if((r=u(`${t.slice(0,-1)}.html`,t.slice(0,-1),e,n,s))||(r=u(`${t.slice(0,-1)}/index.html`,t.slice(0,-1),e,n,s)))return r}else if(t.endsWith(".html")&&((r=u(t,t.slice(0,-5),e,n,s))||(r=u(`${t.slice(0,-5)}/index.html`,t.slice(0,-5),e,n,s))))return r;if(o)return a(t,o);let c=`${t}.html`;return(l=d(e,c))||(c=`${t}/index.html`,l=d(e,c))?a(c,l):b(t,e,n,i)}function tt(t,e,n,s){let i=d(e,t);return i?a(t,i):b(t,e,n,s)}function b(t,e,n,s=!0){switch(n.not_found_handling){case"single-page-application":{if(!s)return;let i=d(e,"/index.html");return i?a("/index.html",i,200):void 0}case"404-page":{let i=t;for(;i;){i=i.slice(0,i.lastIndexOf("/"));let l=`${i}/404.html`,r=d(e,l);if(r)return a(l,r,404)}return}default:return}}var et="public, max-age=0, must-revalidate",nt="public, max-age=31536000, immutable";function rt(t){return/\\.[a-f0-9]{8,}\\.\\w+$/.test(t)?nt:et}async function ot(t,e,n,s){let i=W(s),l=t.method.toUpperCase();if(!["GET","HEAD"].includes(l))return null;let r=Y(t,i);if(r instanceof Response)return A(t,r,i);let{pathname:o}=r,c=J(o),g=(t.headers.get("Accept")||"").includes("text/html"),x=I(c,e,i,!1,g);if(!x)return null;if(x.type==="redirect"){let f=new URL(t.url),y=E(x.to),v=new Response(null,{status:307,headers:{Location:y+f.search}});return A(t,v,i)}let $=E(c);if($!==o){let f=new URL(t.url),y=new Response(null,{status:307,headers:{Location:$+f.search}});return A(t,y,i)}let{pathname:N,meta:p,status:S}=x,w=`"${p.etag}"`,_=`W/${w}`,z=t.headers.get("If-None-Match")||"",C=new Set(z.split(",").map(f=>f.trim())),m=new Headers;if(m.set("ETag",w),p.contentType&&m.set("Content-Type",p.contentType),m.set("Cache-Control",rt(c)),C.has(_)||C.has(w)){let f=new Response(null,{status:304,headers:m});return A(t,f,i)}let R=null;l!=="HEAD"&&(R=await n.get(N));let T=new Response(R,{status:S,headers:m});return A(t,T,i)}export{H as buildAssetManifest,lt as buildAssets,U as computeETag,O as createMemoryStorage,ot as handleAssetRequest,W as normalizeConfig};\n';
//#endregion
//#region src/app.ts
/**
 * App bundler: builds a full-stack app (server Worker + client bundle + static assets)
 * for the Worker Loader binding.
 */
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
async function createApp(options) {
  showExperimentalWarning("createApp");
  let {
    files,
    bundle = true,
    externals = [],
    target = "es2022",
    minify = false,
    sourcemap = false,
    registry
  } = options;
  externals = ["cloudflare:", ...externals];
  const wranglerConfig = parseWranglerConfig(files);
  const nodejsCompat = hasNodejsCompat(wranglerConfig);
  const installWarnings = [];
  if (hasDependencies(files)) {
    const installResult = await installDependencies(
      files,
      registry ? { registry } : {}
    );
    files = installResult.files;
    installWarnings.push(...installResult.warnings);
  }
  const clientEntries = options.client
    ? Array.isArray(options.client)
      ? options.client
      : [options.client]
    : [];
  const clientOutputs = {};
  const clientBundles = [];
  for (const clientEntry of clientEntries) {
    if (!(clientEntry in files))
      throw new Error(
        `Client entry point "${clientEntry}" not found in files.`
      );
    const bundleModule = (
      await bundleWithEsbuild(
        files,
        clientEntry,
        externals,
        "es2022",
        minify,
        sourcemap,
        false
      )
    ).modules["bundle.js"];
    if (typeof bundleModule === "string") {
      const outputPath = `/${clientEntry.replace(/^src\//, "").replace(/\.(tsx?|jsx?)$/, ".js")}`;
      clientOutputs[outputPath] = bundleModule;
      clientBundles.push(outputPath);
    }
  }
  const allAssets = {};
  if (options.assets)
    for (const [pathname, content] of Object.entries(options.assets)) {
      const normalizedPath = pathname.startsWith("/")
        ? pathname
        : `/${pathname}`;
      allAssets[normalizedPath] = content;
    }
  for (const [pathname, content] of Object.entries(clientOutputs))
    allAssets[pathname] = content;
  const assetManifest = await buildAssetManifest(allAssets);
  const serverEntry = options.server ?? detectEntryPoint(files, wranglerConfig);
  if (!serverEntry)
    throw new Error(
      "Could not determine server entry point. Specify the 'server' option."
    );
  if (!(serverEntry in files))
    throw new Error(`Server entry point "${serverEntry}" not found in files.`);
  let serverResult;
  if (bundle)
    serverResult = await bundleWithEsbuild(
      files,
      serverEntry,
      externals,
      target,
      minify,
      sourcemap,
      nodejsCompat
    );
  else serverResult = await transformAndResolve(files, serverEntry, externals);
  const modules = { ...serverResult.modules };
  for (const [pathname, content] of Object.entries(allAssets)) {
    const moduleName = `__assets${pathname}`;
    if (typeof content === "string") modules[moduleName] = { text: content };
    else modules[moduleName] = { data: content };
  }
  const manifestJson = {};
  for (const [pathname, meta] of assetManifest)
    manifestJson[pathname] = {
      contentType: meta.contentType,
      etag: meta.etag
    };
  modules["__asset-manifest.json"] = { json: manifestJson };
  const assetPathnames = [...assetManifest.keys()];
  const doOption = options.durableObject;
  const doClassName = doOption
    ? typeof doOption === "object" && doOption.className
      ? doOption.className
      : "App"
    : void 0;
  modules["__app-wrapper.js"] = doClassName
    ? generateDOAppWrapper(
        serverResult.mainModule,
        assetPathnames,
        doClassName,
        options.assetConfig
      )
    : generateAppWrapper(
        serverResult.mainModule,
        assetPathnames,
        options.assetConfig
      );
  modules["__asset-runtime.js"] = ASSET_RUNTIME_CODE;
  const result = {
    mainModule: "__app-wrapper.js",
    modules,
    assetManifest,
    assetConfig: options.assetConfig,
    clientBundles: clientBundles.length > 0 ? clientBundles : void 0,
    durableObjectClassName: doClassName
  };
  if (wranglerConfig !== void 0) result.wranglerConfig = wranglerConfig;
  if (installWarnings.length > 0)
    result.warnings = [...(serverResult.warnings ?? []), ...installWarnings];
  else if (serverResult.warnings) result.warnings = serverResult.warnings;
  return result;
}
/**
 * Generate the asset imports + initialization preamble shared by both wrappers.
 * Returns the import statements and the initialization code that creates
 * the manifest Map, memory storage, and ASSET_CONFIG for handleAssetRequest.
 */
function generateAssetPreamble(assetPathnames, assetConfig) {
  const configJson = JSON.stringify(assetConfig ?? {});
  const imports = [];
  const mapEntries = [];
  for (let i = 0; i < assetPathnames.length; i++) {
    const pathname = assetPathnames[i];
    const moduleName = `__assets${pathname}`;
    const varName = `__asset_${i}`;
    imports.push(`import ${varName} from "./${moduleName}";`);
    mapEntries.push(`  ${JSON.stringify(pathname)}: ${varName}`);
  }
  return {
    importsBlock: [
      'import { handleAssetRequest, createMemoryStorage } from "./__asset-runtime.js";',
      'import manifestJson from "./__asset-manifest.json";',
      ...imports
    ].join("\n"),
    initBlock: `
const ASSET_CONFIG = ${configJson};
${`const ASSET_CONTENT = {\n${mapEntries.join(",\n")}\n};`}

// Build manifest Map and storage at module init time
const manifest = new Map(Object.entries(manifestJson));
const storage = createMemoryStorage(ASSET_CONTENT);
`.trimStart()
  };
}
/**
 * Generate the app wrapper module source.
 * This Worker serves assets first, then falls through to the user's server.
 *
 * Uses the pre-built __asset-runtime.js module for full asset handling
 * (all HTML modes, redirects, custom headers, ETag caching, etc.)
 */
function generateAppWrapper(userServerModule, assetPathnames, assetConfig) {
  const { importsBlock, initBlock } = generateAssetPreamble(
    assetPathnames,
    assetConfig
  );
  return `
import userWorker from "./${userServerModule}";
${importsBlock}

${initBlock}
export default {
  async fetch(request, env, ctx) {
    const assetResponse = await handleAssetRequest(request, manifest, storage, ASSET_CONFIG);
    if (assetResponse) return assetResponse;

    // Fall through to user's Worker
    if (typeof userWorker === "object" && userWorker !== null && typeof userWorker.fetch === "function") {
      return userWorker.fetch(request, env, ctx);
    }
    if (typeof userWorker === "function") {
      return userWorker(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  }
};
`.trim();
}
/**
 * Generate a Durable Object class wrapper module source.
 * Exports a named class that serves assets first, then delegates to the
 * user's server code. If the user's default export is a class (DurableObject
 * subclass), the wrapper extends it so `this.ctx.storage` works naturally.
 * Otherwise, it wraps the fetch handler in a DurableObject.
 *
 * Uses the pre-built __asset-runtime.js module for full asset handling.
 */
function generateDOAppWrapper(
  userServerModule,
  assetPathnames,
  className,
  assetConfig
) {
  const { importsBlock, initBlock } = generateAssetPreamble(
    assetPathnames,
    assetConfig
  );
  return `
import { DurableObject } from "cloudflare:workers";
import userExport from "./${userServerModule}";
${importsBlock}

${initBlock}
// Determine base class: if user exported a DurableObject subclass, extend it
// so this.ctx.storage works naturally. Regular functions and plain objects are
// wrapped in a minimal DurableObject that delegates fetch().
// NOTE: This check uses prototype presence — regular (non-arrow) functions also
// have .prototype, but the system prompt instructs class exports for DO mode.
const BaseClass = (typeof userExport === "function" && userExport.prototype)
  ? userExport
  : class extends DurableObject {
      async fetch(request) {
        if (typeof userExport === "object" && userExport !== null && typeof userExport.fetch === "function") {
          return userExport.fetch(request, this.env, this.ctx);
        }
        return new Response("Not Found", { status: 404 });
      }
    };

export class ${className} extends BaseClass {
  async fetch(request) {
    const assetResponse = await handleAssetRequest(request, manifest, storage, ASSET_CONFIG);
    if (assetResponse) return assetResponse;
    return super.fetch(request);
  }
}
`.trim();
}
//#endregion
//#region src/index.ts
/**
 * Dynamic Worker Bundler
 *
 * Creates worker bundles from source files for Cloudflare's Worker Loader binding.
 */
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
async function createWorker(options) {
  showExperimentalWarning("createWorker");
  let {
    files,
    bundle = true,
    externals = [],
    target = "es2022",
    minify = false,
    sourcemap = false,
    registry
  } = options;
  externals = ["cloudflare:", ...externals];
  const wranglerConfig = parseWranglerConfig(files);
  const nodejsCompat = hasNodejsCompat(wranglerConfig);
  const installWarnings = [];
  if (hasDependencies(files)) {
    const installResult = await installDependencies(
      files,
      registry ? { registry } : {}
    );
    files = installResult.files;
    installWarnings.push(...installResult.warnings);
  }
  const entryPoint =
    options.entryPoint ?? detectEntryPoint(files, wranglerConfig);
  if (!entryPoint)
    throw new Error(
      "Could not determine entry point. Please specify entryPoint option."
    );
  if (!(entryPoint in files))
    throw new Error(`Entry point "${entryPoint}" not found in files.`);
  if (bundle) {
    const result = await bundleWithEsbuild(
      files,
      entryPoint,
      externals,
      target,
      minify,
      sourcemap,
      nodejsCompat
    );
    if (wranglerConfig !== void 0) result.wranglerConfig = wranglerConfig;
    if (installWarnings.length > 0)
      result.warnings = [...(result.warnings ?? []), ...installWarnings];
    return result;
  } else {
    const result = await transformAndResolve(files, entryPoint, externals);
    if (wranglerConfig !== void 0) result.wranglerConfig = wranglerConfig;
    if (installWarnings.length > 0)
      result.warnings = [...(result.warnings ?? []), ...installWarnings];
    return result;
  }
}
//#endregion
export {
  buildAssetManifest,
  buildAssets,
  createApp,
  createMemoryStorage,
  createWorker,
  handleAssetRequest,
  inferContentType,
  isTextContentType
};

//# sourceMappingURL=index.js.map
