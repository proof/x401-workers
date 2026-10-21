import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { applyEdits, modify, parse } from "jsonc-parser";
import { CIMD_PATH, PROTECTED_PATH, smoke } from "./smoke.mjs";

const USAGE = `Usage: npm run setup -- [--sandbox | --production] [--fresh]

  --sandbox     Deploy on workers.dev and enroll on Proof's sandbox (default).
  --production  Deploy on a domain you own and enroll on Proof's production.
  --fresh       Discard the environment's signing key, client id and enrollment, then set up again.`;

const WRANGLER_CONFIG = "wrangler.jsonc";
const DEV_VARS = ".dev.vars";
const ENROLLMENT_FILE = ".proof-enrollment.json";

const flags = process.argv.slice(2);
if (
  flags.some(
    (flag) => !["--sandbox", "--production", "--fresh"].includes(flag),
  ) ||
  (flags.includes("--sandbox") && flags.includes("--production"))
) {
  console.error(USAGE);
  process.exit(1);
}
const environment = flags.includes("--production") ? "production" : "sandbox";
const production = environment === "production";
const envArgs = [production ? "--env=production" : "--env="];
const envPath = production ? ["env", "production"] : [];
const keyFile = `signing-key.${environment}.json`;

function step(message) {
  console.log(`\n▸ ${message}`);
}

function npx(args, { capture = false, env = {} } = {}) {
  const result = spawnSync("npx", args, {
    stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"],
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    if (capture && result.stdout) {
      console.log(result.stdout);
    }
    throw new Error(`\`npx ${args.join(" ")}\` failed`);
  }
  return result.stdout;
}

function configValue(path) {
  return path.reduce(
    (node, key) => node?.[key],
    parse(readFileSync(WRANGLER_CONFIG, "utf8")),
  );
}

function setConfigValue(path, value) {
  const text = readFileSync(WRANGLER_CONFIG, "utf8");
  const edits = modify(text, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  writeFileSync(WRANGLER_CONFIG, applyEdits(text, edits));
}

const CLIENT_ID = [...envPath, "vars", "X401_CLIENT_ID"];
const ROUTES = [...envPath, "routes"];

function readEnrollments() {
  return existsSync(ENROLLMENT_FILE)
    ? JSON.parse(readFileSync(ENROLLMENT_FILE, "utf8"))
    : {};
}

function writeEnrollments(enrollments) {
  writeFileSync(ENROLLMENT_FILE, `${JSON.stringify(enrollments, null, 2)}\n`);
}

async function ask(question) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `cannot ask "${question.trim()}" without a terminal; run \`npm run setup\` in a terminal`,
    );
  }
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await readline.question(`  ${question}`)).trim();
  } finally {
    readline.close();
  }
}

function startFresh() {
  step(`Starting fresh in ${environment}`);
  rmSync(keyFile, { force: true });
  if (!production) {
    rmSync(DEV_VARS, { force: true });
  }
  const enrollments = readEnrollments();
  delete enrollments[environment];
  writeEnrollments(enrollments);
  setConfigValue(CLIENT_ID, "");
  if (production) {
    setConfigValue(ROUTES, []);
  }
}

function ensureLogin() {
  step("Checking your Cloudflare login");
  if (
    npx(["wrangler", "whoami"], { capture: true }).includes("not authenticated")
  ) {
    npx(["wrangler", "login"]);
  }
}

function ensureSigningKey() {
  step(`Signing key (${keyFile})`);
  if (existsSync(keyFile)) {
    console.log("  already exists, reusing it");
  } else {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    writeFileSync(
      keyFile,
      `${JSON.stringify(privateKey.export({ format: "jwk" }))}\n`,
      { mode: 0o600 },
    );
    console.log("  generated; keep this file private and out of git");
  }
  return readFileSync(keyFile, "utf8").trim();
}

function ensureDevVars(jwk) {
  step(`Local development settings (${DEV_VARS})`);
  if (existsSync(DEV_VARS)) {
    console.log("  already exists, leaving it untouched");
    return;
  }
  writeFileSync(DEV_VARS, `SIGNING_JWK='${jwk}'\n`, { mode: 0o600 });
  console.log("  written; `npm run dev` now serves the Verifier locally");
}

async function ensureProductionDomain() {
  if (configValue(CLIENT_ID) !== "") {
    return;
  }
  const domain = await ask(
    "Domain for the Verifier, on a zone in your Cloudflare account (e.g. verifier.example.com): ",
  );
  setConfigValue(ROUTES, [{ pattern: domain, custom_domain: true }]);
  setConfigValue(CLIENT_ID, `https://${domain}${CIMD_PATH}`);
}

function deploy(jwk) {
  const dir = mkdtempSync(join(tmpdir(), "x401-setup-"));
  const outputFile =
    process.env.WRANGLER_OUTPUT_FILE_PATH ?? join(dir, "output.json");
  const secretsFile = join(dir, "secrets.json");
  writeFileSync(secretsFile, JSON.stringify({ SIGNING_JWK: jwk }), {
    mode: 0o600,
  });
  try {
    npx(["wrangler", "deploy", ...envArgs, "--secrets-file", secretsFile], {
      env: { WRANGLER_OUTPUT_FILE_PATH: outputFile },
    });
  } finally {
    rmSync(secretsFile);
  }
  return readFileSync(outputFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .findLast((entry) => entry.type === "deploy")
    ?.targets?.find((target) => target.startsWith("https://"));
}

async function enroll(clientId) {
  step(`Enrolling ${clientId} on Proof (${environment})`);
  const enrollments = readEnrollments();
  if (enrollments[environment]?.clientId === clientId) {
    console.log(
      `  already enrolled as ${enrollments[environment].email}; run with --fresh to start over`,
    );
    return;
  }
  const email = await ask(
    "Email of the account owner (Proof sends the activation link there): ",
  );
  const output = npx(
    [
      "proof",
      "enroll",
      clientId,
      "--email",
      email,
      "--key",
      keyFile,
      "--environment",
      environment,
    ],
    { capture: true },
  );
  console.log(output.trimEnd());
  enrollments[environment] = { clientId, email, response: JSON.parse(output) };
  writeEnrollments(enrollments);
}

async function main() {
  if (flags.includes("--fresh")) {
    startFresh();
  }
  ensureLogin();
  const jwk = ensureSigningKey();
  if (production) {
    await ensureProductionDomain();
  } else {
    ensureDevVars(jwk);
  }

  step(`Deploying the ${environment} Worker with its signing key`);
  const url = deploy(jwk);

  step("Creating the nonce table");
  npx(["wrangler", "d1", "migrations", "apply", "DB", "--remote", ...envArgs]);

  let clientId = configValue(CLIENT_ID);
  if (clientId === "") {
    if (url === undefined) {
      throw new Error(
        `wrangler reported no public URL; set ${CLIENT_ID.join(".")} in ${WRANGLER_CONFIG}`,
      );
    }
    clientId = new URL(CIMD_PATH, url).toString();
    step(`Setting X401_CLIENT_ID to ${clientId} and redeploying`);
    setConfigValue(CLIENT_ID, clientId);
    deploy(jwk);
  }
  const baseUrl = new URL("/", clientId).toString();

  step("Smoke test");
  const document = await smoke(baseUrl, { attempts: 10 });
  if (document.client_id !== clientId) {
    throw new Error(
      `the deployed CIMD declares client_id ${document.client_id}, expected ${clientId}`,
    );
  }

  await enroll(clientId);

  console.log(`
Done. Remaining steps:
  1. Open the activation email from Proof and follow its instructions.
  2. Ask an agent connected to Proof's ${environment} MCP server to fetch ${new URL(PROTECTED_PATH, baseUrl)}`);
}

try {
  await main();
} catch (error) {
  console.error(`\n✖ ${error.message}`);
  process.exit(1);
}
