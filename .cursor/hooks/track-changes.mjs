import {
  readHookInput,
  refreshDeployQueue,
  writeHookOutput,
} from "./lib/deploy-utils.mjs";

const input = readHookInput();
refreshDeployQueue(input.tool_name || input.tool || "afterFileEdit");
writeHookOutput({});
