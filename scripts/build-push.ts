#!/usr/bin/env bun
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "ps-docker-registry.cn-beijing.cr.aliyuncs.com";
const IMAGE_NAME = "psdsframework/pszx-hdyy";
const DEFAULT_PLATFORM = "linux/amd64";

// 构建机拉不到 Docker Hub 时，用 BUN_IMAGE 指到私有仓库里的 bun 镜像。
const BUN_IMAGE = process.env.BUN_IMAGE ?? "";
const NPM_REGISTRY = process.env.NPM_REGISTRY ?? "";

function fail(message: string): never {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function latestTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      // 一个 tag 都没有时 git 会往 stderr 打 "fatal: No names found"，
      // 而这里没有 tag 是正常情况，让它冒出来只会盖过下面那句真正的提示。
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: ROOT_DIR, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`command failed: ${command} ${args.join(" ")}`);
  }
}

if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  fail("Docker is not running");
}

const version = process.argv[2] || latestTag();
const platform = process.argv[3] || DEFAULT_PLATFORM;
if (!version) {
  fail("no version supplied and no git tag exists; run bun run release first");
}

const image = `${REGISTRY}/${IMAGE_NAME}:${version}`;
const args = [
  "buildx",
  "build",
  "--platform",
  platform,
  "--tag",
  image,
  "--file",
  "docker/Dockerfile",
];

if (BUN_IMAGE) args.push("--build-arg", `BUN_IMAGE=${BUN_IMAGE}`);
if (NPM_REGISTRY) args.push("--build-arg", `NPM_REGISTRY=${NPM_REGISTRY}`);

// 多架构镜像没法 --load 到本地 Docker，只能让 Buildx 直接推。
if (platform.includes(",")) {
  run("docker", [...args, "--push", "."]);
} else {
  run("docker", [...args, "--load", "."]);
  run("docker", ["push", image]);
}

console.log(`Image published: ${image}`);
