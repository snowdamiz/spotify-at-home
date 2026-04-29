#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const currentPid = process.pid;
const currentParentPid = process.ppid;
const devPorts = ["3000", "3001", "3101"];
const gracefulTimeoutMs = 1000;

const processes = readProcesses();
const processByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
const childrenByPid = new Map();

for (const processInfo of processes) {
  const children = childrenByPid.get(processInfo.ppid) ?? [];
  children.push(processInfo.pid);
  childrenByPid.set(processInfo.ppid, children);
}

const targets = new Set();

for (const processInfo of processes) {
  if (isProjectDevSeed(processInfo)) {
    addProcessTree(processInfo.pid);
  }
}

for (const pid of readDevPortListenerPids()) {
  if (hasProjectLineage(pid)) {
    addProcessTree(pid);
  }
}

targets.delete(currentPid);
targets.delete(currentParentPid);

if (targets.size === 0) {
  console.log("No broadside dev server processes found.");
  process.exit(0);
}

const orderedTargets = [...targets].sort((firstPid, secondPid) => getDepth(secondPid) - getDepth(firstPid));
console.log(`Stopping ${orderedTargets.length} broadside dev server process(es): ${orderedTargets.join(", ")}`);

sendSignal(orderedTargets, "SIGTERM");
await sleep(gracefulTimeoutMs);

const remainingTargets = orderedTargets.filter(isAlive);

if (remainingTargets.length > 0) {
  sendSignal(remainingTargets, "SIGKILL");
}

const survivors = orderedTargets.filter(isAlive);

if (survivors.length > 0) {
  console.error(`Unable to stop process(es): ${survivors.join(", ")}`);
  process.exit(1);
}

console.log("Broadside dev servers stopped.");

function readProcesses() {
  const output = runCommand("ps", ["-axo", "pid=,ppid=,command="]);

  return output
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);

      if (!match) {
        return null;
      }

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3]
      };
    })
    .filter(Boolean);
}

function readDevPortListenerPids() {
  const args = ["-nP", ...devPorts.map((port) => `-iTCP:${port}`), "-sTCP:LISTEN", "-Fp"];
  const output = runCommand("lsof", args);
  const pids = new Set();

  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pids.add(Number(line.slice(1)));
    }
  }

  return [...pids].filter(Number.isFinite);
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function isProjectDevSeed(processInfo) {
  const command = processInfo.command;

  if (!command.includes(projectRoot)) {
    return false;
  }

  return [
    "/node_modules/.bin/concurrently",
    "/node_modules/.bin/next dev",
    "/node_modules/.bin/tsx src/server.ts",
    "/node_modules/tsx/dist/",
    "/node_modules/@esbuild/",
    "/apps/client/.next/dev/"
  ].some((needle) => command.includes(`${projectRoot}${needle}`));
}

function addProcessTree(pid) {
  addDevAncestors(pid);
  addDescendants(pid);
  targets.add(pid);
}

function addDevAncestors(pid) {
  let processInfo = processByPid.get(pid);

  while (processInfo) {
    const parent = processByPid.get(processInfo.ppid);

    if (!parent || parent.pid === currentPid || !isDevAncestor(parent)) {
      return;
    }

    targets.add(parent.pid);
    processInfo = parent;
  }
}

function addDescendants(pid) {
  targets.add(pid);

  for (const childPid of childrenByPid.get(pid) ?? []) {
    addDescendants(childPid);
  }
}

function isDevAncestor(processInfo) {
  const command = processInfo.command;
  const npmDevScript = /(?:^|\s)npm\s+run\s+(?:dev|dev:api|dev:client)(?:\s|$)/.test(command);
  const projectDevTool = command.includes(projectRoot) && (
    command.includes("/node_modules/.bin/concurrently") ||
    command.includes("/node_modules/.bin/next dev") ||
    command.includes("/node_modules/.bin/tsx")
  );

  return npmDevScript || projectDevTool;
}

function hasProjectLineage(pid) {
  let processInfo = processByPid.get(pid);

  while (processInfo) {
    if (processInfo.command.includes(projectRoot)) {
      return true;
    }

    processInfo = processByPid.get(processInfo.ppid);
  }

  return false;
}

function getDepth(pid) {
  let depth = 0;
  let processInfo = processByPid.get(pid);

  while (processInfo) {
    depth += 1;
    processInfo = processByPid.get(processInfo.ppid);
  }

  return depth;
}

function sendSignal(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.warn(`Could not send ${signal} to ${pid}: ${error.message}`);
      }
    }
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}
