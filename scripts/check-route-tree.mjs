import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Generator } from "@tanstack/router-generator";
import { getRouteTreeGeneratorConfig } from "./route-tree-generator-config.mjs";

const root = process.cwd();
const committedPath = path.join(root, "src", "routeTree.gen.ts");
const temporaryRelativePath = "./src/.routeTree.check.ts";
const temporaryPath = path.join(root, temporaryRelativePath);

try {
  const config = getRouteTreeGeneratorConfig(
    root,
    temporaryRelativePath,
  );
  await new Generator({ config, root }).run();

  const [committed, generated] = await Promise.all([
    fs.readFile(committedPath, "utf8"),
    fs.readFile(temporaryPath, "utf8"),
  ]);

  if (committed !== generated) {
    console.error(
      "src/routeTree.gen.ts is stale. Run npm run generate:routes and commit the result.",
    );
    process.exitCode = 1;
  } else {
    console.log("Generated route tree is current.");
  }
} finally {
  await fs.rm(temporaryPath, { force: true });
}
