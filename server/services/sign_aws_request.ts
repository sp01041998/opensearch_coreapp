import * as crypto from "crypto";

/**
 * ENV CONFIG (REQUIRED)
 */
const REGION = process.env.REGION || "us-west-2";
const ES_HOST = process.env.ES_HOST; // e.g. search-domain.amazonaws.com

if (!ES_HOST) {
  throw new Error("ES_HOST environment variable is not set.");
}

export interface SignAWS4SignatureParams {
  endpoint: string;                 // "/_search" or "/index/_doc/1"
  method: string;                   // "GET" | "POST" | "PUT" | "DELETE"
  secretKey: string;
  accessKey: string;
  sessionToken?: string;
  payload?: string;
  querystring?: string | Record<string, any>;
}

export interface AWS4Headers {
  "x-amz-date": string;
  Authorization: string;
  "x-amz-security-token"?: string;
}

/**
 * AWS Signature Version 4 signing implementation
 */
export async function signAWS4Signature({
  endpoint,
  method,
  secretKey,
  accessKey,
  sessionToken = "",
  payload = "",
  querystring = "",
}: SignAWS4SignatureParams): Promise<AWS4Headers> {
  
  // --- Normalize endpoint ---
  endpoint = endpoint.startsWith("/") ? endpoint : "/" + endpoint;

  // Extract inline query params inside endpoint
  if (endpoint.includes("?")) {
    const [pureEndpoint, qs] = endpoint.split("?");
    endpoint = pureEndpoint;
    querystring = qs;
  }

  // --- Normalize Querystring ---
  let canonicalQueryString = "";

  if (typeof querystring === "string") {
    canonicalQueryString = new URLSearchParams(querystring).toString();
  } else if (typeof querystring === "object" && querystring !== null) {
    const filtered = Object.entries(querystring)
      .filter(([k, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => a.localeCompare(b));

    canonicalQueryString = filtered
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
  }

  canonicalQueryString = canonicalQueryString.replace(/\*/g, "%2A");

  // --- Helpers ---
  const sha256 = (str: string) =>
    crypto.createHash("sha256").update(str, "utf8").digest("hex");

  const hmac = (key: crypto.BinaryLike, val: string) =>
    crypto.createHmac("sha256", key).update(val, "utf8").digest();

  const getSignatureKey = (key: string, date: string, region: string, service: string) => {
    const kDate = hmac(`AWS4${key}`, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    return hmac(kService, "aws4_request");
  };

  // --- Timestamps ---
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);

  // --- Canonical Headers ---
  let canonicalHeaders = `host:${ES_HOST}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeadersList = ["host", "x-amz-date"];

  if (sessionToken) {
    canonicalHeaders += `x-amz-security-token:${sessionToken}\n`;
    signedHeadersList.push("x-amz-security-token");
  }

  const signedHeaders = signedHeadersList.join(";");

  // --- Payload Hash ---
  const payloadHash = sha256(payload || "");

  // --- Canonical Request ---
  const canonicalRequest = [
    method.toUpperCase(),
    endpoint,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // console.log("CANONICAL REQUEST:\n", canonicalRequest);

  // --- String to Sign ---
  const credentialScope = `${dateStamp}/${REGION}/es/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  // --- Signature ---
  const signingKey = getSignatureKey(secretKey, dateStamp, REGION, "es");
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  // --- Final Headers ---
  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: AWS4Headers = {
    "x-amz-date": amzDate,
    Authorization: authorizationHeader,
  };

  if (sessionToken) {
    headers["x-amz-security-token"] = sessionToken;
  }

  return headers;
}