#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import https from "node:https";
import config from "./deploy-test.config.ts";

const redeployUrl = process.env.RANCHER_REDEPLOY_URL || config.rancherRedeployUrl;
const token = process.env.RANCHER_DEPLOY_TOKEN || config.rancherDeployToken;
const insecureTls = process.env.DEPLOY_INSECURE_TLS
  ? process.env.DEPLOY_INSECURE_TLS === "1"
  : config.insecureTls;

function fail(message: string): never {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

if (!redeployUrl) fail("missing RANCHER_REDEPLOY_URL (see scripts/deploy-test.config.ts)");
if (!token) fail("missing RANCHER_DEPLOY_TOKEN (see scripts/deploy-test.config.ts)");

// 先把 :test 标签的镜像构建好推上去，Rancher 那边 redeploy 才有东西可拉。
execFileSync("bun", ["scripts/build-push.ts", "test"], { stdio: "inherit" });

const url = new URL(redeployUrl);
const request = https.request(
  {
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    method: "POST",
    rejectUnauthorized: !insecureTls,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": 0,
    },
  },
  (response) => {
    let body = "";
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => {
      const status = response.statusCode;
      if (!status || status < 200 || status >= 300) {
        fail(`Rancher redeploy failed: HTTP ${status}\n${body}`);
      }
      console.log(`Test deployment triggered: HTTP ${status}`);
      if (body) console.log(body);
    });
  },
);

request.on("error", (error) => fail(`Rancher request failed: ${error.message}`));
request.end();
