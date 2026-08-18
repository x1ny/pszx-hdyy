#!/usr/bin/env bun
import { execFileSync } from "node:child_process";

const MAIN_BRANCH = process.env.RELEASE_MAIN_BRANCH ?? "master";
const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

function run(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function fail(message: string): never {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function tryRun(command: string, args: string[]) {
  try {
    return run(command, args);
  } catch {
    return "";
  }
}

function latestVersionParts() {
  const [latest] = run("git", ["tag", "-l", "v*.*.*"])
    .split("\n")
    .map((tag) => tag.match(TAG_PATTERN))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match.slice(1).map(Number) as [number, number, number])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);

  return latest ?? null;
}

function nextVersion(arg: string | undefined) {
  if (arg && TAG_PATTERN.test(arg)) {
    return arg;
  }

  const latest = latestVersionParts();
  if (!latest) {
    return "v0.1.0";
  }

  const [major, minor, patch] = latest;
  if (arg === "major") return `v${major + 1}.0.0`;
  if (arg === "minor") return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

const status = run("git", ["status", "--porcelain"]);
if (status) {
  fail(`working tree is not clean:\n${status}`);
}

const branch = run("git", ["branch", "--show-current"]);
if (branch !== MAIN_BRANCH) {
  fail(`release must run on ${MAIN_BRANCH}, currently on ${branch}`);
}

try {
  run("git", ["fetch", "origin", MAIN_BRANCH, "--tags", "--quiet"]);
} catch (error) {
  fail(`unable to fetch origin/${MAIN_BRANCH}: ${(error as Error).message}`);
}

const head = run("git", ["rev-parse", "HEAD"]);
const remoteHead = tryRun("git", ["rev-parse", `origin/${MAIN_BRANCH}`]);
if (!remoteHead) {
  fail(`remote branch origin/${MAIN_BRANCH} was not found`);
}
if (head !== remoteHead) {
  fail(`HEAD is not synchronized with origin/${MAIN_BRANCH}; push or pull before releasing`);
}

const version = nextVersion(process.argv[2]);
if (run("git", ["tag", "-l", version])) {
  fail(`tag already exists: ${version}`);
}

run("git", ["tag", "-a", version, "-m", `Release ${version}`]);
run("git", ["push", "origin", version]);
console.log(`Released ${version}`);
