import { exec } from "child_process";
import Git, { Commit } from "nodegit";
import path from "path";

import config from "./config.json";

const TOTAL_MILLISECONDS_IN_A_DAY = 1000 * 60 * 60 * 24;
const TOTAL_MILLISECONDS_IN_A_WEEK = TOTAL_MILLISECONDS_IN_A_DAY * 7;

const currentDirectoryPathElements = __dirname.split(path.sep);
currentDirectoryPathElements.length = currentDirectoryPathElements.length - 2;
const REPO_PATH = path.join("/", ...currentDirectoryPathElements, "openui5");

let filter = "";

if (config.specFilter) {
  filter = `--specFilter ${config.specFilter}`;
} else if (config.libFilter) {
  filter = `--libFilter ${config.libFilter}`;
}

let browsers = "";

if (config.browsers) {
  browsers = `--browsers=${config.browsers}`;
}

const commits: Commit[] = [];

const executeCommand = async (
  command: string,
  message?: string
): Promise<boolean> => {
  if (message) {
    console.log(message);
  }

  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: REPO_PATH,
      },
      (error, stdout, stderr) => {
        if (error) {
          console.log("-".repeat(80));
          console.log("\nERROR");
          console.log("-".repeat(80));
          console.log(error.message);
          console.log("-".repeat(80) + "\n");
        }

        if (stderr) {
          console.log("-".repeat(80));
          console.log("\nERR");
          console.log("-".repeat(80));
          console.log(stderr);
          console.log("-".repeat(80) + "\n");
        }

        console.log("-".repeat(80));
        console.log("\nOUT");
        console.log("-".repeat(80));
        console.log(stdout);
        console.log("-".repeat(80) + "\n");

        resolve(error?.code ? false : true);
      }
    );
  });
};

const binaryCheckRevs = async (revs: Commit[]): Promise<Commit> => {
  const midRevIndex = Math.floor(revs.length / 2);
  const midRev = revs[midRevIndex];
  await executeCommand(
    `git checkout -b temp-${midRev} ${midRev}`,
    `Checking out temp branch for revision ${midRev}`
  );
  const res2 = await executeCommand(`uiveri5 ${filter} ${browsers}`);

  if (!res2 && revs.length > 2) {
    return await binaryCheckRevs(revs.slice(0, midRevIndex));
  }

  if (res2 && revs.length > 2) {
    return await binaryCheckRevs(revs.slice(midRevIndex, revs.length));
  }

  return midRev;
};

// assuming all was good in first reivision and issue found in last revision
const findLastGoodRevision = async () => {
  return await binaryCheckRevs(commits.slice().reverse());
};

const processCommits = async () => {
  for (const commit of commits) {
    console.log(
      `${commit.date()} ${commit.sha()} ${commit.author().name()} ${
        commit.message().split("\n")[0]
      }`
    );
  }

  const oldestCommit = commits[commits.length - 1];

  console.log(`Switching to oldest commit ---
    ${oldestCommit.time()}
    ${oldestCommit.sha()}
    ${oldestCommit.author().name()}
    ${oldestCommit.message().split("\n")[0]}
---`);

  await executeCommand(
    `git checkout master && git branch | grep -v "master" | xargs git branch -D`,
    "executing command 0 - clean branch env"
  );

  await executeCommand(
    `git checkout -b temp-${oldestCommit} ${oldestCommit}`,
    "executing command 1 - checkout new branch with oldest revision"
  );

  await executeCommand(
    `uiveri5 ${filter} ${browsers} --update`,
    "executing command 2 - run uiveri5 with --update flag"
  );

  await executeCommand(
    `git checkout master`,
    "executing command 3 - move to latest commit"
  );

  const res4 = await executeCommand(
    `uiveri5 ${filter} ${browsers}`,
    "executing command 4 - run uiveri5"
  );

  console.log("=".repeat(80));
  if (res4) {
    console.log("ALL PASSED");
  } else if (config.binarySearch) {
    const possibleBreakingRev = await findLastGoodRevision();
    console.log(`LAST GOOD
      ${possibleBreakingRev.sha()}
      ${possibleBreakingRev.author().name()}
      ${possibleBreakingRev.message().split("\n")[0]}
    `);

    console.log("FAILURES FOUND, CHECK LOG FOR MORE INFORMATION");
  }

  await executeCommand("git checkout master", "Clean branches");
};

const main = async () => {
  const repo = await Git.Repository.open(REPO_PATH);

  const masterCommit = await repo.getMasterCommit();
  const masterCommitTimeStamp = masterCommit.timeMs();
  const latestCommitTimeStamp =
    masterCommitTimeStamp - TOTAL_MILLISECONDS_IN_A_WEEK;

  const history = masterCommit.history();

  history.on("end", (totalCommits) => {
    for (const commit of totalCommits) {
      const commitTimeStamp = commit.timeMs();

      if (commitTimeStamp < latestCommitTimeStamp) {
        processCommits();

        break;
      } else {
        commits.push(commit);
      }
    }
  });

  history.start();
};

main();
