/**
 * A very simple API to authorize transfers for the demo web app.
 */

import express, { Request, Response } from "express";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { Agent, setGlobalDispatcher } from "undici";

// --------------------------------------------------
// Types
// --------------------------------------------------

type Operation = "upload" | "download";

interface TSpecRequestBody {
  operation: Operation;
  sources: string[];
  destination?: string;
  basic_token?: boolean;
  basic_access_key?: string;
  basic_secret?: string;
}

/**
 * Configuration file: the values that this app uses.
 */
interface ServerConfig {
  web: {
    port: number;
  };
  node: {
    url: string;
    username: string;
    password: string;
    verify: boolean;
  };
  server?: {
    url?: string;
    username?: string;
    file_download?: string;
    folder_upload?: string;
  };
  httpgw?: {
    url?: string;
  };
}

/**
 * Values of the configuration that the browser needs: no secret.
 */
interface ClientConfig {
  httpgw: {
    url?: string;
  };
  server: {
    url?: string;
    username?: string;
    file_download?: string;
    folder_upload?: string;
  };
}

interface NodeApiTransferSpec {
  transfer_spec: any;
  error?: { user_message: string };
}

interface NodeApiResponse {
  transfer_specs: NodeApiTransferSpec[];
}
// --------------------------------------------------
// Argument validation
// --------------------------------------------------
/** Main repository folder */
const topFolder = process.argv[2];
if (!topFolder) {
  throw new Error(`Missing top folder parameter`);
}
if (!fs.existsSync(topFolder) || !fs.statSync(topFolder).isDirectory()) {
  throw new Error(`Parameter is not a folder: ${topFolder}`);
}
/** Location of static files */
const publicFolder = process.argv[3];
if (!publicFolder) {
  throw new Error(`Missing public folder parameter`);
}
if (!fs.existsSync(publicFolder) || !fs.statSync(publicFolder).isDirectory()) {
  throw new Error(`Parameter is not a folder: ${publicFolder}`);
}
console.log(`Using top folder: ${topFolder}`);
console.log(`Using public folder: ${publicFolder}`);

/** Build absolute path by adding topfolder to relative path */
function getAbsPath(relative: string): string {
  return path.join(topFolder, relative);
}

// --------------------------------------------------
// Load configuration
// --------------------------------------------------

/** Config file mapping names to relative paths in repository */
const paths = yaml.load(
  fs.readFileSync(getAbsPath("config/paths.yaml"), "utf8")
) as Record<string, string>;

/**
 * Get absolute path to file based on name
 * @param name path name in path reference file
 * @returns absolute path
 */
function getPath(name: string): string {
  return getAbsPath(paths[name]);
}

const config = yaml.load(
  fs.readFileSync(getPath("main_config"), "utf8")
) as ServerConfig;

/**
 * Allow-list of the values sent to the browser by `GET /api/config`.
 * Add a value only if the client uses it, and never a secret:
 * the Node API credentials stay in the server, and the user types the secrets of the test modes.
 */
const clientConfig: ClientConfig = {
  httpgw: {
    url: config.httpgw?.url,
  },
  server: {
    url: config.server?.url,
    username: config.server?.username,
    file_download: config.server?.file_download,
    folder_upload: config.server?.folder_upload,
  },
};

// --------------------------------------------------
// TLS override (test only)
// --------------------------------------------------

if (!config.node.verify) {
  setGlobalDispatcher(
    new Agent({
      connect: { rejectUnauthorized: false },
    })
  );
}

// --------------------------------------------------
// Express app
// --------------------------------------------------

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get(
  "/api/config",
  (req, res) => {
    res.json(clientConfig);
  }
);

app.post(
  "/api/tspec",
  async (req: Request<{}, {}, TSpecRequestBody>, res: Response) => {
    try {
      const { operation, sources, destination, basic_token, basic_access_key, basic_secret } = req.body;

      if (!operation || !sources || !Array.isArray(sources)) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const tsSourcePaths = sources.map((file) => ({ source: file }));

      /** payload for transfer spec request */
      let requestTs: { paths: any[] };

      if (operation === "upload") {
        if (!destination) {
          return res.status(400).json({ error: "Missing destination" });
        }
        requestTs = { paths: [{ destination }] };
      } else if (operation === "download") {
        requestTs = { paths: tsSourcePaths };
      } else {
        return res.status(400).json({ error: `Invalid operation: ${operation}` });
      }

      // Access control (step 3 of flow A2 in the guide): a real broker authenticates the user (session, OAuth, SSO),
      // checks that this user may download these `sources` or upload to this `destination`,
      // and rejects the request otherwise.
      // This demo has no user: it accepts any path, within the limits of the node user or access key.

      let nodeUser = config.node.username;
      let nodePass = config.node.password;
      if (basic_token) {
        // Basic token (test only): the user types the access key and its secret, and they return in the token.
        // Never use the node credentials of the configuration here: the browser would receive them.
        if (!basic_access_key || !basic_secret) {
          return res.status(400).json({ error: "Missing access key or secret" });
        }
        nodeUser = basic_access_key;
        nodePass = basic_secret;
      }
      const basicAuth =
        "Basic " +
        Buffer.from(`${nodeUser}:${nodePass}`).toString("base64");

      // Call Aspera HSTS Node API for transfer authorization.
      const response = await fetch(
        `${config.node.url}/files/${operation}_setup`,
        {
          method: "POST",
          headers: {
            Authorization: basicAuth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transfer_requests: [{ transfer_request: requestTs }],
          }),
        }
      );

      if (!response.ok) {
        return res
          .status(500)
          .json({ error: `Node API: ${response.statusText}` });
      }

      const result = await response.json() as NodeApiResponse;

      const result0 = result.transfer_specs?.[0];
      if (!result0) {
        return res.status(500).json({ error: "Invalid Node API response" });
      }

      if (result0.error) {
        return res
          .status(500)
          .json({ error: result0.error.user_message });
      }

      /** Single transfer spec received */
      const transferSpec = result0.transfer_spec;
      transferSpec.paths = tsSourcePaths;

      if (basic_token) {
        transferSpec.token = basicAuth;
      }

      return res.json(transferSpec);
    } catch (error) {
      console.error("Server error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

let server: ReturnType<typeof app.listen>;

app.get("/", (req, res) => {
  const vitePort = 5173;
  const viteUrl = `http://localhost:${vitePort}`;
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Aspera Demo — API server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 10vh auto; padding: 0 1.5rem; color: #1f2328; }
    h1   { font-size: 1.25rem; margin-bottom: .5rem; }
    p    { color: #57606a; line-height: 1.6; }
    a    { color: #3b82d4; }
    code { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 4px; padding: 2px 6px; font-size: .9em; }
  </style>
</head>
<body>
  <h1>Aspera Demo — API server</h1>
  <p>This port (<code>${config.web.port}</code>) exposes the REST API only and serves no UI.</p>
  <p>Open the application at <a href="${viteUrl}">${viteUrl}</a> (Vite dev server).</p>
</body>
</html>`);
});

// Stop the server (used by the test in the Makefile).
// No authentication: the server listens on the local address only.
app.post("/api/shutdown", (req, res) => {
  res.json({ message: "Server shutting down" });
  setTimeout(() => {
    server.close(() => {
      process.exit(0);
    });
  }, 200);
});

app.use(express.static(publicFolder));

// --------------------------------------------------
// Start server
// --------------------------------------------------

// Local address only: this demo API has no user authentication.
// The Vite dev server proxies `/api` to this address.
const listenAddress = "127.0.0.1";
server = app.listen(config.web.port, listenAddress, () => {
  console.log(`API server listening on http://${listenAddress}:${config.web.port}`);
});
