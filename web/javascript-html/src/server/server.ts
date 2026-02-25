import express, { Request, Response } from "express";
import https from "https";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import assert from "assert";
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
  transfer_spec: any; // or a more specific type if you know it
  error?: { user_message: string };
}

interface NodeApiResponse {
  transfer_specs: NodeApiTransferSpec[];
}
// --------------------------------------------------
// Environment validation
// --------------------------------------------------

const dirTop = process.env.DIR_TOP;
if (!dirTop) {
  throw new Error("Environment variable DIR_TOP is not set.");
}

const topFolder = path.resolve(dirTop);

if (!fs.existsSync(topFolder) || !fs.statSync(topFolder).isDirectory()) {
  throw new Error(`DIR_TOP is invalid: ${topFolder}`);
}

function getAbsPath(relative: string): string {
  return path.join(topFolder, relative);
}

// --------------------------------------------------
// Load configuration
// --------------------------------------------------

const paths = yaml.load(
  fs.readFileSync(getAbsPath("config/paths.yaml"), "utf8")
) as Record<string, string>;

function getPath(name: string): string {
  return getAbsPath(paths[name]);
}

const config = yaml.load(
  fs.readFileSync(getPath("main_config"), "utf8")
) as ServerConfig;

const httpPort = config.web.port;

const publicFolder = process.argv[2];
if (!publicFolder || !fs.statSync(publicFolder).isDirectory()) {
  throw new Error(`Parameter is not a folder: ${publicFolder}`);
}


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

// Serve a static "virtual" file at /client.js
app.get("/api/config", (req, res) => {
  res.type("application/json");
  res.send(JSON.stringify(config));
});

// --------------------------------------------------
// API: /tspec
// --------------------------------------------------

app.post(
  "/api/tspec",
  async (req: Request<{}, {}, TSpecRequestBody>, res: Response) => {
    try {
      const { operation, sources, destination, basic_token } = req.body;

      if (!operation || !sources || !Array.isArray(sources)) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const tsSourcePaths = sources.map((file) => ({ source: file }));

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

app.listen(httpPort, () => {
  console.log(`Server running at http://localhost:${httpPort}`);
});