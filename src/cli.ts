#!/usr/bin/env node
import inquirer from "inquirer";
import {
  listAWSResources,
  selectAWSRegion,
  checkAWSCredentials,
} from "./aws/clients.js";
import { buildAndPushDockerImage } from "./docker/dockerBuilder.js";

async function main() {
  console.log("Welcome to the Deployer CLI!");
  const credsOk = await checkAWSCredentials();
  if (!credsOk) {
    console.error(
      "❌ AWS credentials are not valid or not configured. Please run `aws configure` or set your AWS credentials."
    );
    process.exit(1);
  }
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        "Choose AWS Region",
        "List AWS Resources",
        "Build & Push Docker Image",
        "Exit",
      ],
    },
  ]);

  switch (action) {
    case "Choose AWS Region":
      await selectAWSRegion();
      break;
    case "List AWS Resources":
      await listAWSResources();
      break;
    case "Build & Push Docker Image":
      await buildAndPushDockerImage();
      break;
    case "Exit":
      console.log("Goodbye!");
      process.exit(0);
  }
}

main();
