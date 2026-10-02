import {
  localDate,
  nodeAuditPorts,
  nodeFileSystem,
  nodeMachine,
  nodePrompt,
  nodeRunner,
  nodeSiblingPorts,
  nodeWorkspace,
  openBench,
  openSourceRepository,
  pnpmProbeRunner,
  processInterruptGuard,
  terminalOutput,
} from "./adapters.js";
import { exitOnThrow, main } from "./main.js";
import { templatesPnpmPin } from "./pnpm-pin.js";
import { runningFile, selfLayout } from "./self.js";

const argv = process.argv.slice(2);
const out = terminalOutput();

const start = async (): Promise<number> => {
  const bundlePath = runningFile();
  return main(
    argv,
    nodeFileSystem(process.cwd()),
    out,
    openBench(selfLayout(bundlePath).kit),
    openSourceRepository,
    {
      workspace: nodeWorkspace(process.cwd()),
      runner: nodeRunner(process.cwd()),
      prompt: nodePrompt(),
      interrupt: processInterruptGuard(),
      today: () => localDate(),
    },
    {
      runner: nodeRunner(process.cwd()),
      pnpmRunner: pnpmProbeRunner(templatesPnpmPin()),
      machine: nodeMachine(bundlePath),
    },
    nodeAuditPorts(process.cwd()),
    nodeSiblingPorts(process.cwd()),
  );
};

start().then(
  (exit) => process.exit(exit),
  (error: unknown) => process.exit(exitOnThrow(out, error)),
);
