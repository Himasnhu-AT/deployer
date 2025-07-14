import inquirer from "inquirer";
import { execa } from "execa";

export async function buildAndPushDockerImage() {
  const { imageName, dockerfilePath, push } = await inquirer.prompt([
    {
      type: "input",
      name: "imageName",
      message: "Docker image name (e.g., my-app:latest):",
      validate: (input: string) => (input ? true : "Image name required"),
    },
    {
      type: "input",
      name: "dockerfilePath",
      message: "Path to Dockerfile:",
      default: "./Dockerfile",
    },
    {
      type: "confirm",
      name: "push",
      message: "Push image to registry after build?",
      default: true,
    },
  ]);

  try {
    console.log(`Building image ${imageName}...`);
    await execa(
      "docker",
      ["build", "-t", imageName, "-f", dockerfilePath, "."],
      { stdio: "inherit" }
    );
    console.log("Build complete!");
    if (push) {
      console.log(`Pushing image ${imageName}...`);
      await execa("docker", ["push", imageName], { stdio: "inherit" });
      console.log("Push complete!");
    }
  } catch (err) {
    console.error("Docker build/push failed:", err);
  }
}
