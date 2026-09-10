export interface ProjectFolder {
  kind: "folder";
  name: string;
  children: ProjectNode[];
}

export interface ProjectFile {
  kind: "file";
  name: string;
  id: string;
}

export type ProjectNode = ProjectFolder | ProjectFile;

export interface VhdlFile {
  id: string;
  name: string;
  content: string;
}

export const projectTree: ProjectNode[] = [
  {
    kind: "folder",
    name: "example_project",
    children: [
      {
        kind: "folder",
        name: "src",
        children: [
          { kind: "file", name: "top.vhd", id: "top" },
          {
            kind: "folder",
            name: "blocks",
            children: [{ kind: "file", name: "design.vhd", id: "design" }],
          },
        ],
      },
      {
        kind: "folder",
        name: "pkg",
        children: [{ kind: "file", name: "constants.vhd", id: "constants" }],
      },
    ],
  },
];

export const vhdlFiles: VhdlFile[] = [
  {
    id: "top",
    name: "top.vhd",
    content: `-- Top level: tie the sub-blocks together.
library IEEE;
use IEEE.std_logic_1164.all;

entity top is
    port (
        clk   : in  std_logic;
        rst   : in  std_logic;
        rx    : in  std_logic;
        tx    : out std_logic
    );
end entity top;

architecture rtl of top is
    signal busy : std_logic;
begin
    -- Sub-block instances go here.
    inst : entity work.design
        port map (
            clk  => clk,
            rst  => rst,
            busy => busy
        );

    tx <= rx;
end architecture rtl;
`,
  },
  {
    id: "design",
    name: "design.vhd",
    content: `-- A small design block.
library IEEE;
use IEEE.std_logic_1164.all;

entity design is
    port (
        clk  : in  std_logic;
        rst  : in  std_logic;
        busy : out std_logic
    );
end entity design;

architecture rtl of design is
begin
    busy <= '0';
end architecture rtl;
`,
  },
  {
    id: "constants",
    name: "constants.vhd",
    content: `-- Shared constants package.
package constants is
    constant WIDTH : natural := 8;
end package constants;
`,
  },
];

export const defaultFileId = "top";

export function findFile(id: string): VhdlFile {
  return vhdlFiles.find((f) => f.id === id) ?? vhdlFiles[0];
}
