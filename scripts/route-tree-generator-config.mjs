import path from "node:path";
import { getConfig } from "@tanstack/router-generator";

function moduleSpecifier(fromFile, toFile) {
  let relativePath = path
    .relative(path.dirname(fromFile), toFile)
    .replaceAll("\\", "/");
  if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`;
  return relativePath;
}

function getRouteTreeGeneratorConfig(
  root,
  generatedRouteTree = "./src/routeTree.gen.ts",
) {
  const generatedPath = path.resolve(root, generatedRouteTree);
  const routerImport = moduleSpecifier(
    generatedPath,
    path.resolve(root, "src", "router.tsx"),
  );
  const startFooter = `import type { getRouter } from '${routerImport}'
import type { createStart } from '@tanstack/react-start'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
  }
}`;

  return getConfig(
    {
      generatedRouteTree,
      // TanStack Start supplies this footer around the bare router generator.
      // Keep the standalone generation/check commands byte-identical to the
      // route tree produced by the production Vite plugin.
      routeTreeFileFooter: () => [startFooter],
    },
    root,
  );
}

export { getRouteTreeGeneratorConfig };
