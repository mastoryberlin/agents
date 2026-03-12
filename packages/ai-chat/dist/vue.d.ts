import {
  AITool,
  OnToolCallCallback,
  PrepareSendMessagesRequestOptions,
  PrepareSendMessagesRequestResult
} from "./react.js";
import * as ai from "ai";
import { ChatInit, ToolSet, UIMessage } from "ai";
import { UseChatOptions } from "@ai-sdk/react";
import * as vue from "vue";
import { PartySocket } from "partysocket";
import { usePartySocket } from "partysocket/react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  Connection,
  Connection as Connection$1,
  ConnectionContext,
  ConnectionContext as ConnectionContext$1,
  Server
} from "partyserver";
import {
  CallToolRequest,
  CallToolResultSchema,
  CompatibilityCallToolResultSchema,
  ElicitRequest,
  ElicitResult,
  GetPromptRequest,
  JSONRPCMessage,
  MessageExtraInfo,
  Prompt,
  ReadResourceRequest,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Tool as Tool$1
} from "@modelcontextprotocol/sdk/types.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  SSEClientTransport,
  SSEClientTransportOptions
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  Transport,
  TransportSendOptions
} from "@modelcontextprotocol/sdk/shared/transport.js";
import { Server as Server$1 } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client as Client$1 } from "@modelcontextprotocol/sdk/client";
//#region ../agents/src/internal_context.d.ts
type AgentEmail = {
  from: string;
  to: string;
  getRaw: () => Promise<Uint8Array>;
  headers: Headers;
  rawSize: number;
  setReject: (reason: string) => void;
  forward: (rcptTo: string, headers?: Headers) => Promise<EmailSendResult>;
  reply: (options: {
    from: string;
    to: string;
    raw: string;
  }) => Promise<EmailSendResult> /** @internal Indicates email was routed via createSecureReplyEmailResolver */;
  _secureRouted?: boolean;
};
//#endregion
//#region ../agents/src/retries.d.ts
/**
 * Retry options for schedule(), scheduleEvery(), queue(), and this.retry().
 */
interface RetryOptions {
  /** Max number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 100 */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default: 3000 */
  maxDelayMs?: number;
}
//#endregion
//#region ../agents/src/core/events.d.ts
interface Disposable {
  dispose(): void;
}
type Event<T> = (listener: (e: T) => void) => Disposable;
declare class Emitter<T> implements Disposable {
  private _listeners;
  readonly event: Event<T>;
  fire(data: T): void;
  dispose(): void;
}
//#endregion
//#region ../agents/src/observability/base.d.ts
/**
 * Base event structure for all observability events
 */
type BaseEvent<
  T extends string,
  Payload extends Record<string, unknown> = Record<string, never>
> = {
  type: T;
  /**
   * The class name of the agent that emitted this event
   * (e.g. "MyChatAgent").
   * Always present on events emitted by an Agent instance.
   */
  agent?: string;
  /**
   * The instance name (Durable Object ID name) of the agent.
   * Always present on events emitted by an Agent instance.
   */
  name?: string;
  /**
   * The payload of the event
   */
  payload: Payload;
  /**
   * The timestamp of the event in milliseconds since epoch
   */
  timestamp: number;
};
//#endregion
//#region ../agents/src/observability/mcp.d.ts
/**
 * MCP-specific observability events
 * These track the lifecycle of MCP connections and operations
 */
type MCPObservabilityEvent =
  | BaseEvent<
      "mcp:client:preconnect",
      {
        serverId: string;
      }
    >
  | BaseEvent<
      "mcp:client:connect",
      {
        url: string;
        transport: string;
        state: string;
        error?: string;
      }
    >
  | BaseEvent<
      "mcp:client:authorize",
      {
        serverId: string;
        authUrl: string;
        clientId?: string;
      }
    >
  | BaseEvent<
      "mcp:client:discover",
      {
        url?: string;
        state?: string;
        error?: string;
        capability?: string;
      }
    >;
//#endregion
//#region ../agents/src/mcp/do-oauth-client-provider.d.ts
interface AgentMcpOAuthProvider extends OAuthClientProvider {
  authUrl: string | undefined;
  clientId: string | undefined;
  serverId: string | undefined;
  checkState(state: string): Promise<{
    valid: boolean;
    serverId?: string;
    error?: string;
  }>;
  consumeState(state: string): Promise<void>;
  deleteCodeVerifier(): Promise<void>;
}
//#endregion
//#region ../agents/src/mcp/types.d.ts
type MaybePromise<T> = T | Promise<T>;
type HttpTransportType = "sse" | "streamable-http";
type BaseTransportType = HttpTransportType | "rpc";
type TransportType = BaseTransportType | "auto";
interface CORSOptions {
  origin?: string;
  methods?: string;
  headers?: string;
  maxAge?: number;
  exposeHeaders?: string;
}
interface ServeOptions {
  binding?: string;
  corsOptions?: CORSOptions;
  transport?: BaseTransportType;
  jurisdiction?: DurableObjectJurisdiction;
}
type McpClientOptions = ConstructorParameters<typeof Client$1>[1];
//#endregion
//#region ../agents/src/mcp/index.d.ts
declare abstract class McpAgent<
  Env extends Cloudflare.Env = Cloudflare.Env,
  State = unknown,
  Props extends Record<string, unknown> = Record<string, unknown>
> extends Agent<Env, State, Props> {
  private _transport?;
  private _pendingElicitations;
  props?: Props;
  shouldSendProtocolMessages(
    _connection: Connection$1,
    ctx: ConnectionContext$1
  ): boolean;
  abstract server: MaybePromise<McpServer | Server$1>;
  abstract init(): Promise<void>;
  setInitializeRequest(initializeRequest: JSONRPCMessage): Promise<void>;
  getInitializeRequest(): Promise<JSONRPCMessage | undefined>;
  /** Read the transport type for this agent.
   * This relies on the naming scheme being `sse:${sessionId}`,
   * `streamable-http:${sessionId}`, or `rpc:${sessionId}`.
   */
  getTransportType(): BaseTransportType;
  /** Read the sessionId for this agent.
   * This relies on the naming scheme being `sse:${sessionId}`
   * or `streamable-http:${sessionId}`.
   */
  getSessionId(): string;
  /** Get the unique WebSocket. SSE transport only. */
  getWebSocket(): Connection$1<unknown> | null;
  /**
   * Returns options for configuring the RPC server transport.
   * Override this method to customize RPC transport behavior (e.g., timeout).
   *
   * @example
   * ```typescript
   * class MyMCP extends McpAgent {
   *   protected getRpcTransportOptions() {
   *     return { timeout: 120000 }; // 2 minutes
   *   }
   * }
   * ```
   */
  protected getRpcTransportOptions(): RPCServerTransportOptions;
  /** Returns a new transport matching the type of the Agent. */
  private initTransport;
  /** Update and store the props */
  updateProps(props?: Props): Promise<void>;
  reinitializeServer(): Promise<void>;
  /** Sets up the MCP transport and server every time the Agent is started.*/
  onStart(props?: Props): Promise<void>;
  /** Validates new WebSocket connections. */
  onConnect(
    conn: Connection$1,
    { request: req }: ConnectionContext$1
  ): Promise<void>;
  /** Handles MCP Messages for the legacy SSE transport. */
  onSSEMcpMessage(
    _sessionId: string,
    messageBody: unknown,
    extraInfo?: MessageExtraInfo
  ): Promise<Error | null>;
  /** Elicit user input with a message and schema */
  elicitInput(params: {
    message: string;
    requestedSchema: unknown;
  }): Promise<ElicitResult>;
  /** Handle elicitation responses via in-memory resolver */
  private _handleElicitationResponse;
  /**
   * Handle an RPC message for MCP
   * This method is called by the RPC stub to process MCP messages
   * @param message The JSON-RPC message(s) to handle
   * @returns The response message(s) or undefined
   */
  handleMcpMessage(
    message: JSONRPCMessage | JSONRPCMessage[]
  ): Promise<JSONRPCMessage | JSONRPCMessage[] | undefined>;
  /** Return a handler for the given path for this MCP.
   * Defaults to Streamable HTTP transport.
   */
  static serve(
    path: string,
    { binding, corsOptions, transport, jurisdiction }?: ServeOptions
  ): {
    fetch<Env>(
      this: void,
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ): Promise<Response>;
  };
  /**
   * Legacy api
   **/
  static mount(
    path: string,
    opts?: Omit<ServeOptions, "transport">
  ): {
    fetch<Env>(
      this: void,
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ): Promise<Response>;
  };
  static serveSSE(
    path: string,
    opts?: Omit<ServeOptions, "transport">
  ): {
    fetch<Env>(
      this: void,
      request: Request,
      env: Env,
      ctx: ExecutionContext
    ): Promise<Response>;
  };
}
//#endregion
//#region ../agents/src/mcp/rpc.d.ts
interface RPCClientTransportOptions<T extends McpAgent = McpAgent> {
  namespace: DurableObjectNamespace<T>;
  name: string;
  props?: Record<string, unknown>;
}
declare class RPCClientTransport implements Transport {
  private _namespace;
  private _name;
  private _props?;
  private _stub?;
  private _started;
  private _protocolVersion?;
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  constructor(options: RPCClientTransportOptions<McpAgent>);
  setProtocolVersion(version: string): void;
  getProtocolVersion(): string | undefined;
  start(): Promise<void>;
  close(): Promise<void>;
  send(
    message: JSONRPCMessage | JSONRPCMessage[],
    options?: TransportSendOptions
  ): Promise<void>;
}
interface RPCServerTransportOptions {
  timeout?: number;
}
//#endregion
//#region ../agents/src/mcp/client-connection.d.ts
/**
 * Connection state machine for MCP client connections.
 *
 * State transitions:
 * - Non-OAuth: init() → CONNECTING → DISCOVERING → READY
 * - OAuth: init() → AUTHENTICATING → (callback) → CONNECTING → DISCOVERING → READY
 * - Any state can transition to FAILED on error
 */
declare const MCPConnectionState: {
  /** Waiting for OAuth authorization to complete */ readonly AUTHENTICATING: "authenticating" /** Establishing transport connection to MCP server */;
  readonly CONNECTING: "connecting" /** Transport connection established */;
  readonly CONNECTED: "connected" /** Discovering server capabilities (tools, resources, prompts) */;
  readonly DISCOVERING: "discovering" /** Fully connected and ready to use */;
  readonly READY: "ready" /** Connection failed at some point */;
  readonly FAILED: "failed";
};
/**
 * Connection state type for MCP client connections.
 */
type MCPConnectionState =
  (typeof MCPConnectionState)[keyof typeof MCPConnectionState];
/**
 * Transport options for MCP client connections.
 * Combines transport-specific options with auth provider and type selection.
 */
type MCPTransportOptions = (
  | SSEClientTransportOptions
  | StreamableHTTPClientTransportOptions
  | RPCClientTransportOptions
) & {
  authProvider?: AgentMcpOAuthProvider;
  type?: TransportType;
};
/**
 * Result of a discovery operation.
 * success indicates whether discovery completed successfully.
 * error is present when success is false.
 */
type MCPDiscoveryResult = {
  success: boolean;
  error?: string;
};
declare class MCPClientConnection {
  url: URL;
  options: {
    transport: MCPTransportOptions;
    client: McpClientOptions;
  };
  client: Client;
  connectionState: MCPConnectionState;
  connectionError: string | null;
  lastConnectedTransport: BaseTransportType | undefined;
  instructions?: string;
  tools: Tool$1[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  serverCapabilities: ServerCapabilities | undefined;
  /** Tracks in-flight discovery to allow cancellation */
  private _discoveryAbortController;
  private readonly _onObservabilityEvent;
  readonly onObservabilityEvent: Event<MCPObservabilityEvent>;
  constructor(
    url: URL,
    info: ConstructorParameters<typeof Client>[0],
    options?: {
      transport: MCPTransportOptions;
      client: McpClientOptions;
    }
  );
  /**
   * Initialize a client connection, if authentication is required, the connection will be in the AUTHENTICATING state
   * Sets connection state based on the result and emits observability events
   *
   * @returns Error message if connection failed, undefined otherwise
   */
  init(): Promise<string | undefined>;
  /**
   * Finish OAuth by probing transports based on configured type.
   * - Explicit: finish on that transport
   * - Auto: try streamable-http, then sse on 404/405/Not Implemented
   */
  private finishAuthProbe;
  /**
   * Complete OAuth authorization
   */
  completeAuthorization(code: string): Promise<void>;
  /**
   * Discover server capabilities and register tools, resources, prompts, and templates.
   * This method does the work but does not manage connection state - that's handled by discover().
   */
  discoverAndRegister(): Promise<void>;
  /**
   * Discover server capabilities with timeout and cancellation support.
   * If called while a previous discovery is in-flight, the previous discovery will be aborted.
   *
   * @param options Optional configuration
   * @param options.timeoutMs Timeout in milliseconds (default: 15000)
   * @returns Result indicating success/failure with optional error message
   */
  discover(options?: { timeoutMs?: number }): Promise<MCPDiscoveryResult>;
  /**
   * Cancel any in-flight discovery operation.
   * Called when closing the connection.
   */
  cancelDiscovery(): void;
  /**
   * Notification handler registration for tools
   * Should only be called if serverCapabilities.tools exists
   */
  registerTools(): Promise<Tool$1[]>;
  /**
   * Notification handler registration for resources
   * Should only be called if serverCapabilities.resources exists
   */
  registerResources(): Promise<Resource[]>;
  /**
   * Notification handler registration for prompts
   * Should only be called if serverCapabilities.prompts exists
   */
  registerPrompts(): Promise<Prompt[]>;
  registerResourceTemplates(): Promise<ResourceTemplate[]>;
  fetchTools(): Promise<
    {
      inputSchema: {
        [x: string]: unknown;
        type: "object";
        properties?:
          | {
              [x: string]: object;
            }
          | undefined;
        required?: string[] | undefined;
      };
      name: string;
      description?: string | undefined;
      outputSchema?:
        | {
            [x: string]: unknown;
            type: "object";
            properties?:
              | {
                  [x: string]: object;
                }
              | undefined;
            required?: string[] | undefined;
          }
        | undefined;
      annotations?:
        | {
            title?: string | undefined;
            readOnlyHint?: boolean | undefined;
            destructiveHint?: boolean | undefined;
            idempotentHint?: boolean | undefined;
            openWorldHint?: boolean | undefined;
          }
        | undefined;
      execution?:
        | {
            taskSupport?: "optional" | "required" | "forbidden" | undefined;
          }
        | undefined;
      _meta?:
        | {
            [x: string]: unknown;
          }
        | undefined;
      icons?:
        | {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
          }[]
        | undefined;
      title?: string | undefined;
    }[]
  >;
  fetchResources(): Promise<
    {
      uri: string;
      name: string;
      description?: string | undefined;
      mimeType?: string | undefined;
      annotations?:
        | {
            audience?: ("user" | "assistant")[] | undefined;
            priority?: number | undefined;
            lastModified?: string | undefined;
          }
        | undefined;
      _meta?:
        | {
            [x: string]: unknown;
          }
        | undefined;
      icons?:
        | {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
          }[]
        | undefined;
      title?: string | undefined;
    }[]
  >;
  fetchPrompts(): Promise<
    {
      name: string;
      description?: string | undefined;
      arguments?:
        | {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
          }[]
        | undefined;
      _meta?:
        | {
            [x: string]: unknown;
          }
        | undefined;
      icons?:
        | {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
          }[]
        | undefined;
      title?: string | undefined;
    }[]
  >;
  fetchResourceTemplates(): Promise<
    {
      uriTemplate: string;
      name: string;
      description?: string | undefined;
      mimeType?: string | undefined;
      annotations?:
        | {
            audience?: ("user" | "assistant")[] | undefined;
            priority?: number | undefined;
            lastModified?: string | undefined;
          }
        | undefined;
      _meta?:
        | {
            [x: string]: unknown;
          }
        | undefined;
      icons?:
        | {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
          }[]
        | undefined;
      title?: string | undefined;
    }[]
  >;
  /**
   * Handle elicitation request from server
   * Automatically uses the Agent's built-in elicitation handling if available
   */
  handleElicitationRequest(_request: ElicitRequest): Promise<ElicitResult>;
  /**
   * Get the transport for the client
   * @param transportType - The transport type to get
   * @returns The transport for the client
   */
  getTransport(
    transportType: BaseTransportType
  ): StreamableHTTPClientTransport | SSEClientTransport | RPCClientTransport;
  private tryConnect;
  private _capabilityErrorHandler;
}
//#endregion
//#region ../agents/src/mcp/client-storage.d.ts
/**
 * Represents a row in the cf_agents_mcp_servers table
 */
type MCPServerRow = {
  id: string;
  name: string;
  server_url: string;
  client_id: string | null;
  auth_url: string | null;
  callback_url: string;
  server_options: string | null;
};
//#endregion
//#region ../agents/src/mcp/client.d.ts
/**
 * Result of an OAuth callback request
 */
type MCPOAuthCallbackResult =
  | {
      serverId: string;
      authSuccess: true;
      authError?: undefined;
    }
  | {
      serverId?: string;
      authSuccess: false;
      authError: string;
    };
/**
 * Options for registering an MCP server
 */
type RegisterServerOptions = {
  url: string;
  name: string;
  callbackUrl?: string;
  client?: ConstructorParameters<typeof Client>[1];
  transport?: MCPTransportOptions;
  authUrl?: string;
  clientId?: string /** Retry options for connection and reconnection attempts */;
  retry?: RetryOptions;
};
/**
 * Result of attempting to connect to an MCP server.
 * Discriminated union ensures error is present only on failure.
 */
type MCPConnectionResult =
  | {
      state: typeof MCPConnectionState.FAILED;
      error: string;
    }
  | {
      state: typeof MCPConnectionState.AUTHENTICATING;
      authUrl: string;
      clientId?: string;
    }
  | {
      state: typeof MCPConnectionState.CONNECTED;
    };
/**
 * Result of discovering server capabilities.
 * success indicates whether discovery completed successfully.
 * state is the current connection state at time of return.
 * error is present when success is false.
 */
type MCPDiscoverResult = {
  success: boolean;
  state: MCPConnectionState;
  error?: string;
};
type MCPClientOAuthCallbackConfig = {
  successRedirect?: string;
  errorRedirect?: string;
  customHandler?: (result: MCPClientOAuthResult) => Response;
};
type MCPClientOAuthResult =
  | {
      serverId: string;
      authSuccess: true;
      authError?: undefined;
    }
  | {
      serverId?: string;
      authSuccess: false /** May contain untrusted content from external OAuth providers. Escape appropriately for your output context. */;
      authError: string;
    };
type MCPClientManagerOptions = {
  storage: DurableObjectStorage;
  createAuthProvider?: (callbackUrl: string) => AgentMcpOAuthProvider;
};
/**
 * Utility class that aggregates multiple MCP clients into one
 */
declare class MCPClientManager {
  private _name;
  private _version;
  mcpConnections: Record<string, MCPClientConnection>;
  private _didWarnAboutUnstableGetAITools;
  private _oauthCallbackConfig?;
  private _connectionDisposables;
  private _storage;
  private _createAuthProviderFn?;
  private _isRestored;
  private _pendingConnections;
  /** @internal Protected for testing purposes. */
  protected readonly _onObservabilityEvent: Emitter<MCPObservabilityEvent>;
  readonly onObservabilityEvent: Event<MCPObservabilityEvent>;
  private readonly _onServerStateChanged;
  /**
   * Event that fires whenever any MCP server state changes (registered, connected, removed, etc.)
   * This is useful for broadcasting server state to clients.
   */
  readonly onServerStateChanged: Event<void>;
  /**
   * @param _name Name of the MCP client
   * @param _version Version of the MCP Client
   * @param options Storage adapter for persisting MCP server state
   */
  constructor(
    _name: string,
    _version: string,
    options: MCPClientManagerOptions
  );
  private sql;
  private saveServerToStorage;
  private removeServerFromStorage;
  private getServersFromStorage;
  /**
   * Get the retry options for a server from stored server_options
   */
  private getServerRetryOptions;
  private clearServerAuthUrl;
  private failConnection;
  jsonSchema: typeof ai.jsonSchema | undefined;
  /**
   * Create an auth provider for a server
   * @internal
   */
  private createAuthProvider;
  /**
   * Get saved RPC servers from storage (servers with rpc:// URLs).
   * These are restored separately by the Agent class since they need env bindings.
   */
  getRpcServersFromStorage(): MCPServerRow[];
  /**
   * Save an RPC server to storage for hibernation recovery.
   * The bindingName is stored in server_options so the Agent can look up
   * the namespace from env during restore.
   */
  saveRpcServerToStorage(
    id: string,
    name: string,
    normalizedName: string,
    bindingName: string,
    props?: Record<string, unknown>
  ): void;
  /**
   * Restore MCP server connections from storage
   * This method is called on Agent initialization to restore previously connected servers.
   * RPC servers (rpc:// URLs) are skipped here -- they are restored by the Agent class
   * which has access to env bindings.
   *
   * @param clientName Name to use for OAuth client (typically the agent instance name)
   */
  restoreConnectionsFromStorage(clientName: string): Promise<void>;
  /**
   * Track a pending connection promise for a server.
   * The promise is removed from the map when it settles.
   */
  private _trackConnection;
  /**
   * Wait for all in-flight connection and discovery operations to settle.
   * This is useful when you need MCP tools to be available before proceeding,
   * e.g. before calling getAITools() after the agent wakes from hibernation.
   *
   * Returns once every pending connection has either connected and discovered,
   * failed, or timed out. Never rejects.
   *
   * @param options.timeout - Maximum time in milliseconds to wait.
   *   `0` returns immediately without waiting.
   *   `undefined` (default) waits indefinitely.
   */
  waitForConnections(options?: { timeout?: number }): Promise<void>;
  /**
   * Internal method to restore a single server connection and discovery
   */
  private _restoreServer;
  /**
   * Connect to and register an MCP server
   *
   * @deprecated This method is maintained for backward compatibility.
   * For new code, use registerServer() and connectToServer() separately.
   *
   * @param url Server URL
   * @param options Connection options
   * @returns Object with server ID, auth URL (if OAuth), and client ID (if OAuth)
   */
  connect(
    url: string,
    options?: {
      reconnect?: {
        id: string;
        oauthClientId?: string;
        oauthCode?: string;
      };
      transport?: MCPTransportOptions;
      client?: ConstructorParameters<typeof Client>[1];
    }
  ): Promise<{
    id: string;
    authUrl?: string;
    clientId?: string;
  }>;
  /**
   * Create an in-memory connection object and set up observability
   * Does NOT save to storage - use registerServer() for that
   * @returns The connection object (existing or newly created)
   */
  private createConnection;
  /**
   * Register an MCP server connection without connecting
   * Creates the connection object, sets up observability, and saves to storage
   *
   * @param id Server ID
   * @param options Registration options including URL, name, callback URL, and connection config
   * @returns Server ID
   */
  registerServer(id: string, options: RegisterServerOptions): Promise<string>;
  /**
   * Connect to an already registered MCP server and initialize the connection.
   *
   * For OAuth servers, returns `{ state: "authenticating", authUrl, clientId? }`.
   * The user must complete the OAuth flow via the authUrl, which triggers a
   * callback handled by `handleCallbackRequest()`.
   *
   * For non-OAuth servers, establishes the transport connection and returns
   * `{ state: "connected" }`. Call `discoverIfConnected()` afterwards to
   * discover capabilities and transition to "ready" state.
   *
   * @param id Server ID (must be registered first via registerServer())
   * @returns Connection result with current state and OAuth info (if applicable)
   */
  connectToServer(id: string): Promise<MCPConnectionResult>;
  private extractServerIdFromState;
  isCallbackRequest(req: Request): boolean;
  private validateCallbackRequest;
  handleCallbackRequest(req: Request): Promise<MCPOAuthCallbackResult>;
  /**
   * Discover server capabilities if connection is in CONNECTED or READY state.
   * Transitions to DISCOVERING then READY (or CONNECTED on error).
   * Can be called to refresh server capabilities (e.g., from a UI refresh button).
   *
   * If called while a previous discovery is in-flight for the same server,
   * the previous discovery will be aborted.
   *
   * @param serverId The server ID to discover
   * @param options Optional configuration
   * @param options.timeoutMs Timeout in milliseconds (default: 30000)
   * @returns Result with current state and optional error, or undefined if connection not found
   */
  discoverIfConnected(
    serverId: string,
    options?: {
      timeoutMs?: number;
    }
  ): Promise<MCPDiscoverResult | undefined>;
  /**
   * Establish connection in the background after OAuth completion.
   * This method connects to the server and discovers its capabilities.
   * The connection is automatically tracked so that `waitForConnections()`
   * will include it.
   * @param serverId The server ID to establish connection for
   */
  establishConnection(serverId: string): Promise<void>;
  private _doEstablishConnection;
  /**
   * Configure OAuth callback handling
   * @param config OAuth callback configuration
   */
  configureOAuthCallback(config: MCPClientOAuthCallbackConfig): void;
  /**
   * Get the current OAuth callback configuration
   * @returns The current OAuth callback configuration
   */
  getOAuthCallbackConfig(): MCPClientOAuthCallbackConfig | undefined;
  /**
   * @returns namespaced list of tools
   */
  listTools(): NamespacedData["tools"];
  /**
   * Lazy-loads the jsonSchema function from the AI SDK.
   *
   * This defers importing the "ai" package until it's actually needed, which helps reduce
   * initial bundle size and startup time. The jsonSchema function is required for converting
   * MCP tools into AI SDK tool definitions via getAITools().
   *
   * @internal This method is for internal use only. It's automatically called before operations
   * that need jsonSchema (like getAITools() or OAuth flows). External consumers should not need
   * to call this directly.
   */
  ensureJsonSchema(): Promise<void>;
  /**
   * @returns a set of tools that you can use with the AI SDK
   */
  getAITools(): ToolSet;
  /**
   * @deprecated this has been renamed to getAITools(), and unstable_getAITools will be removed in the next major version
   * @returns a set of tools that you can use with the AI SDK
   */
  unstable_getAITools(): ToolSet;
  /**
   * Closes all active in-memory connections to MCP servers.
   *
   * Note: This only closes the transport connections - it does NOT remove
   * servers from storage. Servers will still be listed and their callback
   * URLs will still match incoming OAuth requests.
   *
   * Use removeServer() instead if you want to fully clean up a server
   * (closes connection AND removes from storage).
   */
  closeAllConnections(): Promise<void>;
  /**
   * Closes a connection to an MCP server
   * @param id The id of the connection to close
   */
  closeConnection(id: string): Promise<void>;
  /**
   * Remove an MCP server - closes connection if active and removes from storage.
   */
  removeServer(serverId: string): Promise<void>;
  /**
   * List all MCP servers from storage
   */
  listServers(): MCPServerRow[];
  /**
   * Dispose the manager and all resources.
   */
  dispose(): Promise<void>;
  /**
   * @returns namespaced list of prompts
   */
  listPrompts(): NamespacedData["prompts"];
  /**
   * @returns namespaced list of tools
   */
  listResources(): NamespacedData["resources"];
  /**
   * @returns namespaced list of resource templates
   */
  listResourceTemplates(): NamespacedData["resourceTemplates"];
  /**
   * Namespaced version of callTool
   */
  callTool(
    params: CallToolRequest["params"] & {
      serverId: string;
    },
    resultSchema?:
      | typeof CallToolResultSchema
      | typeof CompatibilityCallToolResultSchema,
    options?: RequestOptions
  ): Promise<
    | {
        [x: string]: unknown;
        content: (
          | {
              type: "text";
              text: string;
              annotations?:
                | {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                  }
                | undefined;
              _meta?: Record<string, unknown> | undefined;
            }
          | {
              type: "image";
              data: string;
              mimeType: string;
              annotations?:
                | {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                  }
                | undefined;
              _meta?: Record<string, unknown> | undefined;
            }
          | {
              type: "audio";
              data: string;
              mimeType: string;
              annotations?:
                | {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                  }
                | undefined;
              _meta?: Record<string, unknown> | undefined;
            }
          | {
              type: "resource";
              resource:
                | {
                    uri: string;
                    text: string;
                    mimeType?: string | undefined;
                    _meta?: Record<string, unknown> | undefined;
                  }
                | {
                    uri: string;
                    blob: string;
                    mimeType?: string | undefined;
                    _meta?: Record<string, unknown> | undefined;
                  };
              annotations?:
                | {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                  }
                | undefined;
              _meta?: Record<string, unknown> | undefined;
            }
          | {
              uri: string;
              name: string;
              type: "resource_link";
              description?: string | undefined;
              mimeType?: string | undefined;
              annotations?:
                | {
                    audience?: ("user" | "assistant")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                  }
                | undefined;
              _meta?:
                | {
                    [x: string]: unknown;
                  }
                | undefined;
              icons?:
                | {
                    src: string;
                    mimeType?: string | undefined;
                    sizes?: string[] | undefined;
                    theme?: "light" | "dark" | undefined;
                  }[]
                | undefined;
              title?: string | undefined;
            }
        )[];
        _meta?:
          | {
              [x: string]: unknown;
              progressToken?: string | number | undefined;
              "io.modelcontextprotocol/related-task"?:
                | {
                    taskId: string;
                  }
                | undefined;
            }
          | undefined;
        structuredContent?: Record<string, unknown> | undefined;
        isError?: boolean | undefined;
      }
    | {
        [x: string]: unknown;
        toolResult: unknown;
        _meta?:
          | {
              [x: string]: unknown;
              progressToken?: string | number | undefined;
              "io.modelcontextprotocol/related-task"?:
                | {
                    taskId: string;
                  }
                | undefined;
            }
          | undefined;
      }
  >;
  /**
   * Namespaced version of readResource
   */
  readResource(
    params: ReadResourceRequest["params"] & {
      serverId: string;
    },
    options: RequestOptions
  ): Promise<{
    [x: string]: unknown;
    contents: (
      | {
          uri: string;
          text: string;
          mimeType?: string | undefined;
          _meta?: Record<string, unknown> | undefined;
        }
      | {
          uri: string;
          blob: string;
          mimeType?: string | undefined;
          _meta?: Record<string, unknown> | undefined;
        }
    )[];
    _meta?:
      | {
          [x: string]: unknown;
          progressToken?: string | number | undefined;
          "io.modelcontextprotocol/related-task"?:
            | {
                taskId: string;
              }
            | undefined;
        }
      | undefined;
  }>;
  /**
   * Namespaced version of getPrompt
   */
  getPrompt(
    params: GetPromptRequest["params"] & {
      serverId: string;
    },
    options: RequestOptions
  ): Promise<{
    [x: string]: unknown;
    messages: {
      role: "user" | "assistant";
      content:
        | {
            type: "text";
            text: string;
            annotations?:
              | {
                  audience?: ("user" | "assistant")[] | undefined;
                  priority?: number | undefined;
                  lastModified?: string | undefined;
                }
              | undefined;
            _meta?: Record<string, unknown> | undefined;
          }
        | {
            type: "image";
            data: string;
            mimeType: string;
            annotations?:
              | {
                  audience?: ("user" | "assistant")[] | undefined;
                  priority?: number | undefined;
                  lastModified?: string | undefined;
                }
              | undefined;
            _meta?: Record<string, unknown> | undefined;
          }
        | {
            type: "audio";
            data: string;
            mimeType: string;
            annotations?:
              | {
                  audience?: ("user" | "assistant")[] | undefined;
                  priority?: number | undefined;
                  lastModified?: string | undefined;
                }
              | undefined;
            _meta?: Record<string, unknown> | undefined;
          }
        | {
            type: "resource";
            resource:
              | {
                  uri: string;
                  text: string;
                  mimeType?: string | undefined;
                  _meta?: Record<string, unknown> | undefined;
                }
              | {
                  uri: string;
                  blob: string;
                  mimeType?: string | undefined;
                  _meta?: Record<string, unknown> | undefined;
                };
            annotations?:
              | {
                  audience?: ("user" | "assistant")[] | undefined;
                  priority?: number | undefined;
                  lastModified?: string | undefined;
                }
              | undefined;
            _meta?: Record<string, unknown> | undefined;
          }
        | {
            uri: string;
            name: string;
            type: "resource_link";
            description?: string | undefined;
            mimeType?: string | undefined;
            annotations?:
              | {
                  audience?: ("user" | "assistant")[] | undefined;
                  priority?: number | undefined;
                  lastModified?: string | undefined;
                }
              | undefined;
            _meta?:
              | {
                  [x: string]: unknown;
                }
              | undefined;
            icons?:
              | {
                  src: string;
                  mimeType?: string | undefined;
                  sizes?: string[] | undefined;
                  theme?: "light" | "dark" | undefined;
                }[]
              | undefined;
            title?: string | undefined;
          };
    }[];
    _meta?:
      | {
          [x: string]: unknown;
          progressToken?: string | number | undefined;
          "io.modelcontextprotocol/related-task"?:
            | {
                taskId: string;
              }
            | undefined;
        }
      | undefined;
    description?: string | undefined;
  }>;
}
type NamespacedData = {
  tools: (Tool$1 & {
    serverId: string;
  })[];
  prompts: (Prompt & {
    serverId: string;
  })[];
  resources: (Resource & {
    serverId: string;
  })[];
  resourceTemplates: (ResourceTemplate & {
    serverId: string;
  })[];
};
//#endregion
//#region ../agents/src/workflow-types.d.ts
/**
 * Workflow callback types for Agent-Workflow communication
 */
type WorkflowCallbackType = "progress" | "complete" | "error" | "event";
/**
 * Base callback structure sent from Workflow to Agent
 */
type WorkflowCallbackBase = {
  /** Workflow binding name */ workflowName: string /** ID of the workflow instance */;
  workflowId: string /** Type of callback */;
  type: WorkflowCallbackType /** Timestamp when callback was sent */;
  timestamp: number;
};
/**
 * Default progress type - covers common use cases.
 * Developers can define their own progress type for domain-specific needs.
 */
type DefaultProgress = {
  /** Current step name */ step?: string /** Step/overall status */;
  status?:
    | "pending"
    | "running"
    | "complete"
    | "error" /** Human-readable message */;
  message?: string /** Progress percentage (0-1) */;
  percent?: number /** Allow additional custom fields */;
  [key: string]: unknown;
};
/**
 * Progress callback - reports workflow progress with typed payload
 */
type WorkflowProgressCallback<P = DefaultProgress> = WorkflowCallbackBase & {
  type: "progress" /** Typed progress data */;
  progress: P;
};
/**
 * Complete callback - workflow finished successfully
 */
type WorkflowCompleteCallback = WorkflowCallbackBase & {
  type: "complete" /** Result of the workflow */;
  result?: unknown;
};
/**
 * Error callback - workflow encountered an error
 */
type WorkflowErrorCallback = WorkflowCallbackBase & {
  type: "error" /** Error message */;
  error: string;
};
/**
 * Event callback - custom event from workflow
 */
type WorkflowEventCallback = WorkflowCallbackBase & {
  type: "event" /** Custom event payload */;
  event: unknown;
};
/**
 * Union of all callback types
 */
type WorkflowCallback<P = DefaultProgress> =
  | WorkflowProgressCallback<P>
  | WorkflowCompleteCallback
  | WorkflowErrorCallback
  | WorkflowEventCallback;
/**
 * Workflow status values - derived from Cloudflare's InstanceStatus
 */
type WorkflowStatus = InstanceStatus["status"];
/**
 * Options for runWorkflow()
 */
type RunWorkflowOptions = {
  /** Custom workflow instance ID (auto-generated if not provided) */ id?: string /** Optional metadata for querying (stored as JSON) */;
  metadata?: Record<
    string,
    unknown
  > /** Agent binding name (auto-detected from class name if not provided) */;
  agentBinding?: string;
};
/**
 * Event payload for sendWorkflowEvent()
 */
type WorkflowEventPayload = {
  /** Event type name */ type: string /** Event payload data */;
  payload: unknown;
};
/**
 * Parsed workflow tracking info returned by getWorkflow()
 */
type WorkflowInfo = {
  /** Internal row ID */ id: string /** Cloudflare Workflow instance ID */;
  workflowId: string /** Workflow binding name */;
  workflowName: string /** Current workflow status */;
  status: WorkflowStatus /** Metadata (parsed from JSON) */;
  metadata: Record<string, unknown> | null /** Error info if workflow failed */;
  error: {
    name: string;
    message: string;
  } | null /** When workflow was created */;
  createdAt: Date /** When workflow was last updated */;
  updatedAt: Date /** When workflow completed (null if not complete) */;
  completedAt: Date | null;
};
/**
 * Criteria for querying tracked workflows
 */
type WorkflowQueryCriteria = {
  /** Filter by status */ status?:
    | WorkflowStatus
    | WorkflowStatus[] /** Filter by workflow binding name */;
  workflowName?: string /** Filter by metadata key-value pairs (exact match) */;
  metadata?: Record<
    string,
    string | number | boolean
  > /** Limit number of results (default 50, max 100) */;
  limit?: number /** Order by created_at */;
  orderBy?:
    | "asc"
    | "desc" /** Cursor for pagination (from previous WorkflowPage.nextCursor) */;
  cursor?: string;
};
/**
 * Paginated result from getWorkflows()
 */
type WorkflowPage = {
  /** Workflows for this page */ workflows: WorkflowInfo[] /** Total count of workflows matching the criteria (ignoring pagination) */;
  total: number /** Cursor for next page, or null if no more pages */;
  nextCursor: string | null;
};
//#endregion
//#region ../agents/src/observability/agent.d.ts
/**
 * Agent-specific observability events
 * These track the lifecycle and operations of an Agent
 */
type AgentObservabilityEvent =
  | BaseEvent<"state:update">
  | BaseEvent<
      "rpc",
      {
        method: string;
        streaming?: boolean;
      }
    >
  | BaseEvent<
      "rpc:error",
      {
        method: string;
        error: string;
      }
    >
  | BaseEvent<"message:request">
  | BaseEvent<"message:response">
  | BaseEvent<"message:clear">
  | BaseEvent<
      "message:cancel",
      {
        requestId: string;
      }
    >
  | BaseEvent<
      "message:error",
      {
        error: string;
      }
    >
  | BaseEvent<
      "tool:result",
      {
        toolCallId: string;
        toolName: string;
      }
    >
  | BaseEvent<
      "tool:approval",
      {
        toolCallId: string;
        approved: boolean;
      }
    >
  | BaseEvent<
      "schedule:create",
      {
        callback: string;
        id: string;
      }
    >
  | BaseEvent<
      "schedule:execute",
      {
        callback: string;
        id: string;
      }
    >
  | BaseEvent<
      "schedule:cancel",
      {
        callback: string;
        id: string;
      }
    >
  | BaseEvent<
      "schedule:retry",
      {
        callback: string;
        id: string;
        attempt: number;
        maxAttempts: number;
      }
    >
  | BaseEvent<
      "schedule:error",
      {
        callback: string;
        id: string;
        error: string;
        attempts: number;
      }
    >
  | BaseEvent<
      "queue:create",
      {
        callback: string;
        id: string;
      }
    >
  | BaseEvent<
      "queue:retry",
      {
        callback: string;
        id: string;
        attempt: number;
        maxAttempts: number;
      }
    >
  | BaseEvent<
      "queue:error",
      {
        callback: string;
        id: string;
        error: string;
        attempts: number;
      }
    >
  | BaseEvent<"destroy">
  | BaseEvent<
      "connect",
      {
        connectionId: string;
      }
    >
  | BaseEvent<
      "disconnect",
      {
        connectionId: string;
        code: number;
        reason: string;
      }
    >
  | BaseEvent<
      "email:receive",
      {
        from: string;
        to: string;
        subject?: string;
      }
    >
  | BaseEvent<
      "email:reply",
      {
        from: string;
        to: string;
        subject?: string;
      }
    >
  | BaseEvent<
      "workflow:start",
      {
        workflowId: string;
        workflowName?: string;
      }
    >
  | BaseEvent<
      "workflow:event",
      {
        workflowId: string;
        eventType?: string;
      }
    >
  | BaseEvent<
      "workflow:approved",
      {
        workflowId: string;
        reason?: string;
      }
    >
  | BaseEvent<
      "workflow:rejected",
      {
        workflowId: string;
        reason?: string;
      }
    >
  | BaseEvent<
      "workflow:terminated",
      {
        workflowId: string;
        workflowName?: string;
      }
    >
  | BaseEvent<
      "workflow:paused",
      {
        workflowId: string;
        workflowName?: string;
      }
    >
  | BaseEvent<
      "workflow:resumed",
      {
        workflowId: string;
        workflowName?: string;
      }
    >
  | BaseEvent<
      "workflow:restarted",
      {
        workflowId: string;
        workflowName?: string;
      }
    >;
//#endregion
//#region ../agents/src/observability/workspace.d.ts
/**
 * Workspace-specific observability events.
 * These track file operations, directory changes, and bash execution
 * within a Workspace instance.
 */
type WorkspaceObservabilityEvent =
  | BaseEvent<
      "workspace:read",
      {
        namespace: string;
        path: string;
        storage: "inline" | "r2";
      }
    >
  | BaseEvent<
      "workspace:write",
      {
        namespace: string;
        path: string;
        size: number;
        storage: "inline" | "r2";
        update: boolean;
      }
    >
  | BaseEvent<
      "workspace:delete",
      {
        namespace: string;
        path: string;
      }
    >
  | BaseEvent<
      "workspace:mkdir",
      {
        namespace: string;
        path: string;
        recursive: boolean;
      }
    >
  | BaseEvent<
      "workspace:rm",
      {
        namespace: string;
        path: string;
        recursive: boolean;
      }
    >
  | BaseEvent<
      "workspace:cp",
      {
        namespace: string;
        src: string;
        dest: string;
        recursive: boolean;
      }
    >
  | BaseEvent<
      "workspace:mv",
      {
        namespace: string;
        src: string;
        dest: string;
      }
    >
  | BaseEvent<
      "workspace:bash",
      {
        namespace: string;
        command: string;
        exitCode: number;
        durationMs: number;
      }
    >
  | BaseEvent<
      "workspace:error",
      {
        namespace: string;
        operation: string;
        path: string;
        error: string;
      }
    >;
//#endregion
//#region ../agents/src/observability/index.d.ts
/**
 * Union of all observability event types from different domains
 */
type ObservabilityEvent =
  | AgentObservabilityEvent
  | MCPObservabilityEvent
  | WorkspaceObservabilityEvent;
interface Observability {
  /**
   * Emit an event for the Agent's observability implementation to handle.
   * @param event - The event to emit
   */
  emit(event: ObservabilityEvent): void;
}
//#endregion
//#region ../agents/src/index.d.ts
/**
 * Metadata for a callable method
 */
type CallableMetadata = {
  /** Optional description of what the method does */ description?: string /** Whether the method supports streaming responses */;
  streaming?: boolean;
};
/**
 * Constructor type for a sub-agent class.
 * Used by {@link Agent.subAgent} to reference the child class
 * via `ctx.exports`.
 *
 * The class name (`cls.name`) must match the export name in the
 * worker entry point — re-exports under a different name
 * (e.g. `export { Foo as Bar }`) are not supported.
 */
type SubAgentClass<T extends Agent = Agent> = {
  new (ctx: DurableObjectState, env: never): T;
};
/**
 * Wraps `T` in a `Promise` unless it already is one.
 */
type Promisify<T> = T extends Promise<unknown> ? T : Promise<T>;
/**
 * A typed RPC stub for a sub-agent. Exposes all public instance methods
 * as callable RPC methods with Promise-wrapped return types.
 *
 * Methods inherited from `Agent` / `Server` / `DurableObject` internals
 * are excluded — only user-defined methods on the subclass are exposed.
 */
type SubAgentStub<T extends Agent> = {
  [K in keyof T as K extends keyof Agent
    ? never
    : T[K] extends (...args: never[]) => unknown
      ? K
      : never]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promisify<R>
    : never;
};
type QueueItem<T = string> = {
  id: string;
  payload: T;
  callback: keyof Agent<Cloudflare.Env>;
  created_at: number;
  retry?: RetryOptions;
};
/**
 * Represents a scheduled task within an Agent
 * @template T Type of the payload data
 */
type Schedule<T = string> = {
  /** Unique identifier for the schedule */ id: string /** Name of the method to be called */;
  callback: string /** Data to be passed to the callback */;
  payload: T /** Retry options for callback execution */;
  retry?: RetryOptions;
} & (
  | {
      /** Type of schedule for one-time execution at a specific time */ type: "scheduled" /** Timestamp when the task should execute */;
      time: number;
    }
  | {
      /** Type of schedule for delayed execution */ type: "delayed" /** Timestamp when the task should execute */;
      time: number /** Number of seconds to delay execution */;
      delayInSeconds: number;
    }
  | {
      /** Type of schedule for recurring execution based on cron expression */ type: "cron" /** Timestamp for the next execution */;
      time: number /** Cron expression defining the schedule */;
      cron: string;
    }
  | {
      /** Type of schedule for recurring execution at fixed intervals */ type: "interval" /** Timestamp for the next execution */;
      time: number /** Number of seconds between executions */;
      intervalSeconds: number;
    }
);
type MCPServersState = {
  servers: {
    [id: string]: MCPServer;
  };
  tools: (Tool$1 & {
    serverId: string;
  })[];
  prompts: (Prompt & {
    serverId: string;
  })[];
  resources: (Resource & {
    serverId: string;
  })[];
};
type MCPServer = {
  name: string;
  server_url: string;
  auth_url: string | null;
  state: MCPConnectionState /** May contain untrusted content from external OAuth providers. Escape appropriately for your output context. */;
  error: string | null;
  instructions: string | null;
  capabilities: ServerCapabilities | null;
};
/**
 * Options for adding an MCP server
 */
type AddMcpServerOptions = {
  /** OAuth callback host (auto-derived from request if omitted) */ callbackHost?: string;
  /**
   * Custom callback URL path — bypasses the default `/agents/{class}/{name}/callback` construction.
   * Required when `sendIdentityOnConnect` is `false` to prevent leaking the instance name.
   * When set, the callback URL becomes `{callbackHost}/{callbackPath}`.
   * The developer must route this path to the agent instance via `getAgentByName`.
   * Should be a plain path (e.g., `/mcp-callback`) — do not include query strings or fragments.
   */
  callbackPath?: string /** Agents routing prefix (default: "agents") */;
  agentsPrefix?: string /** MCP client options */;
  client?: ConstructorParameters<typeof Client>[1] /** Transport options */;
  transport?: {
    /** Custom headers for authentication (e.g., bearer tokens, CF Access) */ headers?: HeadersInit /** Transport type: "sse", "streamable-http", or "auto" (default) */;
    type?: TransportType;
  } /** Retry options for connection and reconnection attempts */;
  retry?: RetryOptions;
};
/**
 * Options for adding an MCP server via RPC (Durable Object binding)
 */
type AddRpcMcpServerOptions = {
  /** Props to pass to the McpAgent instance */ props?: Record<string, unknown>;
};
/**
 * Configuration options for the Agent.
 * Override in subclasses via `static options`.
 * All fields are optional - defaults are applied at runtime.
 * Note: `hibernate` defaults to `true` if not specified.
 */
interface AgentStaticOptions {
  hibernate?: boolean;
  sendIdentityOnConnect?: boolean;
  hungScheduleTimeoutSeconds?: number;
  /** Default retry options for schedule(), queue(), and this.retry(). */
  retry?: RetryOptions;
}
/**
 * Extract string keys from Env where the value is a Workflow binding.
 */
type WorkflowBinding<E> = {
  [K in keyof E & string]: E[K] extends Workflow ? K : never;
}[keyof E & string];
/**
 * Type for workflow name parameter.
 * When Env has typed Workflow bindings, provides autocomplete for those keys.
 * Also accepts any string for dynamic use cases and compatibility.
 * The `string & {}` trick preserves autocomplete while allowing any string.
 */
type WorkflowName<E> = WorkflowBinding<E> | (string & {});
/**
 * Base class for creating Agent implementations
 * @template Env Environment type containing bindings
 * @template State State type to store within the Agent
 */
declare class Agent<
  Env extends Cloudflare.Env = Cloudflare.Env,
  State = unknown,
  Props extends Record<string, unknown> = Record<string, unknown>
> extends Server<Env, Props> {
  private _state;
  private _disposables;
  private _destroyed;
  /**
   * Stores raw state accessors for wrapped connections.
   * Used by internal flag methods (readonly, no-protocol) to read/write
   * _cf_-prefixed keys without going through the user-facing state/setState.
   */
  private _rawStateAccessors;
  /**
   * Cached persistence-hook dispatch mode, computed once in the constructor.
   * - "new"  → call onStateChanged
   * - "old"  → call onStateUpdate (deprecated)
   * - "none" → neither hook is overridden, skip entirely
   */
  private _persistenceHookMode;
  /** True when this agent runs as a facet (sub-agent) inside a parent. */
  private _isFacet;
  private _ParentClass;
  readonly mcp: MCPClientManager;
  /**
   * Initial state for the Agent
   * Override to provide default state values
   */
  initialState: State;
  /**
   * Current state of the Agent
   */
  get state(): State;
  /**
   * Agent configuration options.
   * Override in subclasses - only specify what you want to change.
   * @example
   * class SecureAgent extends Agent {
   *   static options = { sendIdentityOnConnect: false };
   * }
   */
  static options: AgentStaticOptions;
  /**
   * Resolved options (merges defaults with subclass overrides).
   * Cached after first access — static options never change during the
   * lifetime of a Durable Object instance.
   */
  private _cachedOptions?;
  private get _resolvedOptions();
  /**
   * The observability implementation to use for the Agent
   */
  observability?: Observability;
  /**
   * Emit an observability event with auto-generated timestamp.
   * @internal
   */
  protected _emit(
    type: ObservabilityEvent["type"],
    payload?: Record<string, unknown>
  ): void;
  /**
   * Execute SQL queries against the Agent's database
   * @template T Type of the returned rows
   * @param strings SQL query template strings
   * @param values Values to be inserted into the query
   * @returns Array of query results
   */
  sql<T = Record<string, string | number | boolean | null>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ): T[];
  /**
   * Create all internal tables and run migrations if needed.
   * Called by the constructor on every wake. Idempotent — skips DDL when
   * the stored schema version matches CURRENT_SCHEMA_VERSION.
   *
   * Protected so that test agents can re-run the real migration path
   * after manipulating DB state (since ctx.abort() is unavailable in
   * local dev and the constructor only runs once per DO instance).
   */
  protected _ensureSchema(): void;
  constructor(ctx: AgentContext, env: Env);
  /**
   * Check for workflows referencing unknown bindings and warn with migration suggestion.
   */
  private _checkOrphanedWorkflows;
  /**
   * Broadcast a protocol message only to connections that have protocol
   * messages enabled. Connections where shouldSendProtocolMessages returned
   * false are excluded automatically.
   * @param msg The JSON-encoded protocol message
   * @param excludeIds Additional connection IDs to exclude (e.g. the source)
   */
  private _broadcastProtocol;
  private _setStateInternal;
  /**
   * Update the Agent's state
   * @param state New state to set
   * @throws Error if called from a readonly connection context
   */
  setState(state: State): void;
  /**
   * Wraps connection.state and connection.setState so that internal
   * _cf_-prefixed flags (readonly, no-protocol) are hidden from user code
   * and cannot be accidentally overwritten.
   *
   * Idempotent — safe to call multiple times on the same connection.
   * After hibernation, the _rawStateAccessors WeakMap is empty but the
   * connection's state getter still reads from the persisted WebSocket
   * attachment. Calling this method re-captures the raw getter so that
   * predicate methods (isConnectionReadonly, isConnectionProtocolEnabled)
   * work correctly post-hibernation.
   */
  private _ensureConnectionWrapped;
  /**
   * Mark a connection as readonly or readwrite
   * @param connection The connection to mark
   * @param readonly Whether the connection should be readonly (default: true)
   */
  setConnectionReadonly(connection: Connection, readonly?: boolean): void;
  /**
   * Check if a connection is marked as readonly.
   *
   * Safe to call after hibernation — re-wraps the connection if the
   * in-memory accessor cache was cleared.
   * @param connection The connection to check
   * @returns True if the connection is readonly
   */
  isConnectionReadonly(connection: Connection): boolean;
  /**
   * ⚠️ INTERNAL — DO NOT USE IN APPLICATION CODE. ⚠️
   *
   * Read an internal `_cf_`-prefixed flag from the raw connection state,
   * bypassing the user-facing state wrapper that strips internal keys.
   *
   * This exists for framework mixins (e.g. voice) that need to persist
   * flags in the connection attachment across hibernation. Application
   * code should use `connection.state` and `connection.setState()` instead.
   *
   * @internal
   */
  _unsafe_getConnectionFlag(connection: Connection, key: string): unknown;
  /**
   * ⚠️ INTERNAL — DO NOT USE IN APPLICATION CODE. ⚠️
   *
   * Write an internal `_cf_`-prefixed flag to the raw connection state,
   * bypassing the user-facing state wrapper. The key must be registered
   * in `CF_INTERNAL_KEYS` so it is preserved across user `setState` calls
   * and hidden from `connection.state`.
   *
   * @internal
   */
  _unsafe_setConnectionFlag(
    connection: Connection,
    key: string,
    value: unknown
  ): void;
  /**
   * Override this method to determine if a connection should be readonly on connect
   * @param _connection The connection that is being established
   * @param _ctx Connection context
   * @returns True if the connection should be readonly
   */
  shouldConnectionBeReadonly(
    _connection: Connection,
    _ctx: ConnectionContext
  ): boolean;
  /**
   * Override this method to control whether protocol messages are sent to a
   * connection. Protocol messages include identity (CF_AGENT_IDENTITY), state
   * sync (CF_AGENT_STATE), and MCP server lists (CF_AGENT_MCP_SERVERS).
   *
   * When this returns `false` for a connection, that connection will not
   * receive any protocol text frames — neither on connect nor via broadcasts.
   * This is useful for binary-only clients (e.g. MQTT devices) that cannot
   * handle JSON text frames.
   *
   * The connection can still send and receive regular messages, use RPC, and
   * participate in all non-protocol communication.
   *
   * @param _connection The connection that is being established
   * @param _ctx Connection context (includes the upgrade request)
   * @returns True if protocol messages should be sent (default), false to suppress them
   */
  shouldSendProtocolMessages(
    _connection: Connection,
    _ctx: ConnectionContext
  ): boolean;
  /**
   * Check if a connection has protocol messages enabled.
   * Protocol messages include identity, state sync, and MCP server lists.
   *
   * Safe to call after hibernation — re-wraps the connection if the
   * in-memory accessor cache was cleared.
   * @param connection The connection to check
   * @returns True if the connection receives protocol messages
   */
  isConnectionProtocolEnabled(connection: Connection): boolean;
  /**
   * Mark a connection as having protocol messages disabled.
   * Called internally when shouldSendProtocolMessages returns false.
   */
  private _setConnectionNoProtocol;
  /**
   * Called before the Agent's state is persisted and broadcast.
   * Override to validate or reject an update by throwing an error.
   *
   * IMPORTANT: This hook must be synchronous.
   */
  validateStateChange(nextState: State, source: Connection | "server"): void;
  /**
   * Called after the Agent's state has been persisted and broadcast to all clients.
   * This is a notification hook — errors here are routed to onError and do not
   * affect state persistence or client broadcasts.
   *
   * @param state Updated state
   * @param source Source of the state update ("server" or a client connection)
   */
  onStateChanged(state: State | undefined, source: Connection | "server"): void;
  /**
   * @deprecated Renamed to `onStateChanged` — the behavior is identical.
   * `onStateUpdate` will be removed in the next major version.
   *
   * Called after the Agent's state has been persisted and broadcast to all clients.
   * This is a server-side notification hook. For the client-side state callback,
   * see the `onStateUpdate` option in `useAgent` / `AgentClient`.
   *
   * @param state Updated state
   * @param source Source of the state update ("server" or a client connection)
   */
  onStateUpdate(state: State | undefined, source: Connection | "server"): void;
  /**
   * Dispatch to the appropriate persistence hook based on the mode
   * cached in the constructor. No prototype walks at call time.
   */
  private _callStatePersistenceHook;
  /**
   * Called when the Agent receives an email via routeAgentEmail()
   * Override this method to handle incoming emails
   * @param email Email message to process
   */
  _onEmail(email: AgentEmail): Promise<void>;
  /**
   * Reply to an email
   * @param email The email to reply to
   * @param options Options for the reply
   * @param options.secret Secret for signing agent headers (enables secure reply routing).
   *   Required if the email was routed via createSecureReplyEmailResolver.
   *   Pass explicit `null` to opt-out of signing (not recommended for secure routing).
   * @returns void
   */
  replyToEmail(
    email: AgentEmail,
    options: {
      fromName: string;
      subject?: string | undefined;
      body: string;
      contentType?: string;
      headers?: Record<string, string>;
      secret?: string | null;
    }
  ): Promise<void>;
  private _tryCatch;
  /**
   * Automatically wrap custom methods with agent context
   * This ensures getCurrentAgent() works in all custom methods without decorators
   */
  private _autoWrapCustomMethods;
  onError(connection: Connection, error: unknown): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
  /**
   * Render content (not implemented in base class)
   */
  render(): void;
  /**
   * Retry an async operation with exponential backoff and jitter.
   * Retries on all errors by default. Use `shouldRetry` to bail early on non-retryable errors.
   *
   * @param fn The async function to retry. Receives the current attempt number (1-indexed).
   * @param options Retry configuration.
   * @param options.maxAttempts Maximum number of attempts (including the first). Falls back to static options, then 3.
   * @param options.baseDelayMs Base delay in ms for exponential backoff. Falls back to static options, then 100.
   * @param options.maxDelayMs Maximum delay cap in ms. Falls back to static options, then 3000.
   * @param options.shouldRetry Predicate called with the error and next attempt number. Return false to stop retrying immediately. Default: retry all errors.
   * @returns The result of fn on success.
   * @throws The last error if all attempts fail or shouldRetry returns false.
   */
  retry<T>(
    fn: (attempt: number) => Promise<T>,
    options?: RetryOptions & {
      /** Return false to stop retrying a specific error. Receives the error and the next attempt number. Default: retry all errors. */ shouldRetry?: (
        err: unknown,
        nextAttempt: number
      ) => boolean;
    }
  ): Promise<T>;
  /**
   * Queue a task to be executed in the future
   * @param callback Name of the method to call
   * @param payload Payload to pass to the callback
   * @param options Options for the queued task
   * @param options.retry Retry options for the callback execution
   * @returns The ID of the queued task
   */
  queue<T = unknown>(
    callback: keyof this,
    payload: T,
    options?: {
      retry?: RetryOptions;
    }
  ): Promise<string>;
  private _flushingQueue;
  private _flushQueue;
  /**
   * Dequeue a task by ID
   * @param id ID of the task to dequeue
   */
  dequeue(id: string): void;
  /**
   * Dequeue all tasks
   */
  dequeueAll(): void;
  /**
   * Dequeue all tasks by callback
   * @param callback Name of the callback to dequeue
   */
  dequeueAllByCallback(callback: string): void;
  /**
   * Get a queued task by ID
   * @param id ID of the task to get
   * @returns The task or undefined if not found
   */
  getQueue(id: string): QueueItem<string> | undefined;
  /**
   * Get all queues by key and value
   * @param key Key to filter by
   * @param value Value to filter by
   * @returns Array of matching QueueItem objects
   */
  getQueues(key: string, value: string): QueueItem<string>[];
  /**
   * Schedule a task to be executed in the future
   * @template T Type of the payload data
   * @param when When to execute the task (Date, seconds delay, or cron expression)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @param options Options for the scheduled task
   * @param options.retry Retry options for the callback execution
   * @returns Schedule object representing the scheduled task
   */
  schedule<T = string>(
    when: Date | string | number,
    callback: keyof this,
    payload?: T,
    options?: {
      retry?: RetryOptions;
    }
  ): Promise<Schedule<T>>;
  /**
   * Schedule a task to run repeatedly at a fixed interval.
   *
   * This method is **idempotent** — calling it multiple times with the same
   * `callback`, `intervalSeconds`, and `payload` returns the existing schedule
   * instead of creating a duplicate. A different interval or payload is
   * treated as a distinct schedule and creates a new row.
   *
   * This makes it safe to call in `onStart()`, which runs on every Durable
   * Object wake:
   *
   * ```ts
   * async onStart() {
   *   // Only one schedule is created, no matter how many times the DO wakes
   *   await this.scheduleEvery(30, "tick");
   * }
   * ```
   *
   * @template T Type of the payload data
   * @param intervalSeconds Number of seconds between executions
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @param options Options for the scheduled task
   * @param options.retry Retry options for the callback execution
   * @returns Schedule object representing the scheduled task
   */
  scheduleEvery<T = string>(
    intervalSeconds: number,
    callback: keyof this,
    payload?: T,
    options?: {
      retry?: RetryOptions;
      _idempotent?: boolean;
    }
  ): Promise<Schedule<T>>;
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  getSchedule<T = string>(id: string): Schedule<T> | undefined;
  /**
   * Get scheduled tasks matching the given criteria
   * @template T Type of the payload data
   * @param criteria Criteria to filter schedules
   * @returns Array of matching Schedule objects
   */
  getSchedules<T = string>(criteria?: {
    id?: string;
    type?: "scheduled" | "delayed" | "cron" | "interval";
    timeRange?: {
      start?: Date;
      end?: Date;
    };
  }): Schedule<T>[];
  /**
   * Cancel a scheduled task
   * @param id ID of the task to cancel
   * @returns true if the task was cancelled, false if the task was not found
   */
  cancelSchedule(id: string): Promise<boolean>;
  /**
   * Keep the Durable Object alive via alarm heartbeats.
   * Returns a disposer function that stops the heartbeat when called.
   *
   * Use this when you have long-running work and need to prevent the
   * DO from going idle (eviction after ~70-140s of inactivity).
   * The heartbeat fires every 30 seconds via the scheduling system.
   *
   * @experimental This API may change between releases.
   *
   * @example
   * ```ts
   * const dispose = await this.keepAlive();
   * try {
   *   // ... long-running work ...
   * } finally {
   *   dispose();
   * }
   * ```
   */
  keepAlive(): Promise<() => void>;
  /**
   * Run an async function while keeping the Durable Object alive.
   * The heartbeat is automatically stopped when the function completes
   * (whether it succeeds or throws).
   *
   * This is the recommended way to use keepAlive — it guarantees cleanup
   * so you cannot forget to dispose the heartbeat.
   *
   * @experimental This API may change between releases.
   *
   * @example
   * ```ts
   * const result = await this.keepAliveWhile(async () => {
   *   const data = await longRunningComputation();
   *   return data;
   * });
   * ```
   */
  keepAliveWhile<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Internal no-op callback invoked by the keepAlive heartbeat schedule.
   * Its only purpose is to keep the DO alive — the alarm machinery
   * handles the rest.
   * @internal
   */
  _cf_keepAliveHeartbeat(): Promise<void>;
  private _scheduleNextAlarm;
  /**
   * Override PartyServer's onAlarm hook as a no-op.
   * Agent handles alarm logic directly in the alarm() method override,
   * but super.alarm() calls onAlarm() after #ensureInitialized(),
   * so we suppress the default "Implement onAlarm" warning.
   */
  onAlarm(): void;
  /**
   * Method called when an alarm fires.
   * Executes any scheduled tasks that are due.
   *
   * Calls super.alarm() first to ensure PartyServer's #ensureInitialized()
   * runs, which hydrates this.name from storage and calls onStart() if needed.
   *
   * @remarks
   * To schedule a task, please use the `this.schedule` method instead.
   * See {@link https://developers.cloudflare.com/agents/api-reference/schedule-tasks/}
   */
  alarm(): Promise<void>;
  /**
   * Marks this agent as running inside a facet (sub-agent). Once set,
   * scheduling methods throw a clear error instead of crashing on
   * `setAlarm()` (which is not supported in facets).
   * @internal
   */
  _cf_markAsFacet(): Promise<void>;
  /**
   * Get or create a named sub-agent — a child Durable Object (facet)
   * with its own isolated SQLite storage running on the same machine.
   *
   * The child class must extend `Agent` and be exported from the worker
   * entry point. The first call for a given name triggers the child's
   * `onStart()`. Subsequent calls return the existing instance.
   *
   * @experimental Requires the `"experimental"` compatibility flag.
   *
   * @param cls The Agent subclass (must be exported from the worker)
   * @param name Unique name for this child instance
   * @returns A typed RPC stub for calling methods on the child
   *
   * @example
   * ```typescript
   * const searcher = await this.subAgent(SearchAgent, "main-search");
   * const results = await searcher.search("cloudflare agents");
   * ```
   */
  subAgent<T extends Agent>(
    cls: SubAgentClass<T>,
    name: string
  ): Promise<SubAgentStub<T>>;
  /**
   * Forcefully abort a running sub-agent. The child stops executing
   * immediately and will be restarted on next {@link subAgent} call.
   * Pending RPC calls receive the reason as an error.
   * Transitively aborts the child's own children.
   *
   * @experimental Requires the `"experimental"` compatibility flag.
   *
   * @param cls The Agent subclass used when creating the child
   * @param name Name of the child to abort
   * @param reason Error thrown to pending/future RPC callers
   */
  abortSubAgent(cls: SubAgentClass, name: string, reason?: unknown): void;
  /**
   * Delete a sub-agent: abort it if running, then permanently wipe its
   * storage. Transitively deletes the child's own children.
   *
   * @experimental Requires the `"experimental"` compatibility flag.
   *
   * @param cls The Agent subclass used when creating the child
   * @param name Name of the child to delete
   */
  deleteSubAgent(cls: SubAgentClass, name: string): void;
  /**
   * Destroy the Agent, removing all state and scheduled tasks
   */
  destroy(): Promise<void>;
  /**
   * Check if a method is callable
   * @param method The method name to check
   * @returns True if the method is marked as callable
   */
  private _isCallable;
  /**
   * Get all methods marked as callable on this Agent
   * @returns A map of method names to their metadata
   */
  getCallableMethods(): Map<string, CallableMetadata>;
  /**
   * Start a workflow and track it in this Agent's database.
   * Automatically injects agent identity into the workflow params.
   *
   * @template P - Type of params to pass to the workflow
   * @param workflowName - Name of the workflow binding in env (e.g., 'MY_WORKFLOW')
   * @param params - Params to pass to the workflow
   * @param options - Optional workflow options
   * @returns The workflow instance ID
   *
   * @example
   * ```typescript
   * const workflowId = await this.runWorkflow(
   *   'MY_WORKFLOW',
   *   { taskId: '123', data: 'process this' }
   * );
   * ```
   */
  runWorkflow<P = unknown>(
    workflowName: WorkflowName<Env>,
    params: P,
    options?: RunWorkflowOptions
  ): Promise<string>;
  /**
   * Send an event to a running workflow.
   * The workflow can wait for this event using step.waitForEvent().
   *
   * @param workflowName - Name of the workflow binding in env (e.g., 'MY_WORKFLOW')
   * @param workflowId - ID of the workflow instance
   * @param event - Event to send
   *
   * @example
   * ```typescript
   * await this.sendWorkflowEvent(
   *   'MY_WORKFLOW',
   *   workflowId,
   *   { type: 'approval', payload: { approved: true } }
   * );
   * ```
   */
  sendWorkflowEvent(
    workflowName: WorkflowName<Env>,
    workflowId: string,
    event: WorkflowEventPayload
  ): Promise<void>;
  /**
   * Approve a waiting workflow.
   * Sends an approval event to the workflow that can be received by waitForApproval().
   *
   * @param workflowId - ID of the workflow to approve
   * @param data - Optional approval data (reason, metadata)
   *
   * @example
   * ```typescript
   * await this.approveWorkflow(workflowId, {
   *   reason: 'Approved by admin',
   *   metadata: { approvedBy: userId }
   * });
   * ```
   */
  approveWorkflow(
    workflowId: string,
    data?: {
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void>;
  /**
   * Reject a waiting workflow.
   * Sends a rejection event to the workflow that will cause waitForApproval() to throw.
   *
   * @param workflowId - ID of the workflow to reject
   * @param data - Optional rejection data (reason)
   *
   * @example
   * ```typescript
   * await this.rejectWorkflow(workflowId, {
   *   reason: 'Request denied by admin'
   * });
   * ```
   */
  rejectWorkflow(
    workflowId: string,
    data?: {
      reason?: string;
    }
  ): Promise<void>;
  /**
   * Terminate a running workflow.
   * This immediately stops the workflow and sets its status to "terminated".
   *
   * @param workflowId - ID of the workflow to terminate (must be tracked via runWorkflow)
   * @throws Error if workflow not found in tracking table
   * @throws Error if workflow binding not found in environment
   * @throws Error if workflow is already completed/errored/terminated (from Cloudflare)
   *
   * @note `terminate()` is not yet supported in local development (wrangler dev).
   * It will throw an error locally but works when deployed to Cloudflare.
   *
   * @example
   * ```typescript
   * await this.terminateWorkflow(workflowId);
   * ```
   */
  terminateWorkflow(workflowId: string): Promise<void>;
  /**
   * Pause a running workflow.
   * The workflow can be resumed later with resumeWorkflow().
   *
   * @param workflowId - ID of the workflow to pause (must be tracked via runWorkflow)
   * @throws Error if workflow not found in tracking table
   * @throws Error if workflow binding not found in environment
   * @throws Error if workflow is not running (from Cloudflare)
   *
   * @note `pause()` is not yet supported in local development (wrangler dev).
   * It will throw an error locally but works when deployed to Cloudflare.
   *
   * @example
   * ```typescript
   * await this.pauseWorkflow(workflowId);
   * ```
   */
  pauseWorkflow(workflowId: string): Promise<void>;
  /**
   * Resume a paused workflow.
   *
   * @param workflowId - ID of the workflow to resume (must be tracked via runWorkflow)
   * @throws Error if workflow not found in tracking table
   * @throws Error if workflow binding not found in environment
   * @throws Error if workflow is not paused (from Cloudflare)
   *
   * @note `resume()` is not yet supported in local development (wrangler dev).
   * It will throw an error locally but works when deployed to Cloudflare.
   *
   * @example
   * ```typescript
   * await this.resumeWorkflow(workflowId);
   * ```
   */
  resumeWorkflow(workflowId: string): Promise<void>;
  /**
   * Restart a workflow instance.
   * This re-runs the workflow from the beginning with the same ID.
   *
   * @param workflowId - ID of the workflow to restart (must be tracked via runWorkflow)
   * @param options - Optional settings
   * @param options.resetTracking - If true (default), resets created_at and clears error fields.
   *                                If false, preserves original timestamps.
   * @throws Error if workflow not found in tracking table
   * @throws Error if workflow binding not found in environment
   *
   * @note `restart()` is not yet supported in local development (wrangler dev).
   * It will throw an error locally but works when deployed to Cloudflare.
   *
   * @example
   * ```typescript
   * // Reset tracking (default)
   * await this.restartWorkflow(workflowId);
   *
   * // Preserve original timestamps
   * await this.restartWorkflow(workflowId, { resetTracking: false });
   * ```
   */
  restartWorkflow(
    workflowId: string,
    options?: {
      resetTracking?: boolean;
    }
  ): Promise<void>;
  /**
   * Find a workflow binding by its name.
   */
  private _findWorkflowBindingByName;
  /**
   * Get all workflow binding names from the environment.
   */
  private _getWorkflowBindingNames;
  /**
   * Get the status of a workflow and update the tracking record.
   *
   * @param workflowName - Name of the workflow binding in env (e.g., 'MY_WORKFLOW')
   * @param workflowId - ID of the workflow instance
   * @returns The workflow status
   */
  getWorkflowStatus(
    workflowName: WorkflowName<Env>,
    workflowId: string
  ): Promise<InstanceStatus>;
  /**
   * Get a tracked workflow by ID.
   *
   * @param workflowId - Workflow instance ID
   * @returns Workflow info or undefined if not found
   */
  getWorkflow(workflowId: string): WorkflowInfo | undefined;
  /**
   * Query tracked workflows with cursor-based pagination.
   *
   * @param criteria - Query criteria including optional cursor for pagination
   * @returns WorkflowPage with workflows, total count, and next cursor
   *
   * @example
   * ```typescript
   * // First page
   * const page1 = this.getWorkflows({ status: 'running', limit: 20 });
   *
   * // Next page
   * if (page1.nextCursor) {
   *   const page2 = this.getWorkflows({
   *     status: 'running',
   *     limit: 20,
   *     cursor: page1.nextCursor
   *   });
   * }
   * ```
   */
  getWorkflows(criteria?: WorkflowQueryCriteria): WorkflowPage;
  /**
   * Count workflows matching criteria (for pagination total).
   */
  private _countWorkflows;
  /**
   * Encode a cursor from workflow info for pagination.
   * Stores createdAt as Unix timestamp in seconds (matching DB storage).
   */
  private _encodeCursor;
  /**
   * Decode a pagination cursor.
   * Returns createdAt as Unix timestamp in seconds (matching DB storage).
   */
  private _decodeCursor;
  /**
   * Delete a workflow tracking record.
   *
   * @param workflowId - ID of the workflow to delete
   * @returns true if a record was deleted, false if not found
   */
  deleteWorkflow(workflowId: string): boolean;
  /**
   * Delete workflow tracking records matching criteria.
   * Useful for cleaning up old completed/errored workflows.
   *
   * @param criteria - Criteria for which workflows to delete
   * @returns Number of records matching criteria (expected deleted count)
   *
   * @example
   * ```typescript
   * // Delete all completed workflows created more than 7 days ago
   * const deleted = this.deleteWorkflows({
   *   status: 'complete',
   *   createdBefore: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
   * });
   *
   * // Delete all errored and terminated workflows
   * const deleted = this.deleteWorkflows({
   *   status: ['errored', 'terminated']
   * });
   * ```
   */
  deleteWorkflows(
    criteria?: Omit<WorkflowQueryCriteria, "limit" | "orderBy"> & {
      createdBefore?: Date;
    }
  ): number;
  /**
   * Migrate workflow tracking records from an old binding name to a new one.
   * Use this after renaming a workflow binding in wrangler.toml.
   *
   * @param oldName - Previous workflow binding name
   * @param newName - New workflow binding name
   * @returns Number of records migrated
   *
   * @example
   * ```typescript
   * // After renaming OLD_WORKFLOW to NEW_WORKFLOW in wrangler.toml
   * async onStart() {
   *   const migrated = this.migrateWorkflowBinding('OLD_WORKFLOW', 'NEW_WORKFLOW');
   * }
   * ```
   */
  migrateWorkflowBinding(oldName: string, newName: string): number;
  /**
   * Update workflow tracking record from InstanceStatus
   */
  private _updateWorkflowTracking;
  /**
   * Convert a database row to WorkflowInfo
   */
  private _rowToWorkflowInfo;
  /**
   * Find the binding name for this Agent's namespace by matching class name.
   * Returns undefined if no match found - use options.agentBinding as fallback.
   */
  private _findAgentBindingName;
  private _findBindingNameForNamespace;
  private _restoreRpcMcpServers;
  /**
   * Handle a callback from a workflow.
   * Called when the Agent receives a callback at /_workflow/callback.
   * Override this to handle all callback types in one place.
   *
   * @param callback - The callback payload
   */
  onWorkflowCallback(callback: WorkflowCallback): Promise<void>;
  /**
   * Called when a workflow reports progress.
   * Override to handle progress updates.
   *
   * @param workflowName - Workflow binding name
   * @param workflowId - ID of the workflow
   * @param progress - Typed progress data (default: DefaultProgress)
   */
  onWorkflowProgress(
    workflowName: string,
    workflowId: string,
    progress: unknown
  ): Promise<void>;
  /**
   * Called when a workflow completes successfully.
   * Override to handle completion.
   *
   * @param workflowName - Workflow binding name
   * @param workflowId - ID of the workflow
   * @param result - Optional result data
   */
  onWorkflowComplete(
    workflowName: string,
    workflowId: string,
    result?: unknown
  ): Promise<void>;
  /**
   * Called when a workflow encounters an error.
   * Override to handle errors.
   *
   * @param workflowName - Workflow binding name
   * @param workflowId - ID of the workflow
   * @param error - Error message
   */
  onWorkflowError(
    workflowName: string,
    workflowId: string,
    error: string
  ): Promise<void>;
  /**
   * Called when a workflow sends a custom event.
   * Override to handle custom events.
   *
   * @param workflowName - Workflow binding name
   * @param workflowId - ID of the workflow
   * @param event - Custom event payload
   */
  onWorkflowEvent(
    workflowName: string,
    workflowId: string,
    event: unknown
  ): Promise<void>;
  /**
   * Handle a workflow callback via RPC.
   * @internal - Called by AgentWorkflow, do not call directly
   */
  _workflow_handleCallback(callback: WorkflowCallback): Promise<void>;
  /**
   * Broadcast a message to all connected clients via RPC.
   * @internal - Called by AgentWorkflow, do not call directly
   */
  _workflow_broadcast(message: unknown): Promise<void>;
  /**
   * Update agent state via RPC.
   * @internal - Called by AgentWorkflow, do not call directly
   */
  _workflow_updateState(
    action: "set" | "merge" | "reset",
    state?: unknown
  ): Promise<void>;
  /**
   * Connect to a new MCP Server via RPC (Durable Object binding)
   *
   * The binding name and props are persisted to storage so the connection
   * is automatically restored after Durable Object hibernation.
   *
   * @example
   * await this.addMcpServer("counter", env.MY_MCP);
   * await this.addMcpServer("counter", env.MY_MCP, { props: { userId: "123" } });
   */
  addMcpServer<T extends McpAgent>(
    serverName: string,
    binding: DurableObjectNamespace<T>,
    options?: AddRpcMcpServerOptions
  ): Promise<{
    id: string;
    state: typeof MCPConnectionState.READY;
  }>;
  /**
   * Connect to a new MCP Server via HTTP (SSE or Streamable HTTP)
   *
   * @example
   * await this.addMcpServer("github", "https://mcp.github.com");
   * await this.addMcpServer("github", "https://mcp.github.com", { transport: { type: "sse" } });
   * await this.addMcpServer("github", url, callbackHost, agentsPrefix, options); // legacy
   */
  addMcpServer(
    serverName: string,
    url: string,
    callbackHostOrOptions?: string | AddMcpServerOptions,
    agentsPrefix?: string,
    options?: {
      client?: ConstructorParameters<typeof Client>[1];
      transport?: {
        headers?: HeadersInit;
        type?: TransportType;
      };
    }
  ): Promise<
    | {
        id: string;
        state: typeof MCPConnectionState.AUTHENTICATING;
        authUrl: string;
      }
    | {
        id: string;
        state: typeof MCPConnectionState.READY;
      }
  >;
  removeMcpServer(id: string): Promise<void>;
  getMcpServers(): MCPServersState;
  /**
   * Create the OAuth provider used when connecting to MCP servers that require authentication.
   *
   * Override this method in a subclass to supply a custom OAuth provider implementation,
   * for example to use pre-registered client credentials, mTLS-based authentication,
   * or any other OAuth flow beyond dynamic client registration.
   *
   * @example
   * // Custom OAuth provider
   * class MyAgent extends Agent {
   *   createMcpOAuthProvider(callbackUrl: string): AgentMcpOAuthProvider {
   *     return new MyCustomOAuthProvider(
   *       this.ctx.storage,
   *       this.name,
   *       callbackUrl
   *     );
   *   }
   * }
   *
   * @param callbackUrl The OAuth callback URL for the authorization flow
   * @returns An {@link AgentMcpOAuthProvider} instance used by {@link addMcpServer}
   */
  createMcpOAuthProvider(callbackUrl: string): AgentMcpOAuthProvider;
  private broadcastMcpServers;
  /**
   * Handle MCP OAuth callback request if it's an OAuth callback.
   *
   * This method encapsulates the entire OAuth callback flow:
   * 1. Checks if the request is an MCP OAuth callback
   * 2. Processes the OAuth code exchange
   * 3. Establishes the connection if successful
   * 4. Broadcasts MCP server state updates
   * 5. Returns the appropriate HTTP response
   *
   * @param request The incoming HTTP request
   * @returns Response if this was an OAuth callback, null otherwise
   */
  private handleMcpOAuthCallback;
  /**
   * Handle OAuth callback response using MCPClientManager configuration
   * @param result OAuth callback result
   * @param request The original request (needed for base URL)
   * @returns Response for the OAuth callback
   */
  private handleOAuthCallbackResponse;
}
/**
 * Agent's durable context
 */
type AgentContext = DurableObjectState;
//#endregion
//#region ../agents/src/serializable.d.ts
type SerializablePrimitive = undefined | null | string | number | boolean;
type NonSerializable =
  | Function
  | symbol
  | bigint
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Error
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;
type MaxDepth = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
type Increment<D extends unknown[]> = [0, ...D];
type IsMaxDepth<D extends unknown[]> = D["length"] extends MaxDepth["length"]
  ? true
  : false;
type CanSerialize<T, Seen = never, Depth extends unknown[] = []> =
  IsMaxDepth<Depth> extends true
    ? true
    : T extends Seen
      ? true
      : T extends SerializablePrimitive
        ? true
        : T extends NonSerializable
          ? false
          : T extends readonly (infer U)[]
            ? CanSerialize<U, Seen | T, Increment<Depth>>
            : T extends object
              ? unknown extends T
                ? true
                : {
                      [K in keyof T]: CanSerialize<
                        T[K],
                        Seen | T,
                        Increment<Depth>
                      >;
                    } extends { [K in keyof T]: true }
                  ? true
                  : false
              : true;
type CanSerializeReturn<T> = T extends void
  ? true
  : T extends Promise<infer U>
    ? CanSerialize<U>
    : CanSerialize<T>;
type IsSerializableParam<T, Seen = never, Depth extends unknown[] = []> =
  IsMaxDepth<Depth> extends true
    ? true
    : T extends Seen
      ? true
      : T extends SerializablePrimitive
        ? true
        : T extends NonSerializable
          ? false
          : T extends readonly (infer U)[]
            ? IsSerializableParam<U, Seen | T, Increment<Depth>>
            : T extends object
              ? unknown extends T
                ? true
                : {
                      [K in keyof T]: IsSerializableParam<
                        T[K],
                        Seen | T,
                        Increment<Depth>
                      >;
                    } extends { [K in keyof T]: true }
                  ? true
                  : false
              : true;
type AllSerializableValues<A> = A extends [infer First, ...infer Rest]
  ? IsSerializableParam<First> extends true
    ? AllSerializableValues<Rest>
    : false
  : true;
type Method = (...args: any[]) => any;
type IsUnknown<T> = [unknown] extends [T]
  ? [T] extends [unknown]
    ? true
    : false
  : false;
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
type RPCMethod<T = Method> = T extends Method
  ? T extends (...arg: infer A) => infer R
    ? AllSerializableValues<A> extends true
      ? CanSerializeReturn<R> extends true
        ? T
        : IsUnknown<UnwrapPromise<R>> extends true
          ? T
          : never
      : never
    : never
  : never;
//#endregion
//#region ../agents/src/client.d.ts
/**
 * Options for streaming RPC calls
 */
type StreamOptions = {
  /** Called when a chunk of data is received */ onChunk?: (
    chunk: unknown
  ) => void /** Called when the stream ends */;
  onDone?: (finalChunk: unknown) => void /** Called when an error occurs */;
  onError?: (error: string) => void;
};
//#endregion
//#region ../agents/src/react.d.ts
type QueryObject = Record<string, string | null>;
/**
 * Options for the useAgent hook
 * @template State Type of the Agent's state
 */
type UseAgentOptions<State = unknown> = Omit<
  Parameters<typeof usePartySocket>[0],
  "party" | "room" | "query"
> & {
  /** Name of the agent to connect to (ignored if basePath is set) */ agent: string /** Name of the specific Agent instance (ignored if basePath is set) */;
  name?: string;
  /**
   * Full URL path - bypasses agent/name URL construction.
   * When set, the client connects to this path directly.
   * Server must handle routing manually (e.g., with getAgentByName + fetch).
   * @example
   * // Client connects to /user, server routes based on session
   * useAgent({ agent: "UserAgent", basePath: "user" })
   */
  basePath?: string /** Query parameters - can be static object or async function */;
  query?:
    | QueryObject
    | (() => Promise<QueryObject>) /** Dependencies for async query caching */;
  queryDeps?: unknown[] /** Cache TTL in milliseconds for auth tokens/time-sensitive data */;
  cacheTtl?: number /** Called when the Agent's state is updated */;
  onStateUpdate?: (
    state: State,
    source: "server" | "client"
  ) => void /** Called when a state update fails (e.g., connection is readonly) */;
  onStateUpdateError?: (
    error: string
  ) => void /** Called when MCP server state is updated */;
  onMcpUpdate?: (mcpServers: MCPServersState) => void;
  /**
   * Called when the server sends the agent's identity on connect.
   * Useful when using basePath, as the actual instance name is determined server-side.
   * @param name The actual agent instance name
   * @param agent The agent class name (kebab-case)
   */
  onIdentity?: (name: string, agent: string) => void;
  /**
   * Called when identity changes on reconnect (different instance than before).
   * If not provided and identity changes, a warning will be logged.
   * @param oldName Previous instance name
   * @param newName New instance name
   * @param oldAgent Previous agent class name
   * @param newAgent New agent class name
   */
  onIdentityChange?: (
    oldName: string,
    newName: string,
    oldAgent: string,
    newAgent: string
  ) => void;
  /**
   * Additional path to append to the URL.
   * Works with both standard routing and basePath.
   * @example
   * // With basePath: /user/settings
   * { basePath: "user", path: "settings" }
   * // Standard: /agents/my-agent/room/settings
   * { agent: "MyAgent", name: "room", path: "settings" }
   */
  path?: string;
};
type AllOptional<T> = T extends [infer A, ...infer R]
  ? undefined extends A
    ? AllOptional<R>
    : false
  : true;
type RPCMethods<T> = {
  [K in keyof T as T[K] extends RPCMethod<T[K]> ? K : never]: RPCMethod<T[K]>;
};
type OptionalParametersMethod<T extends RPCMethod> =
  AllOptional<Parameters<T>> extends true ? T : never;
type AgentMethods<T> = Omit<RPCMethods<T>, keyof Agent<any, any>>;
type OptionalAgentMethods<T> = {
  [K in keyof AgentMethods<T> as AgentMethods<T>[K] extends OptionalParametersMethod<
    AgentMethods<T>[K]
  >
    ? K
    : never]: OptionalParametersMethod<AgentMethods<T>[K]>;
};
type RequiredAgentMethods<T> = Omit<
  AgentMethods<T>,
  keyof OptionalAgentMethods<T>
>;
type AgentPromiseReturnType<T, K extends keyof AgentMethods<T>> =
  ReturnType<AgentMethods<T>[K]> extends Promise<any>
    ? ReturnType<AgentMethods<T>[K]>
    : Promise<ReturnType<AgentMethods<T>[K]>>;
type OptionalArgsAgentMethodCall<AgentT> = <
  K extends keyof OptionalAgentMethods<AgentT>
>(
  method: K,
  args?: Parameters<OptionalAgentMethods<AgentT>[K]>,
  streamOptions?: StreamOptions
) => AgentPromiseReturnType<AgentT, K>;
type RequiredArgsAgentMethodCall<AgentT> = <
  K extends keyof RequiredAgentMethods<AgentT>
>(
  method: K,
  args: Parameters<RequiredAgentMethods<AgentT>[K]>,
  streamOptions?: StreamOptions
) => AgentPromiseReturnType<AgentT, K>;
type AgentMethodCall<AgentT> = OptionalArgsAgentMethodCall<AgentT> &
  RequiredArgsAgentMethodCall<AgentT>;
type UntypedAgentMethodCall = <T = unknown>(
  method: string,
  args?: unknown[],
  streamOptions?: StreamOptions
) => Promise<T>;
type AgentStub<T> = {
  [K in keyof AgentMethods<T>]: (
    ...args: Parameters<AgentMethods<T>[K]>
  ) => AgentPromiseReturnType<AgentMethods<T>, K>;
};
type UntypedAgentStub = Record<string, Method>;
/**
 * React hook for connecting to an Agent
 */
declare function useAgent<State = unknown>(
  options: UseAgentOptions<State>
): PartySocket & {
  agent: string;
  name: string;
  identified: boolean;
  ready: Promise<void>;
  setState: (state: State) => void;
  call: UntypedAgentMethodCall;
  stub: UntypedAgentStub;
};
declare function useAgent<
  AgentT extends {
    get state(): State;
  },
  State
>(
  options: UseAgentOptions<State>
): PartySocket & {
  agent: string;
  name: string;
  identified: boolean;
  ready: Promise<void>;
  setState: (state: State) => void;
  call: AgentMethodCall<AgentT>;
  stub: AgentStub<AgentT>;
};
//#endregion
//#region src/vue.d.ts
type GetInitialMessagesOptions = {
  agent: string;
  name: string;
  url: string;
};
type UseChatParams<M extends UIMessage = UIMessage> = ChatInit<M> &
  UseChatOptions<M>;
/**
 * Options for addToolOutput function
 */
type AddToolOutputOptions = {
  /** The ID of the tool call to provide output for */ toolCallId: string /** The name of the tool (optional, for type safety) */;
  toolName?: string /** The output to provide */;
  output?: unknown /** Override the tool part state (e.g. "output-error" for custom denial) */;
  state?:
    | "output-available"
    | "output-error" /** Error message when state is "output-error" */;
  errorText?: string;
};
/**
 * Options for the useAgentChat hook
 */
type UseAgentChatOptions<
  State,
  ChatMessage extends UIMessage = UIMessage
> = Omit<UseChatParams<ChatMessage>, "fetch" | "onToolCall"> & {
  /** Agent connection from useAgent */ agent: ReturnType<
    typeof useAgent<State>
  >;
  getInitialMessages?:
    | undefined
    | null
    | ((
        options: GetInitialMessagesOptions
      ) => Promise<ChatMessage[]>) /** Request credentials */;
  credentials?: RequestCredentials /** Request headers */;
  headers?: HeadersInit;
  /**
   * Callback for handling client-side tool execution.
   * Called when a tool without server-side `execute` is invoked by the LLM.
   *
   * Use this for:
   * - Tools that need browser APIs (geolocation, camera, etc.)
   * - Tools that need user interaction before providing a result
   * - Tools requiring approval before execution
   *
   * @example
   * ```typescript
   * onToolCall: async ({ toolCall, addToolOutput }) => {
   *   if (toolCall.toolName === 'getLocation') {
   *     const position = await navigator.geolocation.getCurrentPosition();
   *     addToolOutput({
   *       toolCallId: toolCall.toolCallId,
   *       output: { lat: position.coords.latitude, lng: position.coords.longitude }
   *     });
   *   }
   * }
   * ```
   */
  onToolCall?: OnToolCallCallback;
  /**
   * @deprecated Use `onToolCall` callback instead for automatic tool execution.
   * @description Whether to automatically resolve tool calls that do not require human interaction.
   * @experimental
   */
  experimental_automaticToolResolution?: boolean;
  /**
   * Tools that can be executed on the client. Tool schemas are automatically
   * sent to the server and tool calls are routed back for client execution.
   *
   * **For most apps**, define tools on the server with `tool()` from `"ai"`
   * and handle client-side execution via `onToolCall`. This gives you full
   * Zod type safety and keeps tool definitions in one place.
   *
   * **For SDKs and platforms** where tools are defined dynamically by the
   * embedding application at runtime, this option lets the client register
   * tools the server does not know about at deploy time.
   */
  tools?: Record<string, AITool<unknown, unknown>>;
  /**
   * @deprecated Use `needsApproval` on server-side tools instead.
   * @description Manual override for tools requiring confirmation.
   * If not provided, will auto-detect from tools object (tools without execute require confirmation).
   */
  toolsRequiringConfirmation?: string[];
  /**
   * When true (default), the server automatically continues the conversation
   * after receiving client-side tool results or approvals, similar to how
   * server-executed tools work with maxSteps in streamText. The continuation
   * is merged into the same assistant message.
   *
   * When false, the client must call sendMessage() after tool results
   * to continue the conversation, which creates a new assistant message.
   *
   * @default true
   */
  autoContinueAfterToolResult?: boolean;
  /**
   * @deprecated Use `sendAutomaticallyWhen` from AI SDK instead.
   *
   * When true (default), automatically sends the next message only after
   * all pending confirmation-required tool calls have been resolved.
   * When false, sends immediately after each tool result.
   *
   * Only applies when `autoContinueAfterToolResult` is false.
   *
   * @default true
   */
  autoSendAfterAllConfirmationsResolved?: boolean;
  /**
   * Set to false to disable automatic stream resumption.
   * @default true
   */
  resume?: boolean;
  /**
   * Custom data to include in every chat request body.
   * Accepts a static object or a function that returns one (for dynamic values).
   * These fields are available in `onChatMessage` via `options.body`.
   *
   * @example
   * ```typescript
   * // Static
   * body: { timezone: "America/New_York", userId: "abc" }
   *
   * // Dynamic (called on each send)
   * body: () => ({ token: getAuthToken(), timestamp: Date.now() })
   * ```
   */
  body?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  /**
   * Callback to customize the request before sending messages.
   * For most cases, use the `body` option instead.
   * Use this for advanced scenarios that need access to the messages or trigger type.
   *
   * Note: Client tool schemas are automatically sent when tools have `execute` functions.
   * This callback can add additional data alongside the auto-extracted schemas.
   */
  prepareSendMessagesRequest?: (
    options: PrepareSendMessagesRequestOptions<ChatMessage>
  ) =>
    | PrepareSendMessagesRequestResult
    | Promise<PrepareSendMessagesRequestResult>;
};
/**
 * Vue 3 composable for building AI chat interfaces using an Agent
 * @param options Chat options including the agent connection
 * @returns Chat interface controls and state with added clearHistory method
 */
declare function useAgentChat<
  State = unknown,
  ChatMessage extends UIMessage = UIMessage
>(
  options: UseAgentChatOptions<State, ChatMessage>
): {
  messages: vue.ComputedRef<ChatMessage[]>;
  status: vue.ComputedRef<ai.ChatStatus>;
  error: vue.ComputedRef<Error | undefined>;
  sendMessage: (text?: string) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
  addToolOutput: (opts: AddToolOutputOptions) => void;
  addToolResult: (args: any) => Promise<void>;
  addToolApprovalResponse: (args: any) => void | PromiseLike<void>;
  clearHistory: () => void;
  setMessages: (
    messagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void;
};
//#endregion
export { useAgentChat };
//# sourceMappingURL=vue.d.ts.map
