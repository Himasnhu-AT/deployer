import chalk from "chalk";
import { spawn } from "child_process";

/**
 * Pushes a Docker image to a remote registry.
 * @param dockerImage The full image name (including tag) to push.
 */
export async function pushDockerImage(dockerImage: string): Promise<void> {
  console.log(chalk.blue(`📤 Pushing Docker image: ${dockerImage}`));

  return new Promise((resolve, reject) => {
    const pushProcess = spawn("docker", ["push", dockerImage], {
      stdio: "inherit",
    });

    pushProcess.on("close", (code) => {
      if (code === 0) {
        console.log(chalk.green(`✓ Docker image pushed successfully`));
        resolve();
      } else {
        reject(new Error(`Docker push failed with code ${code}`));
      }
    });
  });
}
