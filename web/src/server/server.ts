/**
 * A very simple API to autorize transfers for the demo web app.
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
}

/**
 * Configuration file.
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
if (!topFolder || !fs.statSync(topFolder).isDirectory()) {
  throw new Error(`Parameter is not a folder: ${topFolder}`);
}
/** Location of static files */
const publicFolder = process.argv[3];
if (!publicFolder || !fs.statSync(publicFolder).isDirectory()) {
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
    res.type("application/json");
    res.send(JSON.stringify(config));
  }
);

app.post(
  "/api/tspec",
  async (req: Request<{}, {}, TSpecRequestBody>, res: Response) => {
    try {
      const { operation, sources, destination, basic_token } = req.body;

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

      const basicAuth =
        "Basic " +
        Buffer.from(
          `${config.node.username}:${config.node.password}`
        ).toString("base64");

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

app.use(express.static(publicFolder));

// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(config.web.port, () => {
  console.log(`Server running at http://localhost:${config.web.port}`);
});