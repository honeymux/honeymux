type TerminalOutputData = Uint8Array | string;
type TerminalOutputRendererLike = {
  writeOut: (data: TerminalOutputData) => unknown;
};

type TerminalOutputWriter = (data: TerminalOutputData) => void;

const defaultTerminalOutputWriter: TerminalOutputWriter = (data) => {
  process.stdout.write(data);
};

let terminalOutputWriter: TerminalOutputWriter = defaultTerminalOutputWriter;

export function setTerminalOutputRenderer(renderer?: TerminalOutputRendererLike | null): void {
  if (!renderer) {
    terminalOutputWriter = defaultTerminalOutputWriter;
    return;
  }

  terminalOutputWriter = (data) => {
    renderer.writeOut(data);
  };
}

export function setTerminalOutputWriter(writer?: TerminalOutputWriter): void {
  terminalOutputWriter = writer ?? defaultTerminalOutputWriter;
}

export function writeTerminalOutput(data: TerminalOutputData): void {
  terminalOutputWriter(data);
}
