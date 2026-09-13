-- board.vhd — sample design instantiating two LM358s in different packages.
library ieee;
use ieee.std_logic_1164.all;

entity board is
  port (
    VCC : in std_logic;
    GND : in std_logic;
    A   : in std_logic;
    B   : in std_logic;
    Y   : out std_logic
  );
end entity;

architecture rtl of board is
  signal n1 : std_logic;
begin
  U1 : entity work.LM358
    generic map (PACKAGE_VARIANT => "SOIC8")
    port map (
      IN_P => A,
      IN_N => B,
      OUT  => n1,
      VCC  => VCC,
      GND  => GND
    );

  U2 : entity work.LM358
    generic map (PACKAGE_VARIANT => "DIP8")
    port map (
      IN_P => n1,
      IN_N => B,
      OUT  => Y,
      VCC  => VCC,
      GND  => GND
    );
end architecture;