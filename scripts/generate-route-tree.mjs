import { Generator } from "@tanstack/router-generator";
import { getRouteTreeGeneratorConfig } from "./route-tree-generator-config.mjs";

const root = process.cwd();
const config = getRouteTreeGeneratorConfig(root);
await new Generator({ config, root }).run();
console.log(`Generated ${config.generatedRouteTree}.`);
