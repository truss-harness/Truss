## Truss Local Agentic Harness: Master Specification

### System Overview
A single-user localhost application serving as an agentic harness. Designed for safety, clean code execution, and ease of use with a custom markdown rendering engine to support interactive visuals.

### Core Technology Stack
#### Frontend Architecture
React optimized for code-generation models, managing state for complex nested sub-agents and dynamic tool interfaces.

#### Backend Infrastructure
TypeScript executed via the Bun runtime for fast startup and native compilation capabilities.

#### Communication Protocol
Server-Sent Events for downstream streaming and standard HTTP POST via the Fetch API for upstream commands.

#### Styling Framework
Tailwind CSS for responsive layout design and UI component styling, with SCSS preprocessing for authored design tokens, mixins, and local component styles before Tailwind output generation.

### Distribution and Execution Modes
#### NPM Package Deployment
Executed via package managers using commands like `truss spawn` to open globally.

#### Scoped Execution
Can be restricted to specific workspace contexts using `truss spawn [directory path]`.

#### Compiled Application
Packaged as a standalone executable using Bun, capable of running as a background Windows 11 service. (And similar on other Mac or Linux)

#### Server Initialization Behavior
Dynamically allocates an available local port, starts the backend web server, serves static React assets, and automatically opens the user's default browser.

### Application Data Flow
#### Upstream Command Handling
Standard HTTP POST requests transmit user inputs, configuration changes, and tool resolutions from the browser to the backend.

#### Downstream Token Streaming
The native `EventSource` API handles unidirectional streams for text generation and agent state updates from the local backend to the frontend.

#### Dynamic Markdown Rendering
A custom parsing engine renders standard markdown while identifying and embedding interactive UI elements dynamically.

#### Backend Processing
The Bun server runs the main agentic loop, processes CLI arguments, manages file system access, and orchestrates the Server-Sent Events endpoint.

### Custom Tooling Architecture
#### Backend Interception Layer
The TypeScript backend defines JSON schemas for LLM tools. When invoked, the backend pauses the agentic loop instead of resolving immediately.

#### Standardized Event Payload
The backend constructs a JSON envelope containing the tool identifier and arguments, pushing it down the stream categorized specifically as a tool event.

#### Frontend Component Registry
A React dictionary maps incoming tool identifiers to specific UI elements like progress bars or interactive clarification prompts. The frontend dynamically injects these components using the payload arguments as React props.

#### Callback Resolution Flow
Interactive components manage local state until submission. The frontend then sends a POST request with the execution ID and user payload back to the backend, which injects the data into the LLM context to resume generation.

### Model Context Protocol and Skills
#### MCP Host Integration
The backend functions as an MCP Host and Client, capable of routing JSON-RPC 2.0 messages to standardized community servers. MCP tools, prompts, and resources should be supported. When Triss is started (spawned) then it should scan the directory for Claude, Junie, Github Copilot or Codex type MCP Servers and offer to add them to the workspace.

#### Supported Transport Layers
Implements `stdio` transport for launching local MCP binaries and HTTP with SSE for connecting to remote MCP services. The backend should authenticate using an API key, but also should support OAuth2 Authorization Code and Client Credentials grant flows.

#### Skill Auto-loading System
Parses community-standard `SKILL.md` files from local `.skills` directories to inject specialized instructions, templates, and best practices directly into the active prompt.

#### Capability Negotiation
Discovers tools, resources, and prompt templates from connected MCP servers upon initialization, while pruning inactive skills to preserve context window limits.

### Configuration
A single SQLite database stores the user's configuration, conversations, and agentic sessions. Conversation rows include the working directory selected by `truss spawn [directory path]` so scoped launches can filter to that directory, while unscoped launches can access all conversations. A .env file (encrypted using dotenvx) should be used to store sensitive information like API keys.
