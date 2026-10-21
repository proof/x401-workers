import { pathToFileURL } from "node:url";

export const CIMD_PATH = "/.well-known/proof-client.json";
export const PROTECTED_PATH = "/protected";

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`  ok  ${message}`);
}

async function fetchWithRetry(url, attempts) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status !== 404 || attempt === attempts) {
        return response;
      }
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export async function smoke(baseUrl, { attempts = 1 } = {}) {
  const cimdUrl = new URL(CIMD_PATH, baseUrl).toString();
  console.log(`Checking ${baseUrl}`);

  const cimd = await fetchWithRetry(cimdUrl, attempts);
  check(cimd.status === 200, `GET ${CIMD_PATH} returns 200`);
  const document = await cimd.json();
  console.log(`  client_id is ${document.client_id}`);
  check(
    Array.isArray(document.jwks?.keys) &&
      document.jwks.keys.length > 0 &&
      document.jwks.keys.every((key) => !("d" in key)),
    "the CIMD publishes only public keys",
  );

  const challenge = await fetchWithRetry(
    new URL(PROTECTED_PATH, baseUrl),
    attempts,
  );
  check(challenge.status === 401, `GET ${PROTECTED_PATH} returns 401`);
  const proofRequest = challenge.headers.get("PROOF-REQUEST");
  check(proofRequest !== null, "the response carries a PROOF-REQUEST header");
  check(
    challenge.headers.get("Cache-Control") === "no-store",
    "the response is not cacheable",
  );
  console.log("  PROOF-REQUEST payload:");
  console.log(
    JSON.stringify(
      JSON.parse(Buffer.from(proofRequest, "base64url").toString()),
      null,
      2,
    )
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
  );
  return document;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const baseUrl = process.argv[2];
  if (baseUrl === undefined) {
    console.error("Usage: npm run smoke -- <base-url>");
    process.exit(1);
  }
  try {
    await smoke(baseUrl);
  } catch (error) {
    console.error(`  FAIL  ${error.message}`);
    process.exit(1);
  }
}
